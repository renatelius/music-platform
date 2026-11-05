'use client';

import type { SyncChange, UserSettings } from '@mp/contracts';
import {
  LiveChannel,
  type OutboxEntry,
  type SocketLike,
  SyncEngine,
  type SyncStatus,
} from '@mp/sync';
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

import { createWebLock, useAuth, useSession } from './auth-context';
import { openOutbox } from './outbox-idb';
import { browserTimer, createSyncTransport } from './sync-transport';

/** What the rest of the app hears from sync. */
export type SyncEvent =
  | { readonly kind: 'changes'; readonly changes: readonly SyncChange[] }
  /** The change log no longer covers this tab: reload everything shown. */
  | { readonly kind: 'reset' }
  | { readonly kind: 'sent'; readonly entry: OutboxEntry }
  | { readonly kind: 'rejected'; readonly entry: OutboxEntry; readonly error: unknown };

type SyncListener = (event: SyncEvent) => void;

interface SyncContextValue {
  /** Null until the queue is opened (a moment after sign-in). */
  readonly engine: SyncEngine | null;
  /** False when the browser cannot keep the queue across reloads. */
  readonly persistent: boolean;
  /** Account settings with this device's unsent changes on top; null until loaded. */
  readonly settings: UserSettings | null;
  setHistoryEnabled: (enabled: boolean) => void;
  subscribe: (listener: SyncListener) => () => void;
}

const SyncContext = createContext<SyncContextValue | null>(null);

/** Without the live channel, ask for news this often. */
const POLL_MS = 60_000;

const IDLE: SyncStatus = { pending: 0, offline: false, seq: null };

/** Where the live channel is: through the web app's proxy unless configured otherwise. */
function socketUrl(ticket: string): string {
  const base =
    process.env.NEXT_PUBLIC_WS_URL ??
    `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/api/ws`;
  return `${base}?ticket=${encodeURIComponent(ticket)}`;
}

function openSocket(ticket: string): SocketLike {
  const ws = new WebSocket(socketUrl(ticket));
  const socket: SocketLike = {
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
    close: (code, reason) => {
      ws.close(code, reason);
    },
  };
  ws.onopen = () => socket.onopen?.();
  ws.onmessage = (event: MessageEvent) => socket.onmessage?.({ data: event.data as unknown });
  ws.onclose = (event) => socket.onclose?.({ code: event.code });
  ws.onerror = () => socket.onerror?.();
  return socket;
}

/** Waiting settings changes of this device, merged in queue order. */
function withPending(settings: UserSettings, pending: readonly OutboxEntry[]): UserSettings {
  let result = settings;
  for (const { op } of pending) {
    if (op.type !== 'settings') continue;
    result = {
      ...result,
      ...(op.playback === undefined ? {} : { playback: op.playback }),
      ...(op.historyEnabled === undefined ? {} : { historyEnabled: op.historyEnabled }),
    };
  }
  return result;
}

/**
 * Synchronization of the signed-in user (I7b, ADR-020): the offline queue in IndexedDB, the
 * live channel (WebSocket through `/api/ws`) and catching up on the change log; also the
 * account settings everything else reads.
 */
