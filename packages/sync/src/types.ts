import type { PlaybackSettings, PlayEvent, SyncChangesPage } from '@mp/contracts';

// Ports of the sync engine: storage, transport, timers. Every platform brings its own
// (IndexedDB + fetch in the web app, SQLite + native networking on mobile, fakes in tests).

export type SavedKind = 'tracks' | 'releases' | 'artists';

/** A change waiting to be sent. Plain data: it survives a reload of the app. */
export type OutboxOp =
  | {
      readonly type: 'library';
      readonly kind: SavedKind;
      readonly id: string;
      readonly saved: boolean;
    }
  | { readonly type: 'playlist.create'; readonly name: string; readonly description: string | null }
  | {
      readonly type: 'settings';
      readonly playback?: PlaybackSettings;
      readonly historyEnabled?: boolean;
    }
  | { readonly type: 'plays'; readonly events: readonly PlayEvent[] };

export interface OutboxEntry {
  /** Also the Idempotency-Key: a resent entry is applied by the server only once. */
  readonly id: string;
  readonly op: OutboxOp;
  /** Milliseconds since the epoch; the queue is sent oldest first. */
  readonly createdAt: number;
}

/** Shared by all tabs of one user on a device. */
export interface OutboxStorage {
  /** Oldest first. */
  list(): Promise<OutboxEntry[]>;
  put(entry: OutboxEntry): Promise<void>;
  delete(id: string): Promise<void>;
}

/** `retry`: no network, server busy, session being renewed. `reject`: the server refused it. */
export type FailureKind = 'retry' | 'reject' | 'gone';

export interface SyncTransport {
  send(entry: OutboxEntry): Promise<void>;
  changes(since: number): Promise<SyncChangesPage>;
  /** Current version of the library. */
  state(): Promise<number>;
  classify(error: unknown): FailureKind;
}

export interface Timer {
  set(run: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

/** Runs `run` exclusively across tabs (Web Locks in browsers). */
export type LockFn = <T>(name: string, run: () => Promise<T>) => Promise<T>;
