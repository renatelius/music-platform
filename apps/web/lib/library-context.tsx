'use client';

import type { PlaylistSummary } from '@mp/contracts';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';

import { useAuth } from './auth-context';
import { type SavedKind, SavedStore } from './library-store';
import { usePlayer } from './player-context';
import { hotkeyAction } from './player-store';
import { useSync, useSyncEvents, useSyncState } from './sync-context';

const SAVED_BY_ENTITY = {
  track_like: 'tracks',
  release_save: 'releases',
  artist_follow: 'artists',
} as const satisfies Record<string, SavedKind>;

/** A playlist created without network, shown until the server has it. */
export interface PendingPlaylist {
  readonly key: string;
  readonly name: string;
}

interface LibraryContextValue {
  readonly store: SavedStore;
  /** Null until loaded. */
  readonly playlists: readonly PlaylistSummary[] | null;
  readonly pendingPlaylists: readonly PendingPlaylist[];
  reloadPlaylists: () => void;
}

const LibraryContext = createContext<LibraryContextValue | null>(null);

/**
 * The signed-in user's library on this tab: what is liked, saved and followed (asked lazily,
 * one request per screen) and the list of playlists. Coming back to the tab asks again, so a
 * change made on another device shows up (I7a; live updates without that come in I7b).
 */
export function LibraryProvider({ children }: { children: ReactNode }) {
  const { client } = useAuth();
  const { engine } = useSync();
  const engineRef = useRef(engine);
  useEffect(() => {
    engineRef.current = engine;
  });
  // Changes go through the offline queue (I7b): the heart changes at once, the server later.
  const store = useMemo(
    () =>
      new SavedStore(
        (query) => client.libraryContains(query),
        (kind, id, saved) => {
          const queue = engineRef.current;
          return queue === null
            ? client.setInLibrary(kind, id, saved)
            : queue.enqueue({ type: 'library', kind, id, saved });
        },
      ),
    [client],
  );
  useEffect(() => {
    store.setOverlay((kind, id) => {
      let value: boolean | undefined;
      for (const { op } of engineRef.current?.pending() ?? []) {
        if (op.type === 'library' && op.kind === kind && op.id === id) value = op.saved;
      }
      return value;
    });
  }, [store]);
  const status = useSyncState();
  const [playlists, setPlaylists] = useState<readonly PlaylistSummary[] | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    client.playlists().then(
      (list) => {
        if (active) setPlaylists(list);
      },
      () => {
        // The menu shows "could not load" and offers to try again.
        if (active) setPlaylists((previous) => previous ?? []);
      },
    );
    return () => {
      active = false;
    };
  }, [client, attempt]);

  // L — like or unlike the playing track (same rules as the other player shortcuts).
  const { player } = usePlayer();
  useEffect(() => {
    if (player === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const target = event.target;
      const typing =
        target instanceof HTMLElement &&
        (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
      const action = hotkeyAction({
        key: event.key,
        shiftKey: event.shiftKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        altKey: event.altKey,
        target: typing ? 'text' : 'other',
      });
      const current = player.getState().current;
      if (action !== 'like' || current === null) return;
      event.preventDefault();
      store.toggle('tracks', current.track.id).catch(() => undefined);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [player, store]);

  const reloadPlaylists = useCallback(() => {
    setAttempt((n) => n + 1);
  }, []);

  // Changes from other devices and tabs, and what happened to this device's queued ones.
  useSyncEvents((event) => {
    switch (event.kind) {
      case 'changes': {
        let playlistsChanged = false;
        for (const change of event.changes) {
          if (change.entity === 'playlist' || change.entity === 'playlist_item') {
            playlistsChanged = true;
            continue;
          }
          if (change.entity === 'settings') continue;
          store.markSaved(SAVED_BY_ENTITY[change.entity], change.entityId, change.op === 'upsert');
        }
        if (playlistsChanged) reloadPlaylists();
        return;
      }
      case 'reset':
        store.refresh();
        reloadPlaylists();
        return;
      case 'sent':
        if (event.entry.op.type === 'playlist.create') reloadPlaylists();
        return;
      case 'rejected':
        if (event.entry.op.type === 'library') {
          const { kind, id, saved } = event.entry.op;
          store.rejected(kind, id, !saved);
        }
        if (event.entry.op.type === 'playlist.create') reloadPlaylists();
        return;
    }
  });

  const pendingPlaylists = useMemo(
    () =>
      status.pending === 0 || engine === null
        ? []
        : engine
            .pending()
            .flatMap((entry) =>
              entry.op.type === 'playlist.create' ? [{ key: entry.id, name: entry.op.name }] : [],
            ),
    [engine, status.pending],
  );

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      store.refresh();
      setAttempt((n) => n + 1);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [store]);

  const value = useMemo(
    () => ({ store, playlists, pendingPlaylists, reloadPlaylists }),
    [store, playlists, pendingPlaylists, reloadPlaylists],
  );
  return <LibraryContext.Provider value={value}>{children}</LibraryContext.Provider>;
}

export function useLibrary(): LibraryContextValue {
  const value = useContext(LibraryContext);
  if (value === null) throw new Error('useLibrary must be used inside LibraryProvider');
  return value;
}

/** Whether `id` is liked / saved / followed; undefined while unknown. */
export function useSaved(kind: SavedKind, id: string): boolean | undefined {
  const { store } = useLibrary();
  useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
  useEffect(() => {
    store.request(kind, id);
  }, [store, kind, id]);
  return store.get(kind, id);
}
