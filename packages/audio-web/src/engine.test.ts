import type { EngineEvent, EngineTrack } from '@mp/player-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { dbToGain } from './dsp.js';
import { WebAudioEngine } from './engine.js';

// A minimal Web Audio and <audio> for the engine: enough to follow decks, schedules and gains.
// The audio clock moves only when a test says so (`at`), so transitions are exact and repeatable.

interface ParamEvent {
  readonly kind: 'cancel' | 'set' | 'ramp' | 'target' | 'curve';
  readonly time: number;
  /** For a curve: its last value. */
  readonly value: number;
}

class FakeParam {
  value: number;
  readonly events: ParamEvent[] = [];

  constructor(value: number) {
    this.value = value;
  }

  cancelScheduledValues(time: number): this {
    this.events.push({ kind: 'cancel', time, value: Number.NaN });
    return this;
  }

  setValueAtTime(value: number, time: number): this {
    this.value = value;
    this.events.push({ kind: 'set', time, value });
    return this;
  }

  linearRampToValueAtTime(value: number, time: number): this {
    this.events.push({ kind: 'ramp', time, value });
    return this;
  }

  setTargetAtTime(value: number, time: number): this {
    this.events.push({ kind: 'target', time, value });
    return this;
  }

  setValueCurveAtTime(curve: Float32Array, time: number): this {
    this.events.push({ kind: 'curve', time, value: curve.at(-1) ?? Number.NaN });
    return this;
  }

  /** What is still scheduled: the events after the last cancel. */
  pending(): ParamEvent[] {
    const last = this.events.map((event) => event.kind).lastIndexOf('cancel');
    return this.events.slice(last + 1);
  }
}

class FakeNode {
  readonly targets: unknown[] = [];
  disconnected = false;

  connect<T>(target: T): T {
    this.targets.push(target);
    return target;
  }

  disconnect(): void {
    this.disconnected = true;
  }
}

class FakeGain extends FakeNode {
  readonly gain = new FakeParam(1);
}

class FakeFilter extends FakeNode {
  type = '';
  readonly frequency = new FakeParam(0);
  readonly Q = new FakeParam(1);
  readonly gain = new FakeParam(0);
}

class FakePanner extends FakeNode {
  readonly pan = new FakeParam(0);
}

class FakeBufferSource extends FakeNode {
  buffer: unknown = null;
  onended: (() => void) | null = null;
  started: { readonly when: number; readonly offset: number } | null = null;
  stopped = false;

  start(when = 0, offset = 0): void {
    this.started = { when, offset };
  }

  stop(): void {
    this.stopped = true;
  }
}

class FakeContext {
  currentTime = 0;
  readonly sampleRate = 48_000;
  readonly destination = new FakeNode();
  readonly gains: FakeGain[] = [];
  readonly sources: FakeBufferSource[] = [];

  createGain(): FakeGain {
    const node = new FakeGain();
    this.gains.push(node);
    return node;
  }

  createBiquadFilter(): FakeFilter {
    return new FakeFilter();
  }

  createStereoPanner(): FakePanner {
    return new FakePanner();
  }

  createBufferSource(): FakeBufferSource {
    const node = new FakeBufferSource();
    this.sources.push(node);
    return node;
  }

  createMediaElementSource(): FakeNode {
    return new FakeNode();
  }

  resume(): Promise<void> {
    return Promise.resolve();
  }

  suspend(): Promise<void> {
    return Promise.resolve();
  }

  close(): Promise<void> {
    return Promise.resolve();
  }

  /** The test files carry their length in seconds as their size in bytes. */
  decodeAudioData(bytes: ArrayBuffer): Promise<{ readonly duration: number }> {
    return Promise.resolve({ duration: bytes.byteLength });
  }
}

/** <audio>: plays from `currentTime`; `at` moves the time of the playing ones. */
class FakeAudio {
  static readonly all: FakeAudio[] = [];
  preload = '';
  src = '';
  currentTime = 0;
  /** Unknown: the deck falls back to the duration of the track. */
  readonly duration = Number.NaN;
  readonly error = null;
  paused = true;

  constructor() {
    FakeAudio.all.push(this);
  }

  addEventListener(): void {
    // Media events are not simulated; the engine does not need them for transitions.
  }

  play(): Promise<void> {
    this.paused = false;
    return Promise.resolve();
  }

  pause(): void {
    this.paused = true;
  }

  removeAttribute(name: string): void {
    if (name === 'src') this.src = '';
  }

  load(): void {
    this.currentTime = 0;
  }
}

const track = (name: string, seconds: number, gainDb = -3): EngineTrack => ({
  key: `${name}#1`,
  url: `/media/${name}`,
  mimeType: 'audio/webm; codecs="opus"',
  durationMs: seconds * 1000,
  gainDb,
});

