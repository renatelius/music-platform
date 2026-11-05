import type { StreamSource } from '@mp/contracts';
import { beforeEach, describe, expect, it } from 'vitest';

import { MAX_SKIPS_IN_A_ROW, Player } from './player.js';
import { NotPlayableError, type ResolvedSource, type SourceResolver } from './source.js';
import type { AudioEngine, EngineEvent, EngineTrack, QueueTrack, Transition } from './types.js';

/** Records what the player asks for; tests play the engine's part by emitting events. */
class FakeEngine implements AudioEngine {
  loaded: { track: EngineTrack; positionMs: number } | null = null;
  prepared: { track: EngineTrack | null; transition: Transition } | null = null;
  calls: string[] = [];
  position = 0;
  gains = new Map<string, number>();
  volume = 1;
  muted = false;
  private listener: ((event: EngineEvent) => void) | null = null;

  load(track: EngineTrack, positionMs: number): void {
    this.calls.push(`load ${track.url} @${String(positionMs)}`);
    this.loaded = { track, positionMs };
    this.prepared = null;
    this.position = positionMs;
  }
  prepareNext(track: EngineTrack | null, transition: Transition): void {
    this.prepared = { track, transition };
  }
  play(): void {
    this.calls.push('play');
  }
  pause(): void {
    this.calls.push('pause');
  }
  seek(positionMs: number): void {
    this.calls.push(`seek ${String(positionMs)}`);
    this.position = positionMs;
  }
  stop(): void {
    this.calls.push('stop');
    this.loaded = null;
    this.prepared = null;
  }
  setVolume(volume: number): void {
    this.volume = volume;
  }
  setMuted(muted: boolean): void {
    this.muted = muted;
  }
  setGain(key: string, gainDb: number): void {
    this.gains.set(key, gainDb);
  }
  positionMs(): number {
    return this.position;
  }
  subscribe(listener: (event: EngineEvent) => void): () => void {
    this.listener = listener;
    return () => {
      this.listener = null;
    };
  }
  dispose(): void {
    this.calls.push('dispose');
  }

  emit(event: EngineEvent): void {
    this.listener?.(event);
  }
  get key(): string {
    if (this.loaded === null) throw new Error('nothing loaded');
    return this.loaded.track.key;
  }
  get preparedKey(): string {
    const key = this.prepared?.track?.key;
    if (key === undefined) throw new Error('nothing prepared');
    return key;
  }
}

const SOURCE: StreamSource = {
  codec: 'opus',
  container: 'webm',
  mimeType: 'audio/webm; codecs="opus"',
  bitrateKbps: 128,
  sampleRateHz: 48_000,
  bitDepth: null,
  channels: 2,
  quality: 'lossy',
  sizeBytes: 1000,
  url: '/media/x.sig',
};

class FakeResolver implements SourceResolver {
  unplayable = new Set<string>();
  offline = false;
  invalidated: string[] = [];
  resolve(trackId: string): Promise<ResolvedSource> {
    if (this.unplayable.has(trackId)) return Promise.reject(new NotPlayableError('not_found'));
    if (this.offline) return Promise.reject(new Error('network'));
    return Promise.resolve({
      url: `/media/${trackId}`,
      source: SOURCE,
      loudness: { integratedLufs: -12, truePeakDbtp: -2, replayGainDb: -6 },
    });
  }
  invalidate(trackId: string): void {
    this.invalidated.push(trackId);
  }
}

const track = (id: string, release = 'album-1'): QueueTrack => ({
  id,
  title: `Track ${id}`,
  durationMs: 200_000,
  artists: [{ id: 'a', name: 'Artist' }],
  release: { id: release, title: 'Release' },
});

/** Lets the resolver promises settle. */
async function settle(): Promise<void> {
  for (let i = 0; i < 100; i += 1) await Promise.resolve();
}

