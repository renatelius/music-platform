import { MemoryOutbox, type OutboxEntry, type OutboxStorage, sortEntries } from '@mp/sync';
import { z } from 'zod';

const STORE = 'outbox';

const StoredEntry = z.object({
  id: z.string().min(1),
  createdAt: z.number(),
  op: z.looseObject({ type: z.enum(['library', 'playlist.create', 'settings', 'plays']) }),
});

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => {
      resolve(req.result);
    };
    req.onerror = () => {
      reject(req.error ?? new Error('IndexedDB request failed'));
    };
  });
}

/** The offline queue in IndexedDB: shared by the tabs of one user, survives reloads. */
class IdbOutbox implements OutboxStorage {
  constructor(private readonly db: IDBDatabase) {}

  async list(): Promise<OutboxEntry[]> {
    const raw: unknown = await request(this.db.transaction(STORE).objectStore(STORE).getAll());
    const entries = (Array.isArray(raw) ? raw : []).flatMap((item: unknown) => {
      const parsed = StoredEntry.safeParse(item);
      // Written by this app only; anything else (an older format) is skipped.
      return parsed.success ? [parsed.data as unknown as OutboxEntry] : [];
    });
    return sortEntries(entries);
  }

  async put(entry: OutboxEntry): Promise<void> {
    await request(this.db.transaction(STORE, 'readwrite').objectStore(STORE).put(entry));
  }

  async delete(id: string): Promise<void> {
    await request(this.db.transaction(STORE, 'readwrite').objectStore(STORE).delete(id));
  }
}

/**
 * Opens the queue of this user. Without IndexedDB (some private modes) it lives in memory:
 * changes still wait for the network, but not across a reload (`persistent: false`).
 */
export async function openOutbox(
  userId: string,
): Promise<{ storage: OutboxStorage; persistent: boolean }> {
  if (typeof indexedDB === 'undefined') return { storage: new MemoryOutbox(), persistent: false };
  try {
    const open = indexedDB.open(`remusic-sync:${userId}`, 1);
    open.onupgradeneeded = () => {
      if (!open.result.objectStoreNames.contains(STORE)) {
        open.result.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    const db = await request(open);
    return { storage: new IdbOutbox(db), persistent: true };
  } catch {
    return { storage: new MemoryOutbox(), persistent: false };
  }
}
