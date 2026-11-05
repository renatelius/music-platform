import { type ApiClient, ApiRequestError, NetworkError } from '@mp/api-client';
import type { FailureKind, OutboxEntry, SyncTransport, Timer } from '@mp/sync';

/**
 * Which failures are worth sending again: no network, a busy or restarting server, a session
 * being renewed. Anything else the server refused for good (deleted track, limit reached).
 */
export function classifySyncError(error: unknown): FailureKind {
  if (error instanceof NetworkError) return 'retry';
  if (error instanceof ApiRequestError) {
    if (error.status === 410) return 'gone';
    if ([401, 408, 425, 429].includes(error.status) || error.status >= 500) return 'retry';
    return 'reject';
  }
  return 'reject';
}

/** Sends queued changes with the entry id as the Idempotency-Key. */
export function createSyncTransport(client: ApiClient): SyncTransport {
  return {
    async send(entry: OutboxEntry): Promise<void> {
      const { op } = entry;
      switch (op.type) {
        case 'library':
          await client.setInLibrary(op.kind, op.id, op.saved, entry.id);
          return;
        case 'playlist.create':
          await client.createPlaylist({ name: op.name, description: op.description }, entry.id);
          return;
        case 'settings':
          await client.updateSettings(
            {
              ...(op.playback === undefined ? {} : { playback: op.playback }),
              ...(op.historyEnabled === undefined ? {} : { historyEnabled: op.historyEnabled }),
            },
            entry.id,
          );
          return;
        case 'plays':
          await client.recordPlays(op.events);
          return;
      }
    },
    changes: (since) => client.syncChanges(since),
    state: () => client.syncState(),
    classify: classifySyncError,
  };
}

export const browserTimer: Timer = {
  set: (run, ms) => window.setTimeout(run, ms),
  clear: (handle) => {
    if (typeof handle === 'number') window.clearTimeout(handle);
  },
};
