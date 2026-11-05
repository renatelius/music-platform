// A deck plays one track into its own gain node. Two kinds (ADR-019):
// - BufferDeck: the whole file decoded into an AudioBuffer and started on the audio clock —
//   sample-accurate joins (gapless) and crossfades;
// - ElementDeck: a streaming <audio> element — starts at once without downloading the whole
//   file; used for the first track after a click and for very long tracks.
import type { EngineErrorReason, EngineTrack } from '@mp/player-core';

export interface DeckHandlers {
  /** Reached the end by itself (not after stop()). */
  onEnded(deck: Deck): void;
  onWaiting(deck: Deck): void;
  onPlaying(deck: Deck): void;
  onError(deck: Deck, reason: EngineErrorReason): void;
}

export interface Deck {
  readonly kind: 'buffer' | 'element';
  readonly track: EngineTrack;
  /** ReplayGain and fades are applied here. */
  readonly output: GainNode;
  readonly durationSec: number;
  /** Starts at context time `when` from `offsetSec`. */
  start(when: number, offsetSec: number): void;
  /** Stops and remembers the position. */
  halt(): void;
  /** Moves the position without starting. */
  setOffset(offsetSec: number): void;
  /** Pause / resume around a suspended AudioContext (only <audio> needs it). */
  suspendMedia(): void;
  resumeMedia(): void;
  /** Called every engine tick. */
  tick(): void;
  isStarted(): boolean;
  positionSec(): number;
  /** Context time when the deck reaches its end, null when not started. */
  endTime(): number | null;
  dispose(): void;
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

export class BufferDeck implements Deck {
  readonly kind = 'buffer';
  readonly durationSec: number;
  private source: AudioBufferSourceNode | null = null;
  private startedAt = 0;
  private offset = 0;

  constructor(
    private readonly ctx: AudioContext,
    readonly track: EngineTrack,
    private readonly buffer: AudioBuffer,
    readonly output: GainNode,
    private readonly handlers: DeckHandlers,
  ) {
    this.durationSec = buffer.duration;
  }

  /** The decoded audio, reusable by a new deck for the same file. */
  get audioBuffer(): AudioBuffer {
    return this.buffer;
  }

  start(when: number, offsetSec: number): void {
    this.halt();
    const source = this.ctx.createBufferSource();
    source.buffer = this.buffer;
    source.connect(this.output);
    source.onended = () => {
      if (this.source !== source) return;
      this.source = null;
      this.offset = this.durationSec;
      this.handlers.onEnded(this);
    };
    this.offset = clamp(offsetSec, 0, this.durationSec);
    this.startedAt = Math.max(when, this.ctx.currentTime);
    source.start(this.startedAt, this.offset);
    this.source = source;
    this.handlers.onPlaying(this);
  }

  halt(): void {
    const source = this.source;
    if (source === null) return;
    this.offset = this.positionSec();
    this.source = null;
    source.onended = null;
    try {
      source.stop();
    } catch {
      // Already stopped.
    }
    source.disconnect();
  }

  setOffset(offsetSec: number): void {
    this.halt();
    this.offset = clamp(offsetSec, 0, this.durationSec);
  }

  suspendMedia(): void {
    // The suspended AudioContext pauses buffer sources exactly.
  }

  resumeMedia(): void {
    // See suspendMedia.
  }

  tick(): void {
    // Everything is scheduled on the audio clock.
  }

  isStarted(): boolean {
    return this.source !== null;
  }

  positionSec(): number {
    if (this.source === null) return this.offset;
    return clamp(
      this.offset + Math.max(0, this.ctx.currentTime - this.startedAt),
      0,
      this.durationSec,
    );
  }

  endTime(): number | null {
    return this.source === null ? null : this.startedAt + (this.durationSec - this.offset);
  }

  dispose(): void {
    this.halt();
    this.output.disconnect();
  }
}

export class ElementDeck implements Deck {
  readonly kind = 'element';
  private readonly element: HTMLAudioElement;
  private readonly node: MediaElementAudioSourceNode;
  private started = false;
  /** Context time of a scheduled start (crossfade into a long track). */
  private pendingAt: number | null = null;
  private suspended = false;
  private disposed = false;

  constructor(
    private readonly ctx: AudioContext,
    readonly track: EngineTrack,
    readonly output: GainNode,
    private readonly handlers: DeckHandlers,
  ) {
    const element = new Audio();
    element.preload = 'auto';
    element.src = track.url;
    this.element = element;
    this.node = ctx.createMediaElementSource(element);
    this.node.connect(output);
    element.addEventListener('ended', () => {
      if (this.disposed || !this.started) return;
      this.started = false;
      handlers.onEnded(this);
    });
    element.addEventListener('waiting', () => {
      if (!this.disposed && this.started) handlers.onWaiting(this);
    });
    element.addEventListener('playing', () => {
      if (!this.disposed && this.started) handlers.onPlaying(this);
    });
    element.addEventListener('error', () => {
      if (this.disposed) return;
      const code = element.error?.code;
      handlers.onError(this, code === MediaError.MEDIA_ERR_DECODE ? 'decode' : 'source');
    });
  }

  get durationSec(): number {
    const duration = this.element.duration;
    return Number.isFinite(duration) && duration > 0 ? duration : this.track.durationMs / 1000;
  }

  start(when: number, offsetSec: number): void {
    this.setOffset(offsetSec);
    this.started = true;
    if (when <= this.ctx.currentTime + 0.02) this.playNow();
    else this.pendingAt = when;
  }

  halt(): void {
    this.started = false;
    this.pendingAt = null;
    this.element.pause();
  }

  setOffset(offsetSec: number): void {
    const target = clamp(offsetSec, 0, this.durationSec);
    if (Math.abs(this.element.currentTime - target) > 0.05) this.element.currentTime = target;
  }

  suspendMedia(): void {
    this.suspended = true;
    this.element.pause();
  }

  resumeMedia(): void {
    this.suspended = false;
    if (this.started && this.pendingAt === null) this.playNow();
  }

  tick(): void {
    if (
      this.pendingAt !== null &&
      !this.suspended &&
      this.ctx.currentTime >= this.pendingAt - 0.01
    ) {
      this.pendingAt = null;
      this.playNow();
    }
  }

  isStarted(): boolean {
    return this.started;
  }

  positionSec(): number {
    return this.element.currentTime;
  }

  endTime(): number | null {
    if (!this.started) return null;
    const remaining = Math.max(0, this.durationSec - this.element.currentTime);
    return (this.pendingAt ?? this.ctx.currentTime) + remaining;
  }

  dispose(): void {
    this.disposed = true;
    this.halt();
    this.element.removeAttribute('src');
    this.element.load();
    this.node.disconnect();
    this.output.disconnect();
  }

  private playNow(): void {
    // A rejected play() (autoplay policy, aborted load) shows up as 'error' or no 'playing'.
    void this.element.play().catch(() => undefined);
  }
}
