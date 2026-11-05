import type { AudioEngine, EngineEvent, EngineTrack, Transition } from '@mp/player-core';

import { BufferDeck, type Deck, type DeckHandlers, ElementDeck } from './decks.js';
import {
  crossfadeSeconds,
  dbToGain,
  decodeBudgetBytes,
  decodedBytes,
  EQ_BANDS_HZ,
  EQ_Q,
  eqPreampDb,
  fadeCurve,
  normalizeBalance,
  normalizeEq,
  volumeToGain,
} from './dsp.js';

/** Engine housekeeping interval. Starts themselves are scheduled on the audio clock. */
const TICK_MS = 50;
/**
 * The next track is scheduled this long before it is due. Generous on purpose: background tabs
 * may run timers only once a second, and a start scheduled on the audio clock stays exact.
 */
const SCHEDULE_AHEAD_SEC = 2.5;
/** The next track is decoded this long before the current one ends (keeps memory low). */
const DECODE_AHEAD_SEC = 45;
/** Pause, resume and seek ramp the volume this fast to avoid clicks. */
const DECLICK_SEC = 0.03;

type NextState = 'fetching' | 'fetched' | 'decoding' | 'ready' | 'failed';

interface Next {
  readonly track: EngineTrack;
  readonly transition: Transition;
  readonly abort: AbortController;
  state: NextState;
  bytes: ArrayBuffer | null;
  deck: Deck | null;
  /** Context time the deck was scheduled to start at. */
  startAt: number | null;
}

export interface WebAudioEngineOptions {
  /** For tests and the desktop app; defaults to the global fetch. */
  readonly fetch?: typeof fetch;
  readonly createContext?: () => AudioContext;
  /**
   * Tracks whose decoded size exceeds this stream through <audio> instead (ADR-024).
   * Default: from `navigator.deviceMemory`, see `decodeBudgetBytes`.
   */
  readonly decodeBudgetBytes?: number;
}

/**
 * Web Audio engine for player-core (ADR-019): two decks, gapless and crossfade transitions on
 * the audio clock, ReplayGain per deck, a 10-band equalizer, perceptual volume.
 *
 * Graph: deck gain (ReplayGain, fades) → 10 filters → EQ preamp → balance → volume → speakers.
 * The volume node also carries the sleep-timer fade (`setFade`).
 */
export class WebAudioEngine implements AudioEngine {
  private ctx: AudioContext | null = null;
  private bus: GainNode | null = null;
  private filters: BiquadFilterNode[] = [];
  private preamp: GainNode | null = null;
  private volumeNode: GainNode | null = null;
  private panner: StereoPannerNode | null = null;
  private balance = 0;
  /** Sleep-timer fade, 0..1, on top of the user volume. */
  private fade = 1;
  private current: Deck | null = null;
  /** Decks still sounding after a transition (fading out). */
  private outgoing: Deck[] = [];
  private next: Next | null = null;
  private paused = true;
  private timer: ReturnType<typeof setInterval> | null = null;
  private suspendTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly listeners = new Set<(event: EngineEvent) => void>();
  private volume = 1;
  private muted = false;
  private eq = normalizeEq([]);
  private eqEnabled = true;
  private readonly fetchImpl: typeof fetch;
  private readonly createContext: () => AudioContext;
  private readonly decodeBudget: number;
  private readonly handlers: DeckHandlers;
  /** ReplayGain changed after load (setGain), by track key. */
  private readonly gainOverride = new Map<string, number>();

