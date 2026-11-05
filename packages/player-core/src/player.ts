import type { StreamSource } from '@mp/contracts';

import { PlayQueue, type QueueSnapshot } from './queue.js';
import {
  NotPlayableError,
  type ReplayGainSettings,
  replayGainDb,
  type ResolvedSource,
  type SourceResolver,
} from './source.js';
import type {
  AudioEngine,
  EngineEvent,
  EngineTrack,
  QueueEntry,
  QueueTrack,
  RepeatMode,
  Transition,
} from './types.js';

/**
 * - `idle`: nothing queued;
 * - `loading`: fetching the link or the first bytes;
 * - `paused`: a track is selected but not sounding (also after the end of the queue);
 * - `error`: playback stopped; `error` says why, `play()` tries again.
 */
export type PlayerStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'error';

/** `unavailable`: the server or network failed. `not_playable`: nothing in the queue plays. */
export type PlayerError = 'unavailable' | 'not_playable';

export interface PlayerSettings {
  /** 0 = gapless. */
  readonly crossfadeMs: number;
  /** Tracks of the same release always join gapless (live albums, DJ mixes, classical). */
  readonly gaplessAlbums: boolean;
  readonly replayGain: ReplayGainSettings;
}

export const DEFAULT_PLAYER_SETTINGS: PlayerSettings = {
  crossfadeMs: 0,
  gaplessAlbums: true,
  replayGain: { mode: 'track', preampDb: 0 },
};

export const MAX_CROSSFADE_MS = 12_000;
/** "Previous" restarts the track when it has played longer than this. */
export const RESTART_THRESHOLD_MS = 3000;
/** After this many unplayable tracks in a row the player stops instead of skipping on. */
export const MAX_SKIPS_IN_A_ROW = 5;

export interface PlayerState {
  readonly status: PlayerStatus;
  readonly current: QueueEntry | null;
  /** Position of `current` in `queue`. */
  readonly index: number;
  /** Play order. */
  readonly queue: readonly QueueEntry[];
  readonly shuffle: boolean;
  readonly repeat: RepeatMode;
  readonly volume: number;
  readonly muted: boolean;
  /** The rendition that is playing (for the quality label). */
  readonly source: StreamSource | null;
  /** Playing, but waiting for data. */
  readonly buffering: boolean;
  readonly error: PlayerError | null;
  readonly settings: PlayerSettings;
}

export interface PlayerSnapshot {
  /** Format of the snapshot; only 1 exists. */
  readonly version: number;
  readonly queue: QueueSnapshot;
  readonly positionMs: number;
  readonly volume: number;
  readonly muted: boolean;
  readonly settings: PlayerSettings;
}

export interface PlayerOptions {
  readonly engine: AudioEngine;
  readonly resolver: SourceResolver;
  readonly random?: () => number;
  readonly settings?: PlayerSettings;
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

function sanitizeSettings(settings: PlayerSettings): PlayerSettings {
  return {
    crossfadeMs: clamp(Math.round(settings.crossfadeMs), 0, MAX_CROSSFADE_MS),
    gaplessAlbums: settings.gaplessAlbums,
    replayGain: {
      mode: settings.replayGain.mode === 'off' ? 'off' : 'track',
      preampDb: clamp(settings.replayGain.preampDb, -6, 6),
    },
  };
}

interface Loaded {
  readonly key: string;
  readonly entry: QueueEntry;
  readonly resolved: ResolvedSource;
}

/**
 * Player state machine (ARCHITECTURE.md §6.3): queue, transitions, skipping unplayable tracks,
 * recovering expired links. Platform-free: sound comes from an AudioEngine.
 */
export class Player {
  private readonly queue: PlayQueue;
  private readonly engine: AudioEngine;
  private readonly resolver: SourceResolver;
  private readonly listeners = new Set<(state: PlayerState) => void>();
  private readonly unsubscribeEngine: () => void;
  private state: PlayerState;
  /** Increases on every load; async work for an older load is dropped. */
  private session = 0;
  private prepareSession = 0;
  private keyCounter = 0;
  private loaded: Loaded | null = null;
  private prepared: Loaded | null = null;
  /** Position to start from when nothing is loaded (paused selection, restored state). */
  private resumeAt = 0;
  private skips = 0;
  /** Queue entries whose link was already renewed once after a source error. */
  private readonly renewed = new Set<string>();

  constructor(options: PlayerOptions) {
    this.engine = options.engine;
    this.resolver = options.resolver;
    this.queue = new PlayQueue(options.random);
    this.state = {
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
      settings: sanitizeSettings(options.settings ?? DEFAULT_PLAYER_SETTINGS),
    };
    this.unsubscribeEngine = this.engine.subscribe((event) => {
      this.onEngine(event);
    });
  }