describe('Player', () => {
  let engine: FakeEngine;
  let resolver: FakeResolver;
  let player: Player;

  beforeEach(() => {
    engine = new FakeEngine();
    resolver = new FakeResolver();
    player = new Player({ engine, resolver });
  });

  async function playing(tracks: QueueTrack[], start = 0): Promise<void> {
    player.playTracks(tracks, start);
    await settle();
    engine.emit({ type: 'playing', key: engine.key });
  }

  it('loads the chosen track with ReplayGain and prepares the next one gapless', async () => {
    player.playTracks([track('a'), track('b')]);
    expect(player.getState().status).toBe('loading');
    await settle();
    expect(engine.loaded?.track).toMatchObject({
      url: '/media/a',
      gainDb: -6,
      durationMs: 200_000,
    });
    expect(engine.prepared?.track?.url).toBe('/media/b');
    expect(engine.prepared?.transition).toEqual({ kind: 'gapless' });
    engine.emit({ type: 'playing', key: engine.key });
    expect(player.getState()).toMatchObject({ status: 'playing', source: SOURCE, index: 0 });
  });

  it('follows the automatic transition and prepares the track after it', async () => {
    await playing([track('a'), track('b'), track('c')]);
    engine.emit({ type: 'transitioned', key: engine.preparedKey });
    await settle();
    expect(player.getState().current?.track.id).toBe('b');
    expect(player.getState().status).toBe('playing');
    expect(engine.prepared?.track?.url).toBe('/media/c');
  });

  it('crossfades between releases but keeps albums gapless', async () => {
    player.setSettings({ crossfadeMs: 6000 });
    await playing([track('a', 'r1'), track('b', 'r1'), track('c', 'r2')]);
    expect(engine.prepared?.transition).toEqual({ kind: 'gapless' });
    engine.emit({ type: 'transitioned', key: engine.preparedKey });
    await settle();
    expect(engine.prepared?.transition).toEqual({ kind: 'crossfade', durationMs: 6000 });
    player.setSettings({ gaplessAlbums: false, crossfadeMs: 99_000 });
    await settle();
    expect(player.getState().settings.crossfadeMs).toBe(12_000);
  });

  it('stops at the end of the queue, or wraps with repeat all', async () => {
    await playing([track('a')]);
    expect(engine.prepared?.track).toBeNull();
    engine.emit({ type: 'ended', key: engine.key });
    expect(player.getState()).toMatchObject({ status: 'paused', index: 0 });
    expect(player.positionMs()).toBe(0);

    player.setRepeat('all');
    player.play();
    await settle();
    engine.emit({ type: 'playing', key: engine.key });
    expect(engine.prepared?.track?.url).toBe('/media/a');
    engine.emit({ type: 'ended', key: engine.key });
    await settle();
    expect(engine.calls.filter((call) => call.startsWith('load'))).toHaveLength(3);
  });

  it('repeats one track with a fresh key each time', async () => {
    await playing([track('a'), track('b')]);
    player.setRepeat('one');
    await settle();
    const first = engine.key;
    expect(engine.prepared?.track?.url).toBe('/media/a');
    expect(engine.preparedKey).not.toBe(first);
  });

  it('restarts the track on "previous" after 3 seconds, otherwise goes back', async () => {
    await playing([track('a'), track('b')], 1);
    engine.position = 10_000;
    player.previous();
    expect(engine.calls.at(-1)).toBe('seek 0');
    engine.position = 1000;
    player.previous();
    await settle();
    expect(player.getState().current?.track.id).toBe('a');
    expect(engine.loaded?.track.url).toBe('/media/a');
  });

  it('selects without loading when paused, and plays from there', async () => {
    await playing([track('a'), track('b')]);
    player.pause();
    expect(engine.calls.at(-1)).toBe('pause');
    player.next();
    expect(player.getState()).toMatchObject({ status: 'paused', index: 1 });
    expect(engine.loaded).toBeNull();
    player.seek(5000);
    player.play();
    await settle();
    expect(engine.calls.at(-1)).toBe('load /media/b @5000');
  });

  it('skips unplayable tracks and stops when nothing plays', async () => {
    resolver.unplayable.add('a');
    resolver.unplayable.add('c');
    player.playTracks([track('a'), track('b'), track('c')]);
    await settle();
    expect(player.getState().current?.track.id).toBe('b');
    expect(engine.loaded?.track.url).toBe('/media/b');

    const tracks = Array.from({ length: MAX_SKIPS_IN_A_ROW + 2 }, (_, i) => track(`x${String(i)}`));
    for (const t of tracks) resolver.unplayable.add(t.id);
    player.playTracks(tracks);
    await settle();
    expect(player.getState()).toMatchObject({ status: 'error', error: 'not_playable' });
  });

  it('reports a network failure and retries on play', async () => {
    resolver.offline = true;
    player.playTracks([track('a'), track('b')]);
    await settle();
    expect(player.getState()).toMatchObject({ status: 'error', error: 'unavailable', index: 0 });
    resolver.offline = false;
    player.play();
    await settle();
    expect(engine.loaded?.track.url).toBe('/media/a');
  });

  it('renews an expired link once and resumes at the same position', async () => {
    await playing([track('a')]);
    engine.position = 42_000;
    engine.emit({ type: 'error', key: engine.key, reason: 'source' });
    await settle();
    expect(resolver.invalidated).toEqual(['a']);
    expect(engine.calls.at(-1)).toBe('load /media/a @42000');
    engine.emit({ type: 'error', key: engine.key, reason: 'source' });
    expect(player.getState()).toMatchObject({ status: 'error', error: 'unavailable' });
    expect(player.positionMs()).toBe(42_000);
  });

  it('skips a track whose file cannot be decoded', async () => {
    await playing([track('a'), track('b')]);
    engine.emit({ type: 'error', key: engine.key, reason: 'decode' });
    await settle();
    expect(engine.loaded?.track.url).toBe('/media/b');
  });

  it('ignores events from an older load', async () => {
    await playing([track('a'), track('b')]);
    const old = engine.key;
    player.jumpTo(1);
    await settle();
    engine.emit({ type: 'ended', key: old });
    engine.emit({ type: 'error', key: old, reason: 'decode' });
    expect(player.getState().current?.track.id).toBe('b');
    expect(engine.loaded?.track.url).toBe('/media/b');
  });

  it('updates the ReplayGain of the playing track when the setting changes', async () => {
    await playing([track('a')]);
    player.setSettings({ replayGain: { mode: 'off', preampDb: 0 } });
    expect(engine.gains.get(engine.key)).toBe(0);
    player.setSettings({ replayGain: { mode: 'track', preampDb: 20 } });
    // -6 + 6 (preamp clamped to 6) = 0, peak limit -1 - (-2) = 1.
    expect(engine.gains.get(engine.key)).toBe(0);
  });

  it('re-prepares the next track when the queue changes', async () => {
    await playing([track('a'), track('b')]);
    player.addNext([track('n')]);
    await settle();
    expect(engine.prepared?.track?.url).toBe('/media/n');
    player.setShuffle(true);
    await settle();
    expect(player.getState().index).toBe(0);
    expect(player.getState().shuffle).toBe(true);
  });

  it('saves and restores the session without playing', async () => {
    await playing([track('a'), track('b')], 1);
    engine.position = 61_000;
    player.setVolume(0.4);
    const snapshot = player.snapshot();

    const other = new FakeEngine();
    const restored = new Player({ engine: other, resolver });
    expect(restored.restore(snapshot)).toBe(true);
    expect(restored.getState()).toMatchObject({ status: 'paused', index: 1, volume: 0.4 });
    expect(restored.positionMs()).toBe(61_000);
    expect(other.loaded).toBeNull();
    restored.play();
    await settle();
    expect(other.calls.at(-1)).toBe('load /media/b @61000');
    expect(restored.restore({ ...snapshot, version: 2 })).toBe(false);
  });

  it('clamps volume and seek', async () => {
    await playing([track('a')]);
    player.setVolume(3);
    expect(engine.volume).toBe(1);
    player.seek(999_999);
    expect(engine.calls.at(-1)).toBe('seek 200000');
    player.seekBy(-500_000);
    expect(engine.calls.at(-1)).toBe('seek 0');
  });
});
