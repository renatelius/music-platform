import { WS_CLOSE, WsServerMessage } from '@mp/contracts';

import type { Timer } from './types.js';

/** The part of a WebSocket the channel uses (browser WebSocket, React Native, `ws`). */
export interface SocketLike {
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number }) => void) | null;
  onerror: (() => void) | null;
  close(code?: number, reason?: string): void;
}

export interface LiveChannelOptions {
  /** A fresh one-time ticket (POST /sync/ws-ticket). */
  readonly ticket: () => Promise<string>;
  readonly open: (ticket: string) => SocketLike;
  readonly timer: Timer;
  readonly onSeq: (seq: number) => void;
  readonly onConnected?: (connected: boolean) => void;
}

export const RECONNECT_MIN_MS = 1000;
export const RECONNECT_MAX_MS = 30_000;

/**
 * Keeps the live channel open: ticket → socket → `hello`/`changed` → `onSeq`. Reconnects with
 * growing pauses; a lost channel only delays updates (the engine also catches up on its own).
 */
export class LiveChannel {
  private socket: SocketLike | null = null;
  private handle: unknown = null;
  private attempts = 0;
  private running = false;
  private connected = false;
  private generation = 0;

  constructor(private readonly options: LiveChannelOptions) {}

  get isConnected(): boolean {
    return this.connected;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.connect();
  }

  stop(): void {
    this.running = false;
    this.generation += 1;
    if (this.handle !== null) this.options.timer.clear(this.handle);
    this.handle = null;
    const socket = this.socket;
    this.socket = null;
    if (socket !== null) {
      socket.onclose = null;
      socket.close(1000, 'Client stops');
    }
    this.setConnected(false);
  }

  /** The network is back: try at once instead of waiting for the pause to end. */
  reconnectNow(): void {
    if (!this.running || this.socket !== null) return;
    if (this.handle !== null) this.options.timer.clear(this.handle);
    this.handle = null;
    this.attempts = 0;
    void this.connect();
  }

  private async connect(): Promise<void> {
    const generation = this.generation;
    let ticket: string;
    try {
      ticket = await this.options.ticket();
    } catch {
      if (generation === this.generation) this.retry();
      return;
    }
    if (!this.running || generation !== this.generation) return;
    let socket: SocketLike;
    try {
      socket = this.options.open(ticket);
    } catch {
      this.retry();
      return;
    }
    this.socket = socket;
    socket.onopen = () => {
      this.attempts = 0;
      this.setConnected(true);
    };
    socket.onmessage = (event) => {
      if (typeof event.data !== 'string') return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(event.data);
      } catch {
        return;
      }
      const message = WsServerMessage.safeParse(parsed);
      if (message.success) this.options.onSeq(message.data.seq);
    };
    socket.onerror = () => undefined;
    socket.onclose = (event) => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.setConnected(false);
      // 4401: the session ended; the next ticket request renews it or signs out.
      if (event.code === WS_CLOSE.unauthenticated) this.attempts = Math.max(this.attempts, 2);
      this.retry();
    };
  }

  private retry(): void {
    if (!this.running) return;
    this.attempts += 1;
    const delay = Math.min(RECONNECT_MIN_MS * 2 ** (this.attempts - 1), RECONNECT_MAX_MS);
    this.handle = this.options.timer.set(() => {
      this.handle = null;
      void this.connect();
    }, delay);
  }

  private setConnected(connected: boolean): void {
    if (this.connected === connected) return;
    this.connected = connected;
    this.options.onConnected?.(connected);
  }
}
