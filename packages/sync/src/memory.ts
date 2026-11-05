import type { OutboxEntry, OutboxStorage } from './types.js';

/** Queue kept in memory only (tests; browsers without IndexedDB). Lost on reload. */
export class MemoryOutbox implements OutboxStorage {
  private readonly entries = new Map<string, OutboxEntry>();

  list(): Promise<OutboxEntry[]> {
    return Promise.resolve(sortEntries([...this.entries.values()]));
  }

  put(entry: OutboxEntry): Promise<void> {
    this.entries.set(entry.id, entry);
    return Promise.resolve();
  }

  delete(id: string): Promise<void> {
    this.entries.delete(id);
    return Promise.resolve();
  }
}

/** Oldest first; same time — by id (ids are time-ordered UUIDs or random, both stable). */
export function sortEntries(entries: OutboxEntry[]): OutboxEntry[] {
  return entries.sort(
    (a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}
