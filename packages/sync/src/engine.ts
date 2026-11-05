import type { SyncChange } from '@mp/contracts';

import type {
  LockFn,
  OutboxEntry,
  OutboxOp,
  OutboxStorage,
  SyncTransport,
  Timer,
} from './types.js';

export interface SyncStatus {
  /** Changes of this user not yet accepted by the server (all tabs). */
  readonly pending: number;
  /** The last attempt failed for lack of network or a busy server; it is retried later. */
  readonly offline: boolean;
  /** Version of the library this tab has caught up to (null before the first answer). */
  readonly seq: number | null;
}

export interface SyncEngineOptions {
  readonly storage: OutboxStorage;
  readonly transport: SyncTransport;
  readonly timer: Timer;
  readonly newId: () => string;
  readonly now: () => number;
  /** Only one tab sends the shared queue at a time. */
  readonly lock?: LockFn;
  readonly lockName?: string;
  /** Changes made elsewhere (another device or tab), in order. */
  readonly onRemote?: (changes: readonly SyncChange[]) => void;
  /** The version was too old for the change log: reload everything from the server. */
  readonly onReset?: () => void;
  readonly onSent?: (entry: OutboxEntry) => void;
  /** The server refused the change (4xx): undo it on screen and tell the user. */
  readonly onRejected?: (entry: OutboxEntry, error: unknown) => void;
}

export const RETRY_MIN_MS = 1000;
export const RETRY_MAX_MS = 60_000;
/** How many of our own change ids are remembered to skip them in the log. */
const OWN_LIMIT = 2000;

/** The newer op replaces a waiting older one (null: both are sent). */
function combine(older: OutboxOp, newer: OutboxOp): OutboxOp | null {
  if (older.type === 'library' && newer.type === 'library') {
    return older.kind === newer.kind && older.id === newer.id ? newer : null;
  }
  if (older.type === 'settings' && newer.type === 'settings') return { ...older, ...newer };
  return null;
}

/**
 * Offline-first sync of one user's library (ADR-020). Changes go to a durable queue first and
 * are sent in order; network failures are retried with growing pauses, a refusal is reported
 * and dropped. Changes made elsewhere come from the change log after the version this tab has;
 * our own changes there are skipped (they are already on screen). The live channel only says
 * «there is something new»: `notify(seq)`.
 */
export class SyncEngine {
  private entries: readonly OutboxEntry[] = [];
  private seq: number | null = null;
  private offline = false;
  private failures = 0;
  private retryHandle: unknown = null;
  private inFlight: string | null = null;
  private flushing: Promise<void> | null = null;
  private flushAgain = false;
  private catching: Promise<void> | null = null;
  private catchAgain = false;
  private disposed = false;
  private readonly own = new Set<string>();
  private readonly listeners = new Set<() => void>();
  private status: SyncStatus = { pending: 0, offline: false, seq: null };

  constructor(private readonly options: SyncEngineOptions) {}

  /** Loads the queue, sends it and catches up. */
  async start(): Promise<void> {
    this.entries = await this.options.storage.list();
    this.emit();
    void this.flush();
    await this.catchUp();
  }

  dispose(): void {
    this.disposed = true;
    if (this.retryHandle !== null) this.options.timer.clear(this.retryHandle);
    this.retryHandle = null;
    this.listeners.clear();
  }

  getStatus = (): SyncStatus => this.status;

