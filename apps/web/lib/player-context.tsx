'use client';

import { ApiRequestError } from '@mp/api-client';
import { bindMediaSession, browserCanPlay, WebAudioEngine } from '@mp/audio-web';
import {
  createStreamResolver,
  DEFAULT_PLAYER_SETTINGS,
  Player,
  type PlayerState,
  type QueueTrack,
  type SleepMode,
  SleepTimer,
  type SleepTimerState,
} from '@mp/player-core';
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

import { useAuth, useSession } from './auth-context';
import { PlayTracker } from './play-history';
import {
  decodeSnapshot,
  DEFAULT_WEB_SETTINGS,
  encodeSnapshot,
  fromPlaybackSettings,
  hotkeyAction,
  type HotkeyTarget,
  mergeSettings,
  parseSettings,
  sameSettings,
  sessionKey,
  SETTINGS_KEY,
  toPlaybackSettings,
  toPlayerSettings,
  type WebPlayerSettings,
} from './player-store';
import { useSync } from './sync-context';
import { createTabCoordinator } from './tab-sync';

interface Instance {
  readonly player: Player;
  readonly engine: WebAudioEngine;
  readonly sleep: SleepTimer;
}

interface PlayerContextValue {
  /** Null for the first render, until the engine is created on the client. */
  readonly player: Player | null;
  /** Sleep timer of this tab (null on the first render). */
  readonly sleep: SleepTimer | null;
  readonly settings: WebPlayerSettings;
  updateSettings: (patch: Partial<WebPlayerSettings>) => void;
  /**
   * From a click: starts `tracks` at `index`. `shuffle: true` without an index starts at a
   * random track.
   */
  playTracks: (
    tracks: readonly QueueTrack[],
    index?: number,
    options?: { shuffle?: boolean },
  ) => void;
  togglePlay: () => void;
  jumpTo: (index: number) => void;
}

const PlayerContext = createContext<PlayerContextValue | null>(null);
const SAVE_INTERVAL_MS = 5000;
/** Sliders change settings many times a second: the account gets the value they stop at. */
const SETTINGS_UPLOAD_DELAY_MS = 800;
/** Sleep-timer resolution; background tabs may tick only once a second (the timer copes). */
const SLEEP_TICK_MS = 250;

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Private mode or a full storage: the session is simply not kept.
  }
}

function targetKind(target: EventTarget | null): HotkeyTarget {
  if (!(target instanceof HTMLElement)) return 'other';
  if (target.isContentEditable) return 'text';
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return 'text';
  if (tag === 'BUTTON' || tag === 'A' || target.getAttribute('role') === 'option') return 'button';
  return 'other';
}

/**
 * One player per signed-in user and tab (ADR-019): Web Audio engine, catalog source resolver,
 * Media Session, keyboard shortcuts, and the queue saved per account on this device.
 */