  constructor(options: WebAudioEngineOptions = {}) {
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.createContext =
      options.createContext ?? (() => new AudioContext({ latencyHint: 'playback' }));
    this.decodeBudget =
      options.decodeBudgetBytes ??
      decodeBudgetBytes(
        typeof navigator === 'undefined'
          ? undefined
          : (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
      );
    this.handlers = {
      onEnded: (deck) => {
        this.onDeckEnded(deck);
      },
      onWaiting: (deck) => {
        if (deck === this.current) this.emit({ type: 'buffering', key: deck.track.key });
      },
      onPlaying: (deck) => {
        if (deck === this.current && !this.paused)
          this.emit({ type: 'playing', key: deck.track.key });
      },
      onError: (deck, reason) => {
        this.onDeckError(deck, reason);
      },
    };
  }

  // ---------------------------------------------------------------- AudioEngine

  load(track: EngineTrack, positionMs: number, autoplay: boolean): void {
    const ctx = this.context();
    const reuse = this.takePreparedBuffer(track);
    this.clearAll();
    const output = this.deckOutput(track.gainDb);
    const deck =
      reuse === null
        ? new ElementDeck(ctx, track, output, this.handlers)
        : new BufferDeck(ctx, track, reuse, output, this.handlers);
    this.current = deck;
    if (autoplay) {
      this.paused = false;
      this.wake();
      deck.start(ctx.currentTime, positionMs / 1000);
      if (deck.kind === 'element') this.emit({ type: 'buffering', key: track.key });
    } else {
      this.paused = true;
      deck.setOffset(positionMs / 1000);
    }
    this.startTicker();
  }

  prepareNext(track: EngineTrack | null, transition: Transition): void {
    this.cancelNext();
    if (track === null) return;
    const next: Next = {
      track,
      transition,
      abort: new AbortController(),
      state: 'fetching',
      bytes: null,
      deck: null,
      startAt: null,
    };
    this.next = next;
    // Decoded audio is ~22 MB per minute at 48 kHz: past the budget, stream instead (ADR-024).
    if (decodedBytes(track.durationMs, this.context().sampleRate) > this.decodeBudget) {
      next.state = 'failed'; // streams through <audio> when it is time
      return;
    }
    void this.fetchImpl(track.url, { signal: next.abort.signal, credentials: 'same-origin' })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
        return response.arrayBuffer();
      })
      .then(
        (bytes) => {
          if (this.next !== next) return;
          next.bytes = bytes;
          next.state = 'fetched';
        },
        () => {
          // Falls back to streaming; a broken link then reports itself when the track starts.
          if (this.next === next) next.state = 'failed';
        },
      );
  }

  play(): void {
    const current = this.current;
    if (current === null) return;
    this.paused = false;
    this.wake();
    if (!current.isStarted()) current.start(this.context().currentTime, current.positionSec());
    this.emit({ type: 'playing', key: current.track.key });
  }

  pause(): void {
    const current = this.current;
    if (current === null || this.paused) return;
    this.paused = true;
    const ctx = this.context();
    this.rampVolume(0);
    if (this.suspendTimer !== null) clearTimeout(this.suspendTimer);
    this.suspendTimer = setTimeout(
      () => {
        this.suspendTimer = null;
        if (!this.paused) return;
        for (const deck of this.decks()) deck.suspendMedia();
        void ctx.suspend();
      },
      DECLICK_SEC * 1000 + 20,
    );
    this.emit({ type: 'paused', key: current.track.key });
  }

  seek(positionMs: number): void {
    const current = this.current;
    if (current === null) return;
    // A seek cancels a transition in progress: the next track is scheduled again later.
    this.unscheduleNext();
    for (const deck of this.outgoing) deck.dispose();
    this.outgoing = [];
    this.resetGain(current);
    const seconds = positionMs / 1000;
    if (this.paused || !current.isStarted()) {
      current.setOffset(seconds);
      return;
    }
    current.start(this.context().currentTime + 0.005, seconds);
  }

  stop(): void {
    this.clearAll();
    this.paused = true;
    this.stopTicker();
  }

  setVolume(volume: number): void {
    this.volume = volume;
    if (!this.paused) this.rampVolume(this.targetVolume());
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (!this.paused) this.rampVolume(this.targetVolume());
  }

  /** Left/right balance, −1..1 (ТЗ v3 §6.2). */
  setBalance(balance: number): void {
    this.balance = normalizeBalance(balance);
    const ctx = this.ctx;
    if (ctx !== null) this.panner?.pan.setTargetAtTime(this.balance, ctx.currentTime, 0.02);
  }

  /** Sleep-timer fade, 0..1; does not change the volume the user set. */
  setFade(gain: number): void {
    this.fade = Math.min(Math.max(Number.isFinite(gain) ? gain : 1, 0), 1);
    if (!this.paused) this.rampVolume(this.targetVolume());
  }

  setGain(key: string, gainDb: number): void {
    // Tracks are immutable: the new gain is kept for later fades and seeks.
    this.gainOverride.set(key, gainDb);
    const current = this.current;
    const ctx = this.ctx;
    // During a scheduled crossfade the fade curve owns the gain; it is reset on the next seek.
    if (current?.track.key !== key || ctx === null || this.next?.startAt != null) return;
    current.output.gain.cancelScheduledValues(ctx.currentTime);
    current.output.gain.setTargetAtTime(dbToGain(gainDb), ctx.currentTime, 0.05);
  }

  positionMs(): number {
    return (this.current?.positionSec() ?? 0) * 1000;
  }

  subscribe(listener: (event: EngineEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  dispose(): void {
    this.stop();
    this.listeners.clear();
    void this.ctx?.close();
    this.ctx = null;
  }

  /**
   * Call from a click or key handler: creates and resumes the AudioContext inside the user
   * gesture, so playback that starts after a network request is not blocked by autoplay rules.
   */
  unlock(): void {
    void this.context().resume();
  }

  // ---------------------------------------------------------------- equalizer

  /** Ten gains in dB (31 Hz … 16 kHz), ±12 dB. */
  setEqualizer(gains: readonly number[]): void {
    this.eq = normalizeEq(gains);
    this.applyEq();
  }

  setEqualizerEnabled(enabled: boolean): void {
    this.eqEnabled = enabled;
    this.applyEq();
  }

  // ---------------------------------------------------------------- internals

  private gainOf(track: EngineTrack): number {
    return dbToGain(this.gainOverride.get(track.key) ?? track.gainDb);
  }

  private context(): AudioContext {
    if (this.ctx !== null) return this.ctx;
    const ctx = this.createContext();
    const bus = ctx.createGain();
    let tail: AudioNode = bus;
    this.filters = EQ_BANDS_HZ.map((frequency, i) => {
      const filter = ctx.createBiquadFilter();
      filter.type = i === 0 ? 'lowshelf' : i === EQ_BANDS_HZ.length - 1 ? 'highshelf' : 'peaking';
      filter.frequency.value = frequency;
      filter.Q.value = EQ_Q;
      tail.connect(filter);
      tail = filter;
      return filter;
    });
    const preamp = ctx.createGain();
    const panner = ctx.createStereoPanner();
    panner.pan.value = this.balance;
    const volume = ctx.createGain();
    tail.connect(preamp);
    preamp.connect(panner);
    panner.connect(volume);
    volume.connect(ctx.destination);
    volume.gain.value = this.targetVolume();
    this.ctx = ctx;
    this.bus = bus;
    this.preamp = preamp;
    this.volumeNode = volume;
    this.panner = panner;
    this.applyEq();
    return ctx;
  }

  private deckOutput(gainDb: number): GainNode {
    const ctx = this.context();
    const gain = ctx.createGain();
    gain.gain.value = dbToGain(gainDb);
    if (this.bus !== null) gain.connect(this.bus);
    return gain;
  }

  private applyEq(): void {
    const ctx = this.ctx;
    if (ctx === null) return;
    const gains = this.eqEnabled ? this.eq : normalizeEq([]);
    this.filters.forEach((filter, i) => {
      filter.gain.setTargetAtTime(gains[i] ?? 0, ctx.currentTime, 0.02);
    });
    this.preamp?.gain.setTargetAtTime(dbToGain(eqPreampDb(gains)), ctx.currentTime, 0.02);
  }

  private targetVolume(): number {
    return this.muted ? 0 : volumeToGain(this.volume) * volumeToGain(this.fade);
  }

  private rampVolume(target: number): void {
    const node = this.volumeNode;
    const ctx = this.ctx;
    if (node === null || ctx === null) return;
    const now = ctx.currentTime;
    node.gain.cancelScheduledValues(now);
    node.gain.setValueAtTime(node.gain.value, now);
    node.gain.linearRampToValueAtTime(target, now + DECLICK_SEC);
  }

  /** Resumes the context (needs a user gesture the first time) and fades the volume in. */
  private wake(): void {
    const ctx = this.context();
    if (this.suspendTimer !== null) {
      clearTimeout(this.suspendTimer);
      this.suspendTimer = null;
    }
    void ctx.resume().then(() => {
      if (this.paused) return;
      for (const deck of this.decks()) deck.resumeMedia();
      this.rampVolume(this.targetVolume());
    });
  }

  private decks(): Deck[] {
    const list = [...this.outgoing];
    if (this.current !== null) list.push(this.current);
    if (this.next?.deck != null) list.push(this.next.deck);
    return list;
  }

  /** A decoded buffer of the prepared track, when the player loads that same file. */
  private takePreparedBuffer(track: EngineTrack): AudioBuffer | null {
    const deck = this.next?.track.url === track.url ? this.next.deck : null;
    return deck instanceof BufferDeck ? deck.audioBuffer : null;
  }

  private startTicker(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => {
      this.tick();
    }, TICK_MS);
  }

  private stopTicker(): void {
    if (this.timer === null) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  private tick(): void {
    const ctx = this.ctx;
    if (ctx === null) return;
    for (const deck of this.decks()) deck.tick();
    this.outgoing = this.outgoing.filter((deck) => {
      const end = deck.endTime();
      if (end !== null && end > ctx.currentTime) return true;
      deck.dispose();
      return false;
    });

    const current = this.current;
    const next = this.next;
    if (current === null || next === null || this.paused) return;
    const end = current.endTime();
    if (end === null) return;
    const remaining = end - ctx.currentTime;

    if (next.state === 'fetched' && remaining <= DECODE_AHEAD_SEC) this.decode(next);
    if (next.state === 'failed' && next.deck === null && remaining <= SCHEDULE_AHEAD_SEC + 15) {
      // Streaming fallback: give <audio> a head start to buffer.
      next.deck = new ElementDeck(ctx, next.track, this.deckOutput(0), this.handlers);
      next.deck.output.gain.value = 0;
      next.state = 'ready';
    }
    if (next.state === 'ready' && next.deck !== null && next.startAt === null) {
      const fade =
        next.transition.kind === 'crossfade'
          ? crossfadeSeconds(next.transition.durationMs, current.durationSec, next.deck.durationSec)
          : 0;
      if (remaining <= SCHEDULE_AHEAD_SEC + fade) this.schedule(current, next, end, fade);
    }
    if (next.startAt !== null && ctx.currentTime >= next.startAt) this.handOver(next);
  }

  private decode(next: Next): void {
    const ctx = this.context();
    const bytes = next.bytes;
    if (bytes === null) return;
    next.state = 'decoding';
    next.bytes = null;
    void ctx.decodeAudioData(bytes).then(
      (buffer) => {
        if (this.next !== next) return;
        next.deck = new BufferDeck(ctx, next.track, buffer, this.deckOutput(0), this.handlers);
        next.deck.output.gain.value = 0;
        next.state = 'ready';
      },
      () => {
        // Some browsers cannot decode a format they can stream (Opus on older Safari).
        if (this.next === next) next.state = 'failed';
      },
    );
  }

  /** Starts the next deck on the audio clock: exactly at `end` (gapless) or overlapping. */
  private schedule(current: Deck, next: Next, end: number, fade: number): void {
    const ctx = this.context();
    const deck = next.deck;
    if (deck === null) return;
    const startAt = Math.max(ctx.currentTime + 0.01, end - fade);
    const nextLevel = this.gainOf(next.track);
    const currentLevel = this.gainOf(current.track);
    deck.output.gain.cancelScheduledValues(0);
    if (fade > 0) {
      deck.output.gain.setValueAtTime(0, ctx.currentTime);
      deck.output.gain.setValueCurveAtTime(fadeCurve('in', nextLevel), startAt, fade);
      current.output.gain.cancelScheduledValues(ctx.currentTime);
      current.output.gain.setValueAtTime(currentLevel, ctx.currentTime);
      current.output.gain.setValueCurveAtTime(fadeCurve('out', currentLevel), startAt, fade);
    } else {
      deck.output.gain.setValueAtTime(nextLevel, ctx.currentTime);
    }
    deck.start(startAt, 0);
    next.startAt = startAt;
  }

  /** The next deck is sounding: it becomes current, the old one finishes as outgoing. */
  private handOver(next: Next): void {
    const deck = next.deck;
    if (deck === null) return;
    if (this.current !== null) {
      this.outgoing.push(this.current);
      this.gainOverride.delete(this.current.track.key);
    }
    this.current = deck;
    this.next = null;
    this.emit({ type: 'transitioned', key: deck.track.key });
  }

  /** Undoes a scheduled start (seek, new next track); keeps a decoded buffer. */
  private unscheduleNext(): void {
    const next = this.next;
    if (next?.deck == null || next.startAt === null) return;
    next.deck.halt();
    next.deck.setOffset(0);
    next.deck.output.gain.cancelScheduledValues(0);
    next.deck.output.gain.value = 0;
    next.startAt = null;
  }

  private resetGain(deck: Deck): void {
    const ctx = this.context();
    deck.output.gain.cancelScheduledValues(0);
    deck.output.gain.setValueAtTime(this.gainOf(deck.track), ctx.currentTime);
  }

  private cancelNext(): void {
    const next = this.next;
    if (next === null) return;
    this.next = null;
    next.abort.abort();
    next.deck?.dispose();
    this.gainOverride.delete(next.track.key);
  }

  private clearAll(): void {
    this.cancelNext();
    for (const deck of this.outgoing) deck.dispose();
    this.outgoing = [];
    this.current?.dispose();
    this.current = null;
    this.gainOverride.clear();
  }

  private onDeckEnded(deck: Deck): void {
    if (deck !== this.current) return;
    const next = this.next;
    if (next?.deck != null && next.state === 'ready') {
      // The tick missed the window (a throttled background tab): start right now.
      if (next.startAt === null) {
        this.resetGain(next.deck);
        next.deck.start(this.context().currentTime, 0);
        next.startAt = this.context().currentTime;
      }
      this.handOver(next);
      return;
    }
    this.current = null;
    deck.dispose();
    this.emit({ type: 'ended', key: deck.track.key });
  }

  private onDeckError(deck: Deck, reason: 'source' | 'decode'): void {
    if (deck === this.current) {
      this.emit({ type: 'error', key: deck.track.key, reason });
      return;
    }
    if (this.next?.deck === deck) {
      // A prepared stream failed: the player loads the track again when it is due.
      this.cancelNext();
      return;
    }
    this.outgoing = this.outgoing.filter((d) => d !== deck);
    deck.dispose();
  }

  private emit(event: EngineEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}
