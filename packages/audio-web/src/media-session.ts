import type { Player, PlayerState } from '@mp/player-core';

export interface MediaSessionOptions {
  /** Cover images for the lock screen and system media controls. */
  readonly artwork?: (state: PlayerState) => MediaImage[];
  /** Step for the system "seek backward / forward" buttons. */
  readonly seekStepMs?: number;
}

/**
 * Connects the player to the Media Session API: metadata and controls on the lock screen,
 * keyboard media keys, headset buttons, Windows media overlay. Returns a function that unbinds.
 */
export function bindMediaSession(player: Player, options: MediaSessionOptions = {}): () => void {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return () => undefined;
  const session = navigator.mediaSession;
  const step = options.seekStepMs ?? 10_000;

  const actions: [MediaSessionAction, MediaSessionActionHandler][] = [
    [
      'play',
      () => {
        player.play();
      },
    ],
    [
      'pause',
      () => {
        player.pause();
      },
    ],
    [
      'stop',
      () => {
        player.stop();
      },
    ],
    [
      'previoustrack',
      () => {
        player.previous();
      },
    ],
    [
      'nexttrack',
      () => {
        player.next();
      },
    ],
    [
      'seekbackward',
      (details) => {
        player.seekBy(-(details.seekOffset ?? step / 1000) * 1000);
      },
    ],
    [
      'seekforward',
      (details) => {
        player.seekBy((details.seekOffset ?? step / 1000) * 1000);
      },
    ],
    [
      'seekto',
      (details) => {
        if (details.seekTime !== undefined) player.seek(details.seekTime * 1000);
      },
    ],
  ];
  for (const [action, handler] of actions) {
    try {
      session.setActionHandler(action, handler);
    } catch {
      // The browser does not support this action.
    }
  }

  let currentUid: string | null = null;
  const sync = (state: PlayerState) => {
    const entry = state.current;
    if (entry?.uid !== currentUid) {
      currentUid = entry?.uid ?? null;
      session.metadata =
        entry === null
          ? null
          : new MediaMetadata({
              title: entry.track.title,
              artist: entry.track.artists.map((artist) => artist.name).join(', '),
              album: entry.track.release.title,
              artwork: options.artwork?.(state) ?? [],
            });
    }
    session.playbackState =
      state.status === 'playing' || state.status === 'loading'
        ? 'playing'
        : entry === null
          ? 'none'
          : 'paused';
    const duration = player.durationMs() / 1000;
    if (duration > 0) {
      try {
        session.setPositionState({
          duration,
          playbackRate: 1,
          position: Math.min(player.positionMs() / 1000, duration),
        });
      } catch {
        // Position outside the duration while a track changes.
      }
    }
  };
  sync(player.getState());
  const unsubscribe = player.subscribe(sync);

  return () => {
    unsubscribe();
    for (const [action] of actions) {
      try {
        session.setActionHandler(action, null);
      } catch {
        // Not supported.
      }
    }
    session.metadata = null;
    session.playbackState = 'none';
  };
}
