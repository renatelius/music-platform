// Which tracks, releases and artists are in the user's library, for hearts and "Saved" buttons
// (I7a). Plain TypeScript: the React provider wraps it, tests drive it directly.

export type SavedKind = 'tracks' | 'releases' | 'artists';
export type ContainsQuery = Record<SavedKind, string[]>;
export type ContainsFn = (query: ContainsQuery) => Promise<ContainsQuery>;
export type SetFn = (kind: SavedKind, id: string, saved: boolean) => Promise<unknown>;
/** A change of this device not yet accepted by the server: it wins over what the server says. */
export type OverlayFn = (kind: SavedKind, id: string) => boolean | undefined;

/** The API answers at most this many ids of each kind per request. */
export const CONTAINS_BATCH = 100;
const KINDS: readonly SavedKind[] = ['tracks', 'releases', 'artists'];

const emptyQuery = (): ContainsQuery => ({ tracks: [], releases: [], artists: [] });
const keyOf = (kind: SavedKind, id: string) => `${kind}:${id}`;

/**
 * Known state per id, filled lazily: `request` collects unknown ids and asks the server once
 * per tick (≤ 100 of each kind per call). `toggle` changes the state at once and rolls it back
 * when the server refuses.
 */
export class SavedStore {
  private readonly known = new Map<string, boolean>();
  /** Changes the server refused (shown as an error on the button until the next try). */
  private readonly failed = new Set<string>();
  private overlay: OverlayFn = () => undefined;
  private readonly pending = new Set<string>();
  private queued: ContainsQuery = emptyQuery();
  private flushScheduled = false;
  private readonly listeners = new Set<() => void>();
  private version = 0;

  constructor(
    private readonly contains: ContainsFn,
    private readonly send: SetFn,
    private readonly schedule: (run: () => void) => void = (run) => {
      setTimeout(run, 0);
    },
  ) {}

  /** For useSyncExternalStore: changes whenever any known state changes. */
  snapshot = (): number => this.version;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  get(kind: SavedKind, id: string): boolean | undefined {
    return this.known.get(keyOf(kind, id));
  }

  hasFailed(kind: SavedKind, id: string): boolean {
    return this.failed.has(keyOf(kind, id));
  }

  setOverlay(overlay: OverlayFn): void {
    this.overlay = overlay;
  }

  /** The server refused a change sent later (offline queue): back to `saved`, marked failed. */
  rejected(kind: SavedKind, id: string, saved: boolean): void {
    const key = keyOf(kind, id);
    this.failed.add(key);
    this.known.set(key, saved);
    this.emit();
  }

  /** Asks the server about `id` unless its state is known or already asked for. */
  request(kind: SavedKind, id: string): void {
    const key = keyOf(kind, id);
    if (this.known.has(key) || this.pending.has(key)) return;
    this.pending.add(key);
    this.queued[kind].push(id);
    this.scheduleFlush();
  }

  /** Asks again about everything known (the tab came back: another device may have changed it). */
  refresh(): void {
    for (const key of this.known.keys()) {
      const [kind, id] = key.split(':') as [SavedKind, string];
      if (this.pending.has(key)) continue;
      this.pending.add(key);
      this.queued[kind].push(id);
    }
    this.scheduleFlush();
  }

  async toggle(kind: SavedKind, id: string): Promise<boolean> {
    const key = keyOf(kind, id);
    const before = this.known.get(key) ?? false;
    const next = !before;
    if (this.failed.delete(key)) this.emit();
    this.set(key, next);
    try {
      await this.send(kind, id, next);
    } catch (error) {
      this.set(key, before);
      throw error;
    }
    return next;
  }

  /** Marks ids as saved without asking (e.g. a track just added to the library elsewhere). */
  markSaved(kind: SavedKind, id: string, saved: boolean): void {
    this.set(keyOf(kind, id), saved);
  }

  private set(key: string, value: boolean): void {
    if (this.known.get(key) === value) return;
    this.known.set(key, value);
    this.emit();
  }

  private emit(): void {
    this.version += 1;
    for (const listener of this.listeners) listener();
  }

  private scheduleFlush(): void {
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    this.schedule(() => {
      this.flushScheduled = false;
      void this.flush();
    });
  }

  private async flush(): Promise<void> {
    const queued = this.queued;
    this.queued = emptyQuery();
    const batches: ContainsQuery[] = [];
    for (const kind of KINDS) {
      queued[kind].forEach((id, index) => {
        const batch = Math.floor(index / CONTAINS_BATCH);
        const target = (batches[batch] ??= emptyQuery());
        target[kind].push(id);
      });
    }
    await Promise.all(batches.map((batch) => this.ask(batch)));
  }

  private async ask(batch: ContainsQuery): Promise<void> {
    let answer: ContainsQuery | null = null;
    try {
      answer = await this.contains(batch);
    } catch {
      // Unknown stays unknown: the button shows "not saved" and the next request asks again.
    }
    let changed = false;
    for (const kind of KINDS) {
      const saved = new Set(answer?.[kind] ?? []);
      for (const id of batch[kind]) {
        const key = keyOf(kind, id);
        this.pending.delete(key);
        if (answer === null) continue;
        const value = this.overlay(kind, id) ?? saved.has(id);
        if (this.known.get(key) !== value) {
          this.known.set(key, value);
          changed = true;
        }
      }
    }
    if (changed) this.emit();
  }
}