export function PlayerProvider({ children }: { children: ReactNode }) {
  const { client } = useAuth();
  const { user } = useSession();
  const [instance, setInstance] = useState<Instance | null>(null);
  const [settings, setSettings] = useState<WebPlayerSettings>(DEFAULT_WEB_SETTINGS);
  const settingsRef = useRef(settings);
  const { engine: sync, settings: account } = useSync();
  const syncRef = useRef(sync);
  // History on by default; the account setting (and its unsent change) decides.
  const historyRef = useRef(true);
  useEffect(() => {
    syncRef.current = sync;
    historyRef.current = account?.historyEnabled ?? true;
  });

  useEffect(() => {
    const stored = parseSettings(readStorage(SETTINGS_KEY));
    settingsRef.current = stored;
    const engine = new WebAudioEngine();
    engine.setEqualizer(stored.eqGains);
    engine.setEqualizerEnabled(stored.eqEnabled);
    engine.setBalance(stored.balance);
    const resolver = createStreamResolver({
      fetchStream: (id) => client.trackStream(id),
      mediaUrl: (path) => client.mediaUrl(path),
      canPlay: browserCanPlay,
      preference: () => settingsRef.current.quality,
      isNotFound: (error) =>
        error instanceof ApiRequestError && (error.status === 404 || error.status === 422),
    });
    const player = new Player({ engine, resolver, settings: toPlayerSettings(stored) });
    const sleep = new SleepTimer({
      player,
      fade: (gain) => {
        engine.setFade(gain);
      },
    });
    const sleepTicker = setInterval(() => {
      sleep.tick();
    }, SLEEP_TICK_MS);

    const key = sessionKey(user.id);
    const saved = decodeSnapshot(readStorage(key));
    // Device settings win over the ones saved with the session.
    if (saved !== null && player.restore(saved)) player.setSettings(toPlayerSettings(stored));
    const save = () => {
      writeStorage(key, encodeSnapshot(player.snapshot()));
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') save();
    };
    const timer = setInterval(save, SAVE_INTERVAL_MS);
    window.addEventListener('pagehide', save);
    document.addEventListener('visibilitychange', onVisibility);
    const unbindMediaSession = bindMediaSession(player);

    // Listening history (I7b): one report per queue entry, sent through the offline queue.
    const tracker = new PlayTracker(
      (event) => {
        if (historyRef.current) void syncRef.current?.enqueue({ type: 'plays', events: [event] });
      },
      Date.now,
      () => crypto.randomUUID(),
    );
    const unsubscribeTracker = player.subscribe((state) => {
      tracker.update(state);
    });
    const endPlay = () => {
      tracker.flush();
    };
    window.addEventListener('pagehide', endPlay);

    // One playing tab per account in this browser (B4): starting here pauses the others.
    let unbindTabs: () => void = () => undefined;
    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel('remusic.player.v1');
      const tabs = createTabCoordinator({
        channel,
        tabId: crypto.randomUUID(),
        userId: user.id,
        onOtherTabPlaying: () => {
          const { status } = player.getState();
          if (status === 'playing' || status === 'loading') player.pause();
        },
      });
      let wasPlaying = false;
      const unsubscribe = player.subscribe((state) => {
        const playing = state.status === 'playing';
        if (playing && !wasPlaying) tabs.announcePlaying();
        wasPlaying = playing;
      });
      unbindTabs = () => {
        unsubscribe();
        tabs.dispose();
        channel.close();
      };
    }

    setSettings(stored);
    setInstance({ player, engine, sleep });
    return () => {
      clearInterval(timer);
      clearInterval(sleepTicker);
      sleep.dispose();
      window.removeEventListener('pagehide', save);
      window.removeEventListener('pagehide', endPlay);
      document.removeEventListener('visibilitychange', onVisibility);
      tracker.flush();
      unsubscribeTracker();
      save();
      unbindMediaSession();
      unbindTabs();
      player.dispose();
      setInstance(null);
    };
  }, [client, user.id]);

  useEffect(() => {
    if (instance === null) return;
    const { player, engine } = instance;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || player.getState().current === null) return;
      const action = hotkeyAction({
        key: event.key,
        shiftKey: event.shiftKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        altKey: event.altKey,
        target: targetKind(event.target),
      });
      // The library handles «like» (LibraryProvider): it knows what is liked.
      if (action === null || action === 'like') return;
      event.preventDefault();
      switch (action) {
        case 'toggle':
          engine.unlock();
          player.togglePlay();
          return;
        case 'back':
          player.seekBy(-10_000);
          return;
        case 'forward':
          player.seekBy(10_000);
          return;
        case 'previous':
          player.previous();
          return;
        case 'next':
          player.next();
          return;
        case 'mute':
          player.setMuted(!player.getState().muted);
          return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [instance]);

  /** Applies settings on this device only. */
  const applySettings = useCallback(
    (next: WebPlayerSettings) => {
      settingsRef.current = next;
      setSettings(next);
      writeStorage(SETTINGS_KEY, JSON.stringify(next));
      if (instance === null) return;
      instance.engine.setEqualizer(next.eqGains);
      instance.engine.setEqualizerEnabled(next.eqEnabled);
      instance.engine.setBalance(next.balance);
      // Also re-prepares the next track, so a new quality applies from the next track on.
      instance.player.setSettings(toPlayerSettings(next));
    },
    [instance],
  );

  // The account keeps playback settings for every device (I7b).
  const uploadTimer = useRef<number | null>(null);
  const upload = useCallback(() => {
    uploadTimer.current = null;
    const playback = toPlaybackSettings(settingsRef.current);
    if (playback !== null) void syncRef.current?.enqueue({ type: 'settings', playback });
  }, []);
  useEffect(
    () => () => {
      if (uploadTimer.current === null) return;
      window.clearTimeout(uploadTimer.current);
      upload();
    },
    [upload],
  );

  const uploaded = useRef(false);
  useEffect(() => {
    if (account === null || sync === null || instance === null) return;
    if (account.playback === null) {
      // Never saved in the account: this device's settings become the account's.
      if (!uploaded.current) {
        uploaded.current = true;
        upload();
      }
      return;
    }
    if (uploadTimer.current !== null) return; // a local change is about to be sent
    const next = fromPlaybackSettings(settingsRef.current, account.playback);
    if (!sameSettings(next, settingsRef.current)) applySettings(next);
  }, [account, sync, instance, applySettings, upload]);

  const updateSettings = useCallback(
    (patch: Partial<WebPlayerSettings>) => {
      applySettings(mergeSettings(settingsRef.current, patch));
      if (uploadTimer.current !== null) window.clearTimeout(uploadTimer.current);
      uploadTimer.current = window.setTimeout(upload, SETTINGS_UPLOAD_DELAY_MS);
    },
    [applySettings, upload],
  );

  const playTracks = useCallback(
    (tracks: readonly QueueTrack[], index?: number, options?: { shuffle?: boolean }) => {
      if (instance === null || tracks.length === 0) return;
      instance.engine.unlock();
      const shuffle = options?.shuffle;
      if (shuffle !== undefined) instance.player.setShuffle(shuffle);
      const start = index ?? (shuffle === true ? Math.floor(Math.random() * tracks.length) : 0);
      instance.player.playTracks(tracks, start);
    },
    [instance],
  );

  const togglePlay = useCallback(() => {
    if (instance === null) return;
    instance.engine.unlock();
    instance.player.togglePlay();
  }, [instance]);

  const jumpTo = useCallback(
    (index: number) => {
      if (instance === null) return;
      instance.engine.unlock();
      instance.player.jumpTo(index);
    },
    [instance],
  );

  const value = useMemo(
    () => ({
      player: instance?.player ?? null,
      sleep: instance?.sleep ?? null,
      settings,
      updateSettings,
      playTracks,
      togglePlay,
      jumpTo,
    }),
    [instance, settings, updateSettings, playTracks, togglePlay, jumpTo],
  );
  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}