  getState(): PlayerState {
    return this.state;
  }

  subscribe(listener: (state: PlayerState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Read on demand (progress bar), not pushed: it changes every frame. */
  positionMs(): number {
    return this.loaded === null ? this.resumeAt : this.engine.positionMs();
  }

  durationMs(): number {
    return this.state.current?.track.durationMs ?? 0;
  }

  // ---------------------------------------------------------------- queue

  /** Replaces the queue and starts playing `tracks[startIndex]`. */
  playTracks(tracks: readonly QueueTrack[], startIndex = 0): void {
    this.queue.replace(tracks, startIndex);
    this.skips = 0;
    if (this.queue.length === 0) {
      this.unload();
      this.update({ status: 'idle', error: null, source: null });
      return;
    }
    void this.start(this.queue.index, 0);
  }

  addNext(tracks: readonly QueueTrack[]): void {
    const wasEmpty = this.queue.current() === null;
    this.queue.addNext(tracks);
    if (wasEmpty) this.select(0);
    this.afterQueueChange();
  }

  append(tracks: readonly QueueTrack[]): void {
    const wasEmpty = this.queue.current() === null;
    this.queue.append(tracks);
    if (wasEmpty) this.select(0);
    this.afterQueueChange();
  }

  remove(uid: string): boolean {
    const removed = this.queue.remove(uid);
    if (removed) this.afterQueueChange();
    return removed;
  }

  move(uid: string, toIndex: number): boolean {
    const moved = this.queue.move(uid, toIndex);
    if (moved) this.afterQueueChange();
    return moved;
  }

  /** Plays the entry at `index` of the play order. */
  jumpTo(index: number): void {
    if (this.queue.at(index) === null) return;
    void this.start(index, 0);
  }

  setShuffle(on: boolean): void {
    this.queue.setShuffle(on);
    this.afterQueueChange();
  }

  setRepeat(mode: RepeatMode): void {
    this.queue.setRepeat(mode);
    this.afterQueueChange();
  }

  /** off → all → one → off */
  cycleRepeat(): void {
    const next: Record<RepeatMode, RepeatMode> = { off: 'all', all: 'one', one: 'off' };
    this.setRepeat(next[this.queue.repeat]);
  }

  // ---------------------------------------------------------------- transport

  play(): void {
    const { status } = this.state;
    if (status === 'playing' || status === 'loading') return;
    if (this.loaded !== null && status === 'paused') {
      this.engine.play();
      return;
    }
    if (this.queue.current() !== null) void this.start(this.queue.index, this.resumeAt);
  }

  pause(): void {
    if (this.loaded !== null) {
      this.engine.pause();
      this.update({ status: 'paused', buffering: false });
      return;
    }
    if (this.state.status === 'loading') {
      // Cancel the pending start; play() starts from the same place.
      this.session += 1;
      this.update({ status: 'paused', buffering: false });
    }
  }

  togglePlay(): void {
    if (this.state.status === 'playing' || this.state.status === 'loading') this.pause();
    else this.play();
  }

  next(): void {
    const index = this.queue.peekNext(false);
    if (index === null) {
      this.endOfQueue();
      return;
    }
    this.goTo(index);
  }

  previous(): void {
    if (this.positionMs() > RESTART_THRESHOLD_MS) {
      this.seek(0);
      return;
    }
    this.goTo(this.queue.peekPrevious());
  }

  seek(positionMs: number): void {
    const target = clamp(positionMs, 0, this.durationMs());
    if (this.loaded !== null) this.engine.seek(target);
    else this.resumeAt = target;
    this.emit();
  }

  seekBy(deltaMs: number): void {
    this.seek(this.positionMs() + deltaMs);
  }

  stop(): void {
    this.session += 1;
    this.unload();
    this.resumeAt = 0;
    this.update({
      status: this.queue.current() === null ? 'idle' : 'paused',
      buffering: false,
      source: null,
    });
  }

  setVolume(volume: number): void {
    const value = clamp(Number.isFinite(volume) ? volume : 1, 0, 1);
    this.engine.setVolume(value);
    this.update({ volume: value });
  }

  setMuted(muted: boolean): void {
    this.engine.setMuted(muted);
    this.update({ muted });
  }

  setSettings(patch: Partial<PlayerSettings>): void {
    const settings = sanitizeSettings({ ...this.state.settings, ...patch });
    this.update({ settings });
    if (this.loaded !== null) {
      this.engine.setGain(this.loaded.key, this.gainFor(this.loaded.resolved));
    }
    this.refreshPrepared();
  }

  // ---------------------------------------------------------------- persistence

  snapshot(): PlayerSnapshot {
    return {
      version: 1,
      queue: this.queue.snapshot(),
      positionMs: Math.round(this.positionMs()),
      volume: this.state.volume,
      muted: this.state.muted,
      settings: this.state.settings,
    };
  }

  /** Restores a saved session without starting playback. */
  restore(snapshot: PlayerSnapshot): boolean {
    if (snapshot.version !== 1 || !this.queue.restore(snapshot.queue)) return false;
    this.session += 1;
    this.unload();
    const current = this.queue.current();
    this.resumeAt = clamp(snapshot.positionMs, 0, current?.track.durationMs ?? 0);
    this.engine.setVolume(clamp(snapshot.volume, 0, 1));
    this.engine.setMuted(snapshot.muted);
    this.update({
      status: current === null ? 'idle' : 'paused',
      volume: clamp(snapshot.volume, 0, 1),
      muted: snapshot.muted,
      settings: sanitizeSettings(snapshot.settings),
      error: null,
      source: null,
      buffering: false,
    });
    return true;
  }

  dispose(): void {
    this.session += 1;
    this.unsubscribeEngine();
    this.engine.dispose();
    this.listeners.clear();
  }

  // ---------------------------------------------------------------- internals

  /** Next/previous/jump: keeps playing if playing, otherwise just selects. */
  private goTo(index: number): void {
    const active = this.state.status === 'playing' || this.state.status === 'loading';
    if (active) void this.start(index, 0);
    else this.select(index);
  }

  /** Makes an entry current without loading it. */
  private select(index: number): void {
    this.session += 1;
    this.unload();
    this.queue.moveTo(index);
    this.resumeAt = 0;
    this.update({
      status: this.queue.current() === null ? 'idle' : 'paused',
      error: null,
      source: null,
      buffering: false,
    });
  }

  private async start(index: number, positionMs: number): Promise<void> {
    this.session += 1;
    const session = this.session;
    const entry = this.queue.moveTo(index);
    this.unload();
    this.resumeAt = positionMs;
    if (entry === null) {
      this.update({ status: 'idle', source: null });
      return;
    }
    this.update({ status: 'loading', error: null, source: null, buffering: false });

    let resolved: ResolvedSource;
    try {
      resolved = await this.resolver.resolve(entry.track.id);
    } catch (error) {
      if (session !== this.session) return;
      this.onUnplayable(error instanceof NotPlayableError ? 'not_playable' : 'unavailable');
      return;
    }
    if (session !== this.session) return;

    const loaded = { key: this.nextKey(entry), entry, resolved };
    this.loaded = loaded;
    this.engine.load(this.engineTrack(loaded), positionMs, true);
    this.update({ source: resolved.source });
    void this.prepareNext();
  }

  /** Resolves the track that follows and hands it to the engine for the automatic transition. */
  private async prepareNext(): Promise<void> {
    this.prepareSession += 1;
    const prepareSession = this.prepareSession;
    const current = this.loaded;
    this.prepared = null;
    const index = this.queue.peekNext(true);
    const entry = index === null ? null : this.queue.at(index);
    if (current === null || entry === null) {
      if (current !== null) this.engine.prepareNext(null, { kind: 'gapless' });
      return;
    }
    let resolved: ResolvedSource;
    try {
      resolved = await this.resolver.resolve(entry.track.id);
    } catch {
      // Not prepared: when the current track ends, the player tries it again (and skips it if needed).
      if (prepareSession === this.prepareSession)
        this.engine.prepareNext(null, { kind: 'gapless' });
      return;
    }
    if (prepareSession !== this.prepareSession || this.loaded !== current) return;
    const prepared = { key: this.nextKey(entry), entry, resolved };
    this.prepared = prepared;
    this.engine.prepareNext(this.engineTrack(prepared), this.transition(current.entry, entry));
  }

  private refreshPrepared(): void {
    if (this.loaded !== null) void this.prepareNext();
  }

  private afterQueueChange(): void {
    this.emit();
    this.refreshPrepared();
  }

  /**
   * How long before the end of the current track the next one takes over: the crossfade
   * length when the next transition is a crossfade, otherwise 0 (gapless or end of queue).
   */
  transitionLeadMs(): number {
    const current = this.queue.current();
    const index = this.queue.peekNext(true);
    const next = index === null ? null : this.queue.at(index);
    if (current === null || next === null) return 0;
    const transition = this.transition(current, next);
    return transition.kind === 'crossfade' ? transition.durationMs : 0;
  }

  private transition(from: QueueEntry, to: QueueEntry): Transition {
    const { crossfadeMs, gaplessAlbums } = this.state.settings;
    if (crossfadeMs <= 0 || from.uid === to.uid) return { kind: 'gapless' };
    if (gaplessAlbums && from.track.release.id === to.track.release.id) return { kind: 'gapless' };
    return { kind: 'crossfade', durationMs: crossfadeMs };
  }

  private onEngine(event: EngineEvent): void {
    const loaded = this.loaded;
    if (event.type === 'transitioned') {
      const prepared = this.prepared;
      if (prepared === null || prepared.key !== event.key) return;
      const index = this.queue.indexOf(prepared.entry.uid);
      if (index === -1) return;
      this.queue.moveTo(index);
      this.loaded = prepared;
      this.prepared = null;
      this.skips = 0;
      this.renewed.delete(prepared.entry.uid);
      this.update({
        status: 'playing',
        source: prepared.resolved.source,
        buffering: false,
        error: null,
      });
      void this.prepareNext();
      return;
    }
    if (loaded === null || loaded.key !== event.key) return;
    switch (event.type) {
      case 'playing':
        this.skips = 0;
        // Playing again: a later expiry (another long pause) may be renewed once more.
        this.renewed.delete(loaded.entry.uid);
        this.update({ status: 'playing', buffering: false, error: null });
        return;
      case 'paused':
        this.update({ status: 'paused', buffering: false });
        return;
      case 'buffering':
        this.update({ buffering: true });
        return;
      case 'ended': {
        this.loaded = null;
        this.prepared = null;
        const index = this.queue.peekNext(true);
        if (index === null) this.endOfQueue();
        else void this.start(index, 0);
        return;
      }
      case 'error':
        this.onEngineError(loaded, event.reason);
        return;
    }
  }

  private onEngineError(loaded: Loaded, reason: 'source' | 'decode'): void {
    const position = this.engine.positionMs();
    if (reason === 'source') {
      if (!this.renewed.has(loaded.entry.uid)) {
        // Most likely an expired link (a long pause, then a seek): get a fresh one and go on.
        this.renewed.add(loaded.entry.uid);
        this.resolver.invalidate(loaded.entry.track.id);
        void this.start(this.queue.index, position);
        return;
      }
      this.unload();
      this.resumeAt = position;
      this.update({ status: 'error', error: 'unavailable', buffering: false });
      return;
    }
    this.onUnplayable('not_playable');
  }

  /** The current entry cannot start: skip it, or stop if nothing in the queue plays. */
  private onUnplayable(error: PlayerError): void {
    this.unload();
    if (error === 'unavailable') {
      this.update({ status: 'error', error, buffering: false, source: null });
      return;
    }
    this.skips += 1;
    const index = this.queue.peekNext(false);
    if (this.skips >= MAX_SKIPS_IN_A_ROW || index === null || index === this.queue.index) {
      this.skips = 0;
      this.update({ status: 'error', error: 'not_playable', buffering: false, source: null });
      return;
    }
    void this.start(index, 0);
  }

  private endOfQueue(): void {
    this.session += 1;
    this.unload();
    this.resumeAt = 0;
    this.update({ status: this.queue.current() === null ? 'idle' : 'paused', buffering: false });
  }

  private unload(): void {
    if (this.loaded !== null || this.prepared !== null) this.engine.stop();
    this.loaded = null;
    this.prepared = null;
    this.prepareSession += 1;
  }

  private nextKey(entry: QueueEntry): string {
    this.keyCounter += 1;
    return `${entry.uid}#${String(this.keyCounter)}`;
  }

  private gainFor(resolved: ResolvedSource): number {
    return replayGainDb(resolved.loudness, this.state.settings.replayGain);
  }

  private engineTrack(loaded: Loaded): EngineTrack {
    return {
      key: loaded.key,
      url: loaded.resolved.url,
      mimeType: loaded.resolved.source.mimeType,
      durationMs: loaded.entry.track.durationMs,
      gainDb: this.gainFor(loaded.resolved),
    };
  }

  private update(patch: Partial<PlayerState>): void {
    this.state = { ...this.state, ...patch };
    this.emit();
  }

  /** Publishes the state with the queue as it is now. */
  private emit(): void {
    this.state = {
      ...this.state,
      current: this.queue.current(),
      index: this.queue.index,
      queue: this.queue.list(),
      shuffle: this.queue.shuffle,
      repeat: this.queue.repeat,
    };
    for (const listener of this.listeners) listener(this.state);
  }
}