export function SyncProvider({ children }: { children: ReactNode }) {
  const { client } = useAuth();
  const { user } = useSession();
  const [opened, setOpened] = useState<{ engine: SyncEngine; persistent: boolean } | null>(null);
  const [serverSettings, setServerSettings] = useState<UserSettings | null>(null);
  const listeners = useRef(new Set<SyncListener>());

  const emit = useCallback((event: SyncEvent) => {
    for (const listener of listeners.current) listener(event);
  }, []);

  useEffect(() => {
    let disposed = false;
    let engine: SyncEngine | null = null;
    let live: LiveChannel | null = null;
    let unobserve: () => void = () => undefined;

    const loadSettings = () => {
      client.settings().then(
        (settings) => {
          if (!disposed) setServerSettings(settings);
        },
        () => {
          // Offline: the defaults stay until the next change notice or reload.
          if (!disposed) {
            setServerSettings(
              (previous) => previous ?? { playback: null, historyEnabled: true, updatedAt: null },
            );
          }
        },
      );
    };
    loadSettings();

    void openOutbox(user.id).then(({ storage, persistent }) => {
      if (disposed) return;
      const created = new SyncEngine({
        storage,
        transport: createSyncTransport(client),
        timer: browserTimer,
        newId: () => crypto.randomUUID(),
        now: Date.now,
        lock: createWebLock(),
        lockName: `remusic-sync-outbox:${user.id}`,
        onRemote: (changes) => {
          emit({ kind: 'changes', changes });
          if (changes.some((change) => change.entity === 'settings')) loadSettings();
        },
        onReset: () => {
          emit({ kind: 'reset' });
          loadSettings();
        },
        onSent: (entry) => {
          emit({ kind: 'sent', entry });
        },
        onRejected: (entry, error) => {
          emit({ kind: 'rejected', entry, error });
          if (entry.op.type === 'settings') loadSettings();
        },
      });
      engine = created;
      unobserve = client.observeMutations((key) => {
        created.remember(key);
      });
      live = new LiveChannel({
        ticket: async () => (await client.wsTicket()).ticket,
        open: openSocket,
        timer: browserTimer,
        onSeq: (seq) => {
          created.notify(seq);
        },
        onConnected: (connected) => {
          if (connected) created.online();
        },
      });
      setOpened({ engine: created, persistent });
      void created.start();
      live.start();
    });

    const onOnline = () => {
      engine?.online();
      live?.reconnectNow();
    };
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      void engine?.catchUp();
      live?.reconnectNow();
    };
    const poll = window.setInterval(() => {
      if (engine === null || live?.isConnected === true) return;
      void engine.catchUp();
      void engine.flush();
    }, POLL_MS);
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      disposed = true;
      window.clearInterval(poll);
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
      unobserve();
      live?.stop();
      engine?.dispose();
      setOpened(null);
    };
  }, [client, user.id, emit]);

  const engine = opened?.engine ?? null;
  const status = useSyncStatus(engine);
  // `status.pending` changes whenever the queue does, so the overlay follows it.
  const settings = useMemo(
    () =>
      serverSettings === null || engine === null || status.pending === 0
        ? serverSettings
        : withPending(serverSettings, engine.pending()),
    [serverSettings, engine, status.pending],
  );

  const setHistoryEnabled = useCallback(
    (enabled: boolean) => {
      if (engine !== null) void engine.enqueue({ type: 'settings', historyEnabled: enabled });
    },
    [engine],
  );

  const subscribe = useCallback((listener: SyncListener) => {
    const set = listeners.current;
    set.add(listener);
    return () => {
      set.delete(listener);
    };
  }, []);

  const value = useMemo(
    () => ({
      engine,
      persistent: opened?.persistent ?? true,
      settings,
      setHistoryEnabled,
      subscribe,
    }),
    [engine, opened, settings, setHistoryEnabled, subscribe],
  );
  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

export function useSync(): SyncContextValue {
  const value = useContext(SyncContext);
  if (value === null) throw new Error('useSync must be used inside SyncProvider');
  return value;
}

function useSyncStatus(engine: SyncEngine | null): SyncStatus {
  const subscribe = useCallback(
    (onChange: () => void) => (engine === null ? () => undefined : engine.subscribe(onChange)),
    [engine],
  );
  const getSnapshot = useCallback(() => engine?.getStatus() ?? IDLE, [engine]);
  return useSyncExternalStore(subscribe, getSnapshot, () => IDLE);
}

/** Pending count and «no network» for the banner. */
export function useSyncState(): SyncStatus {
  return useSyncStatus(useSync().engine);
}

/** Calls `listener` for every sync event while the component is shown. */
export function useSyncEvents(listener: SyncListener): void {
  const { subscribe } = useSync();
  const ref = useRef(listener);
  useEffect(() => {
    ref.current = listener;
  });
  useEffect(
    () =>
      subscribe((event) => {
        ref.current(event);
      }),
    [subscribe],
  );
}