export function usePlayer(): PlayerContextValue {
  const value = useContext(PlayerContext);
  if (value === null) throw new Error('usePlayer must be used inside PlayerProvider');
  return value;
}

const IDLE_STATE: PlayerState = {
  status: 'idle',
  current: null,
  index: -1,
  queue: [],
  shuffle: false,
  repeat: 'off',
  volume: 1,
  muted: false,
  source: null,
  buffering: false,
  error: null,
  settings: DEFAULT_PLAYER_SETTINGS,
};

export function usePlayerState(): PlayerState {
  const { player } = usePlayer();
  const subscribe = useCallback(
    (onChange: () => void) => (player === null ? () => undefined : player.subscribe(onChange)),
    [player],
  );
  const getSnapshot = useCallback(() => player?.getState() ?? IDLE_STATE, [player]);
  return useSyncExternalStore(subscribe, getSnapshot, () => IDLE_STATE);
}

const SLEEP_OFF: SleepTimerState = { mode: null, endsAt: null };

/** Sleep timer state and time left (ms), refreshed every second while it runs. */
export function useSleepTimer(): {
  readonly mode: SleepMode | null;
  readonly remainingMs: number | null;
  start: (mode: SleepMode) => void;
  cancel: () => void;
} {
  const { sleep } = usePlayer();
  const subscribe = useCallback(
    (onChange: () => void) => (sleep === null ? () => undefined : sleep.subscribe(onChange)),
    [sleep],
  );
  // Keep the last snapshot while mode and end time are unchanged: useSyncExternalStore loops
  // forever on a fresh object per read (the core timer is stable too; this guards older builds).
  const cached = useRef<SleepTimerState>(SLEEP_OFF);
  const getSnapshot = useCallback(() => {
    const next = sleep?.getState() ?? SLEEP_OFF;
    const prev = cached.current;
    if (next.mode === prev.mode && next.endsAt === prev.endsAt) return prev;
    cached.current = next;
    return next;
  }, [sleep]);
  const state = useSyncExternalStore(subscribe, getSnapshot, () => SLEEP_OFF);
  const [remainingMs, setRemaining] = useState<number | null>(null);
  useEffect(() => {
    if (sleep === null) return;
    const update = () => {
      setRemaining(sleep.remainingMs());
    };
    update();
    if (state.mode === null) return;
    const timer = setInterval(update, 1000);
    return () => {
      clearInterval(timer);
    };
  }, [sleep, state]);
  const start = useCallback((mode: SleepMode) => sleep?.start(mode), [sleep]);
  const cancel = useCallback(() => sleep?.cancel(), [sleep]);
  return { mode: state.mode, remainingMs: state.mode === null ? null : remainingMs, start, cancel };
}

/** True while sound plays or is about to (the play button shows «pause»). */
export function isActive(state: PlayerState): boolean {
  return state.status === 'playing' || state.status === 'loading';
}

/** Playback position in ms, refreshed four times a second while playing. */
export function usePosition(): number {
  const { player } = usePlayer();
  const state = usePlayerState();
  const [position, setPosition] = useState(0);
  useEffect(() => {
    if (player === null) return;
    const update = () => {
      setPosition(player.positionMs());
    };
    update();
    if (state.status !== 'playing') return;
    const timer = setInterval(update, 250);
    return () => {
      clearInterval(timer);
    };
  }, [player, state]);
  return position;
}
