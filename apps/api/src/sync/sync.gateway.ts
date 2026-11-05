import { type IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';

import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';

import { WS_CLOSE, WS_PATH, WS_PING_INTERVAL_MS, type WsServerMessage } from '@mp/contracts';
import type { Redis } from 'ioredis';
import { type WebSocket, WebSocketServer } from 'ws';
import { z } from 'zod';

import { allowedOrigins } from '../auth/csrf.js';
import type { AppConfig } from '../config/env.js';
import { APP_CONFIG, REDIS } from '../infra/tokens.js';
import { SyncService, type TicketOwner } from './sync.service.js';

interface Client {
  readonly ws: WebSocket;
  readonly owner: TicketOwner;
  alive: boolean;
}

/** What other parts of the API publish on `user:<id>` (library changes, sign-outs). */
const Notice = z.discriminatedUnion('type', [
  z.object({ type: z.literal('changed'), seq: z.number().int().nonnegative() }),
  z.object({ type: z.literal('sessions') }),
]);

const CHANNEL_PREFIX = 'user:';
const STATUS_TEXT = { 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found' } as const;

function reject(socket: Duplex, status: keyof typeof STATUS_TEXT): void {
  socket.end(
    `HTTP/1.1 ${String(status)} ${STATUS_TEXT[status]}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
  );
}

/**
 * Live channel `WS /ws?ticket=` (I7b, ADR-020). It carries only «changed, version N»: data
 * always comes from `GET /sync/changes`, so a lost message costs nothing. Instances of the API
 * share notifications through Redis pub/sub. Plain `ws`, no socket.io: simple for native apps.
 */
@Injectable()
export class SyncGateway implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('Sync');
  private readonly wss = new WebSocketServer({ noServer: true, maxPayload: 1024 });
  private readonly clients = new Map<string, Set<Client>>();
  private readonly origins: ReadonlySet<string>;
  private subscriber: Redis | null = null;
  private server: Server | null = null;
  private timer: NodeJS.Timeout | null = null;
  private closing = false;

  private readonly onUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer): void => {
    socket.on('error', () => {
      socket.destroy();
    });
    this.upgrade(req, socket, head).catch((error: unknown) => {
      this.logger.warn(`Upgrade failed: ${error instanceof Error ? error.message : 'unknown'}`);
      socket.destroy();
    });
  };

  constructor(
    @Inject(HttpAdapterHost) private readonly host: HttpAdapterHost,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(SyncService) private readonly sync: SyncService,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    // Browsers send Origin: only the web app may open the channel. Native apps send none.
    this.origins = allowedOrigins([...config.api.corsOrigins, config.webAppUrl]);
  }

  onApplicationBootstrap(): void {
    const server: unknown = this.host.httpAdapter.getHttpServer();
    if (!(server instanceof Server)) {
      this.logger.warn('No HTTP server: the live channel is off');
      return;
    }
    server.on('upgrade', this.onUpgrade);
    this.server = server;
    const subscriber = this.redis.duplicate();
    subscriber.on('error', (error: Error) => {
      this.logger.warn(`Redis subscriber: ${error.message}`);
    });
    subscriber.on('message', (channel: string, message: string) => {
      this.deliver(channel, message);
    });
    this.subscriber = subscriber;
    this.timer = setInterval(() => {
      this.heartbeat();
    }, WS_PING_INTERVAL_MS);
    this.timer.unref();
  }

  async onApplicationShutdown(): Promise<void> {
    this.closing = true;
    if (this.timer !== null) clearInterval(this.timer);
    this.server?.off('upgrade', this.onUpgrade);
    for (const client of this.all()) {
      client.ws.close(WS_CLOSE.shutdown, 'Server is shutting down');
      setTimeout(() => {
        client.ws.terminate();
      }, 1000).unref();
    }
    this.clients.clear();
    await new Promise<void>((resolve) => {
      this.wss.close(() => {
        resolve();
      });
    });
    await this.subscriber?.quit().catch(() => undefined);
  }

  /** Connections now (tests, health later). */
  connectionCount(): number {
    return this.all().length;
  }

  private all(): Client[] {
    return [...this.clients.values()].flatMap((set) => [...set]);
  }

  private async upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== WS_PATH || this.closing) {
      reject(socket, 404);
      return;
    }
    const origin = req.headers.origin;
    if (origin !== undefined && !this.origins.has(origin)) {
      reject(socket, 403);
      return;
    }
    const ticket = url.searchParams.get('ticket');
    const owner = ticket === null ? null : await this.sync.redeemTicket(ticket);
    if (owner === null) {
      reject(socket, 401);
      return;
    }
    this.wss.handleUpgrade(req, socket, head, (ws) => {
      this.connected(ws, owner).catch((error: unknown) => {
        this.logger.warn(`Connect failed: ${error instanceof Error ? error.message : 'unknown'}`);
        ws.terminate();
      });
    });
  }

  private async connected(ws: WebSocket, owner: TicketOwner): Promise<void> {
    const client: Client = { ws, owner, alive: true };
    ws.on('pong', () => {
      client.alive = true;
    });
    ws.on('close', () => {
      this.remove(client);
    });
    ws.on('error', () => {
      ws.terminate();
    });
    const set = this.clients.get(owner.userId);
    if (set === undefined) {
      this.clients.set(owner.userId, new Set([client]));
      await this.subscriber?.subscribe(`${CHANNEL_PREFIX}${owner.userId}`);
    } else {
      set.add(client);
    }
    // After subscribing: a change made in between is covered by `hello` or by `changed`.
    this.send(client, { type: 'hello', seq: await this.sync.currentSeq(owner.userId) });
  }

  private remove(client: Client): void {
    const set = this.clients.get(client.owner.userId);
    if (set === undefined || !set.delete(client)) return;
    if (set.size > 0) return;
    this.clients.delete(client.owner.userId);
    this.subscriber?.unsubscribe(`${CHANNEL_PREFIX}${client.owner.userId}`).catch(() => undefined);
  }

  private send(client: Client, message: WsServerMessage): void {
    if (client.ws.readyState === client.ws.OPEN) client.ws.send(JSON.stringify(message));
  }

  private deliver(channel: string, message: string): void {
    if (!channel.startsWith(CHANNEL_PREFIX)) return;
    const set = this.clients.get(channel.slice(CHANNEL_PREFIX.length));
    if (set === undefined) return;
    let notice: z.infer<typeof Notice>;
    try {
      notice = Notice.parse(JSON.parse(message));
    } catch {
      return;
    }
    if (notice.type === 'changed') {
      for (const client of set) this.send(client, { type: 'changed', seq: notice.seq });
      return;
    }
    this.recheck([...set]);
  }

  /** Closes connections whose sign-in ended (sign-out, revoked session, disabled account). */
  private recheck(clients: readonly Client[]): void {
    for (const client of clients) {
      this.sync
        .sessionActive(client.owner)
        .then((active) => {
          if (!active) client.ws.close(WS_CLOSE.unauthenticated, 'Session ended');
        })
        .catch(() => undefined);
    }
  }

  /** Every 25 s: drop connections that stopped answering, re-check the sign-ins. */
  private heartbeat(): void {
    const clients = this.all();
    for (const client of clients) {
      if (!client.alive) {
        client.ws.terminate();
        continue;
      }
      client.alive = false;
      client.ws.ping();
    }
    this.recheck(clients);
  }
}
