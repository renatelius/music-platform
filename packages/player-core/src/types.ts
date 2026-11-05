/** What the player needs to know about a track (a catalog TrackDto fits). */
export interface QueueTrack {
  readonly id: string;
  readonly title: string;
  readonly durationMs: number;
  readonly artists: readonly { readonly id: string; readonly name: string }[];
  readonly release: { readonly id: string; readonly title: string };
}

export type RepeatMode = 'off' | 'all' | 'one';

/** A track in the queue. The same track may be queued twice: `uid` tells them apart. */
export interface QueueEntry {
  readonly uid: string;
  readonly track: QueueTrack;
}

/** How the next track takes over from the current one. */
export type Transition =
  { readonly kind: 'gapless' } | { readonly kind: 'crossfade'; readonly durationMs: number };

/** One track handed to an audio engine. `key` is unique per load, even for a repeated track. */
export interface EngineTrack {
  readonly key: string;
  readonly url: string;
  readonly mimeType: string;
  readonly durationMs: number;
  /** ReplayGain to apply, already limited so the true peak stays below the ceiling. */
  readonly gainDb: number;
}

/**
 * `source`: the file could not be fetched (network, expired link) — a fresh link may help.
 * `decode`: the file itself cannot be played.
 */
export type EngineErrorReason = 'source' | 'decode';

export type EngineEvent =
  | { readonly type: 'playing'; readonly key: string }
  | { readonly type: 'paused'; readonly key: string }
  | { readonly type: 'buffering'; readonly key: string }
  /** The prepared next track started by itself (gapless or crossfade). */
  | { readonly type: 'transitioned'; readonly key: string }
  /** The current track finished and nothing was prepared. */
  | { readonly type: 'ended'; readonly key: string }
  | { readonly type: 'error'; readonly key: string; readonly reason: EngineErrorReason };

/**
 * Platform audio adapter (ADR-010): audio-web for browsers and Windows, audio-native later.
 * The engine owns timing-critical work — the automatic transition to the prepared track —
 * so it can be sample-accurate; the player owns everything else.
 */
export interface AudioEngine {
  /** Replaces whatever is loaded. */
  load(track: EngineTrack, positionMs: number, autoplay: boolean): void;
  /** Track to start automatically when the current one ends; null: stop at the end. */
  prepareNext(track: EngineTrack | null, transition: Transition): void;
  play(): void;
  pause(): void;
  seek(positionMs: number): void;
  /** Unloads everything. */
  stop(): void;
  /** 0..1, linear slider position (the engine applies a perceptual curve). */
  setVolume(volume: number): void;
  setMuted(muted: boolean): void;
  /** New ReplayGain for a loaded or prepared track. */
  setGain(key: string, gainDb: number): void;
  positionMs(): number;
  subscribe(listener: (event: EngineEvent) => void): () => void;
  dispose(): void;
}