  private isDisposed(): boolean {
    return this.disposed;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** What is waiting, as this tab last saw it (for the screen: pending likes, playlists). */
  pending(): readonly OutboxEntry[] {
    return this.entries;
  }

  /** A change made here directly (not through the queue): skip it when it comes back. */
  remember(id: string): void {
    this.own.add(id);
    if (this.own.size > OWN_LIMIT) {
      const oldest = this.own.values().next();
      if (oldest.done !== true) this.own.delete(oldest.value);
    }
  }

  /** Queues a change and tries to send it right away. */
  async enqueue(op: OutboxOp, id: string = this.options.newId()): Promise<OutboxEntry> {
    let merged = op;
    const replaced: OutboxEntry[] = [];
    for (const entry of this.entries) {
      if (entry.id === this.inFlight) continue;
      const combined = combine(entry.op, merged);
      if (combined !== null) {
        merged = combined;
        replaced.push(entry);
      }
    }
    const entry: OutboxEntry = { id, op: merged, createdAt: this.options.now() };
    this.remember(id);
    for (const old of replaced) await this.options.storage.delete(old.id);
    await this.options.storage.put(entry);
    this.entries = [...this.entries.filter((e) => !replaced.includes(e)), entry];
    this.emit();
    void this.flush();
    return entry;
  }

  /** The network is back (browser event, live channel connected): send and catch up now. */
  online(): void {
    if (this.retryHandle !== null) {
      this.options.timer.clear(this.retryHandle);
      this.retryHandle = null;
    }
    this.failures = 0;
    void this.flush();
    void this.catchUp();
  }

  /** The live channel says the library is at version `seq`. */
  notify(seq: number): void {
    if (this.seq === null || seq !== this.seq) void this.catchUp();
  }

  /** Sends the queue in order. One run at a time; a call during a run schedules another. */
  flush(): Promise<void> {
    if (this.flushing !== null) {
      this.flushAgain = true;
      return this.flushing;
    }
    this.flushing = this.runFlush().finally(() => {
      this.flushing = null;
      if (this.flushAgain && !this.disposed) {
        this.flushAgain = false;
        void this.flush();
      }
    });
    return this.flushing;
  }

  /** Fetches changes made elsewhere. One run at a time, like flush. */
  catchUp(): Promise<void> {
    if (this.catching !== null) {
      this.catchAgain = true;
      return this.catching;
    }
    this.catching = this.runCatchUp().finally(() => {
      this.catching = null;
      if (this.catchAgain && !this.disposed) {
        this.catchAgain = false;
        void this.catchUp();
      }
    });
    return this.catching;
  }

  private async runFlush(): Promise<void> {
    if (this.retryHandle !== null || this.disposed) return;
    const work = () => this.sendAll();
    const { lock, lockName } = this.options;
    await (lock === undefined ? work() : lock(lockName ?? 'remusic-sync-outbox', work));
  }

  private async sendAll(): Promise<void> {
    const { storage, transport } = this.options;
    for (;;) {
      if (this.disposed) return;
      // Read again: another tab may have sent or added entries meanwhile.
      const list = await storage.list();
      this.entries = list;
      const head = list[0];
      if (head === undefined) {
        this.setOffline(false);
        return;
      }
      this.inFlight = head.id;
      try {
        await transport.send(head);
      } catch (error) {
        this.inFlight = null;
        if (transport.classify(error) === 'retry') {
          this.scheduleRetry();
          return;
        }
        await storage.delete(head.id);
        this.entries = this.entries.filter((entry) => entry.id !== head.id);
        this.emit();
        this.options.onRejected?.(head, error);
        continue;
      }
      this.inFlight = null;
      await storage.delete(head.id);
      this.entries = this.entries.filter((entry) => entry.id !== head.id);
      this.failures = 0;
      this.setOffline(false);
      this.options.onSent?.(head);
    }
  }

  private scheduleRetry(): void {
    this.failures += 1;
    const delay = Math.min(RETRY_MIN_MS * 2 ** (this.failures - 1), RETRY_MAX_MS);
    this.retryHandle = this.options.timer.set(() => {
      this.retryHandle = null;
      void this.flush();
    }, delay);
    this.setOffline(true);
  }

  private async runCatchUp(): Promise<void> {
    if (this.disposed) return;
    const { transport } = this.options;
    try {
      if (this.seq === null) {
        // A fresh tab: its screens load from the server, sync starts from now.
        this.seq = await transport.state();
        this.emit();
        return;
      }
      for (;;) {
        const page = await transport.changes(this.seq);
        const foreign = page.changes.filter(
          (change) => change.mutationId === null || !this.own.has(change.mutationId),
        );
        this.seq = page.seq;
        this.emit();
        if (foreign.length > 0) this.options.onRemote?.(foreign);
        // dispose() may run while waiting for the page (TypeScript cannot see that).
        if (!page.hasMore || this.isDisposed()) return;
      }
    } catch (error) {
      if (transport.classify(error) !== 'gone') return; // the next notice or timer tries again
      this.seq = await transport.state().catch(() => null);
      this.emit();
      this.options.onReset?.();
    }
  }

  private setOffline(offline: boolean): void {
    this.offline = offline;
    this.emit();
  }

  private emit(): void {
    const next: SyncStatus = {
      pending: this.entries.length,
      offline: this.offline,
      seq: this.seq,
    };
    const prev = this.status;
    if (prev.pending === next.pending && prev.offline === next.offline && prev.seq === next.seq) {
      return;
    }
    this.status = next;
    for (const listener of this.listeners) listener();
  }
}