async function flush(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

// ТЗ v3 §6.4 п. 4–5: a manual change and a seek around a crossfade.
describe('WebAudioEngine around a crossfade', () => {
  const A = track('a', 60);
  const B = track('b', 30, -6);
  const C = track('c', 30);
  const lengths = new Map([
    [B.url, 30],
    [C.url, 30],
  ]);
  const fetchFake: typeof fetch = (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const bytes = new ArrayBuffer(lengths.get(url) ?? 0);
    return Promise.resolve({
      ok: true,
      status: 200,
      arrayBuffer: () => Promise.resolve(bytes),
    } as unknown as Response);
  };

  let ctx: FakeContext;
  let engine: WebAudioEngine;
  let events: EngineEvent[];

  beforeEach(() => {
    vi.useFakeTimers();
    FakeAudio.all.length = 0;
    vi.stubGlobal('Audio', FakeAudio);
    vi.stubGlobal('MediaError', { MEDIA_ERR_DECODE: 3 });
    ctx = new FakeContext();
    engine = new WebAudioEngine({
      createContext: () => ctx as unknown as AudioContext,
      fetch: fetchFake,
      decodeBudgetBytes: 256 * 1024 * 1024,
    });
    events = [];
    engine.subscribe((event) => {
      events.push(event);
    });
  });

  afterEach(() => {
    engine.dispose();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  /** Moves the audio clock (and every playing <audio>) to `time` and lets the engine tick once. */
  async function at(time: number): Promise<void> {
    await flush();
    const delta = time - ctx.currentTime;
    for (const audio of FakeAudio.all) if (!audio.paused) audio.currentTime += delta;
    ctx.currentTime = time;
    await vi.advanceTimersByTimeAsync(50);
    await flush();
  }

  /** Lets a fade-out finish (seek and track changes wait 30 ms to avoid a click, B5). */
  async function declicked(): Promise<void> {
    await vi.advanceTimersByTimeAsync(60);
    await flush();
  }

  /** Output gain nodes of the decks, in the order they were created. */
  const deckGains = (): FakeGain[] => {
    const bus = ctx.gains[0];
    return ctx.gains.filter((gain) => gain.targets.includes(bus));
  };

  /** A (60 s, streamed) plays from 0; B (30 s) is decoded and set to crossfade in at 55 s. */
  async function crossfadeScheduled(): Promise<void> {
    engine.load(A, 0, true);
    engine.prepareNext(B, { kind: 'crossfade', durationMs: 5000 });
    await at(20); // 40 s left: B is decoded
    await at(53); // 7 s left: the 5 s crossfade is scheduled to start at 55 s
  }

  it('schedules an equal-power crossfade before the end and hands over when it starts', async () => {
    await crossfadeScheduled();
    const [a, b] = deckGains();
    expect(ctx.sources.at(-1)?.started).toEqual({ when: 55, offset: 0 });
    const fadeOut = a?.gain.pending().find((event) => event.kind === 'curve');
    expect(fadeOut?.time).toBe(55);
    expect(fadeOut?.value).toBeCloseTo(0, 6);
    const fadeIn = b?.gain.pending().find((event) => event.kind === 'curve');
    expect(fadeIn?.time).toBe(55);
    expect(fadeIn?.value).toBeCloseTo(dbToGain(B.gainDb), 6);
    expect(events.some((event) => event.type === 'transitioned')).toBe(false);

    await at(55.05);
    expect(events.at(-1)).toEqual({ type: 'transitioned', key: B.key });
  });

  it('cancels a scheduled crossfade on seek and schedules it again from the new end', async () => {
    await crossfadeScheduled();
    const [a, b] = deckGains();
    const scheduled = ctx.sources.at(-1);
    await at(54);
    engine.seek(10_000);
    await declicked();

    // B is unscheduled, silent and back at its start; A plays on at its own level, no fade left.
    expect(scheduled?.stopped).toBe(true);
    expect(b?.gain.value).toBe(0);
    expect(b?.gain.pending()).toEqual([]);
    expect(a?.gain.pending()).toEqual([{ kind: 'set', time: 54, value: dbToGain(A.gainDb) }]);
    expect(engine.positionMs()).toBe(10_000);

    await at(56);
    expect(events.some((event) => event.type === 'transitioned')).toBe(false);

    // From 10 s at 54 s, A ends at 104 s: the crossfade now starts at 99 s.
    await at(97);
    expect(ctx.sources.at(-1)?.started).toEqual({ when: 99, offset: 0 });
    await at(99.05);
    expect(events.at(-1)).toEqual({ type: 'transitioned', key: B.key });
  });

  it('seeks the incoming track during a crossfade: the outgoing one stops, no fade is left', async () => {
    await crossfadeScheduled();
    const [a, b] = deckGains();
    const fadingIn = ctx.sources.at(-1);
    await at(55.05);
    await at(57);
    engine.seek(10_000);
    await declicked();

    expect(FakeAudio.all[0]?.paused).toBe(true);
    expect(a?.disconnected).toBe(true);
    expect(fadingIn?.stopped).toBe(true);
    expect(b?.gain.pending()).toEqual([{ kind: 'set', time: 57, value: dbToGain(B.gainDb) }]);
    const restarted = ctx.sources.at(-1)?.started;
    expect(restarted?.offset).toBe(10);
    expect(restarted?.when).toBeCloseTo(57.005, 6);
    expect(engine.positionMs()).toBe(10_000);

    // The outgoing track never reports its end: only the one hand-over happened.
    await at(61);
    const endings = events.filter((e) => e.type === 'transitioned' || e.type === 'ended');
    expect(endings).toEqual([{ type: 'transitioned', key: B.key }]);
    expect(events.at(-1)).toEqual({ type: 'playing', key: B.key });
  });

  it('switches at once on a manual change during a crossfade, leaving nothing behind', async () => {
    await crossfadeScheduled();
    const [a, b] = deckGains();
    await at(55.05);
    await at(57);

    // What the player does on "next": stop, then load the chosen track.
    engine.stop();
    engine.load(C, 0, true);
    await declicked();

    expect(FakeAudio.all[0]?.paused).toBe(true);
    expect(a?.disconnected).toBe(true);
    expect(b?.disconnected).toBe(true);
    expect(ctx.sources.every((source) => source.stopped)).toBe(true);
    expect(deckGains().at(-1)?.gain.value).toBe(dbToGain(C.gainDb));
    const audio = FakeAudio.all.at(-1);
    expect(audio?.src).toBe(C.url);
    expect(audio?.paused).toBe(false);
    expect(audio?.currentTime).toBe(0);

    await at(70);
    expect(events.at(-1)).toEqual({ type: 'buffering', key: C.key });
  });
});

// B5 (docs/qa/I6B_QA_2026-11-05.md): a jump at full volume clicks.
describe('WebAudioEngine without clicks', () => {
  const A = track('a', 60);
  const C = track('c', 30);

  let ctx: FakeContext;
  let engine: WebAudioEngine;

  beforeEach(() => {
    vi.useFakeTimers();
    FakeAudio.all.length = 0;
    vi.stubGlobal('Audio', FakeAudio);
    vi.stubGlobal('MediaError', { MEDIA_ERR_DECODE: 3 });
    ctx = new FakeContext();
    engine = new WebAudioEngine({
      createContext: () => ctx as unknown as AudioContext,
      fetch: () => Promise.reject(new Error('not needed')),
    });
  });

  afterEach(() => {
    engine.dispose();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  async function playingAt(seconds: number): Promise<FakeAudio> {
    engine.load(A, 0, true);
    await flush();
    const audio = FakeAudio.all[0];
    if (audio === undefined) throw new Error('no <audio>');
    audio.currentTime = seconds;
    ctx.currentTime = seconds;
    return audio;
  }

  /** Bus, preamp, volume, then the decks: the master volume is the third gain node. */
  const volume = (): FakeParam => {
    const node = ctx.gains[2];
    if (node === undefined) throw new Error('no context yet');
    return node.gain;
  };

  it('fades out before a seek, jumps, and fades back in', async () => {
    const audio = await playingAt(5);
    engine.seek(30_000);

    // Still at the old place, fading out; the position already reports the target.
    expect(audio.currentTime).toBe(5);
    expect(volume().pending().at(-1)).toMatchObject({ kind: 'ramp', value: 0 });
    expect(volume().pending().at(-1)?.time).toBeCloseTo(5.03, 6);
    expect(engine.positionMs()).toBe(30_000);

    await vi.advanceTimersByTimeAsync(40);
    expect(audio.currentTime).toBe(30);
    expect(volume().pending().at(-1)).toMatchObject({ kind: 'ramp', value: 1 });
  });

  it('shares one fade while the progress bar is dragged; the last position wins', async () => {
    const audio = await playingAt(5);
    engine.seek(20_000);
    engine.seek(25_000);
    engine.seek(40_000);
    const fades = volume().events.filter((event) => event.kind === 'ramp' && event.value === 0);
    expect(fades).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(40);
    expect(audio.currentTime).toBe(40);
  });

  it('lands a seek at once when paused during the fade', async () => {
    const audio = await playingAt(5);
    engine.seek(30_000);
    engine.pause();
    expect(audio.currentTime).toBe(30);
    await vi.advanceTimersByTimeAsync(100);
    expect(audio.currentTime).toBe(30);
    expect(volume().pending().at(-1)).toMatchObject({ kind: 'ramp', value: 0 });
  });

  it('fades the old track out on a manual change instead of cutting it', async () => {
    await playingAt(5);
    const old = ctx.gains[3];
    engine.stop();
    engine.load(C, 0, true);

    expect(old?.disconnected).toBe(false);
    expect(old?.gain.pending().at(-1)).toMatchObject({ kind: 'ramp', value: 0 });
    expect(FakeAudio.all[1]?.paused).toBe(false);

    await vi.advanceTimersByTimeAsync(60);
    expect(old?.disconnected).toBe(true);
    expect(FakeAudio.all[0]?.paused).toBe(true);
  });

  it('drops a paused track at once: nothing sounds, nothing to fade', async () => {
    await playingAt(5);
    engine.pause();
    const old = ctx.gains[3];
    engine.stop();
    expect(old?.disconnected).toBe(true);
  });
});
