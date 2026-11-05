import { beforeEach, describe, expect, it } from 'vitest';

import { fadeGain, SLEEP_FADE_MS, SleepTimer, type SleepTarget } from './sleep.js';

type Status = 'playing' | 'paused';

class FakePlayer implements SleepTarget {
  status: Status = 'playing';
  uid = 'q1';
  position = 0;
  duration = 180_000;
  lead = 0;
  calls: string[] = [];
  getState() {
    return {
      status: this.status,
      current: { uid: this.uid, track: { id: this.uid } },
    } as ReturnType<SleepTarget['getState']>;
  }
  positionMs() {
    return this.position;
  }
  durationMs() {
    return this.duration;
  }
  transitionLeadMs() {
    return this.lead;
  }
  pause() {
    this.status = 'paused';
    this.calls.push('pause');
  }
  seek(ms: number) {
    this.position = ms;
    this.calls.push(`seek ${String(ms)}`);
  }
}

describe('SleepTimer', () => {
  let now = 0;
  let player: FakePlayer;
  let fades: number[];
  let timer: SleepTimer;

  beforeEach(() => {
    now = 1_000_000;
    player = new FakePlayer();
    fades = [];
    timer = new SleepTimer({ player, fade: (g) => fades.push(g), now: () => now });
  });

  it('counts minutes down, fades out over the last ten seconds and pauses', () => {
    const states: unknown[] = [];
    timer.subscribe((s) => states.push(s.mode));
    timer.start({ kind: 'minutes', minutes: 15 });
    expect(timer.remainingMs()).toBe(15 * 60_000);
    now += 15 * 60_000 - SLEEP_FADE_MS / 2;
    timer.tick();
    expect(fades.at(-1)).toBeCloseTo(0.5);
    expect(player.calls).toEqual([]);
    now += SLEEP_FADE_MS;
    timer.tick();
    expect(player.calls).toEqual(['pause']);
    expect(fades.at(-1)).toBe(1);
    expect(timer.getState().mode).toBeNull();
    expect(states).toEqual([{ kind: 'minutes', minutes: 15 }, null]);
  });

  it('keeps counting while paused and ends without another pause', () => {
    timer.start({ kind: 'minutes', minutes: 1 });
    player.status = 'paused';
    now += 59_000;
    timer.tick();
    expect(fades).toEqual([0.1]);
    now += 2000;
    timer.tick();
    expect(player.calls).toEqual([]);
    expect(timer.getState().mode).toBeNull();
  });

  it('cancels and restores full volume', () => {
    timer.start({ kind: 'minutes', minutes: 1 });
    now += 55_000;
    timer.tick();
    timer.cancel();
    expect(fades.at(-1)).toBe(1);
    now += 60_000;
    timer.tick();
    expect(player.calls).toEqual([]);
  });

  it('returns the same state object until it changes (stable snapshot for React)', () => {
    const off = timer.getState();
    expect(timer.getState()).toBe(off);
    timer.start({ kind: 'minutes', minutes: 5 });
    const on = timer.getState();
    expect(on).not.toBe(off);
    now += 1000;
    timer.tick();
    expect(timer.getState()).toBe(on);
    timer.cancel();
    expect(timer.getState()).toEqual({ mode: null, endsAt: null });
  });

  it('rejects silly durations', () => {
    timer.start({ kind: 'minutes', minutes: 0 });
    timer.start({ kind: 'minutes', minutes: Number.NaN });
    expect(timer.getState().mode).toBeNull();
  });

  it('stops at the end of the current track', () => {
    timer.start({ kind: 'endOfTrack' });
    player.position = 175_000;
    timer.tick();
    expect(fades.at(-1)).toBeCloseTo(0.5);
    player.position = 179_800;
    timer.tick();
    expect(player.calls).toEqual(['pause']);
    expect(timer.getState().mode).toBeNull();
  });

  it('does not run down while the track is paused', () => {
    timer.start({ kind: 'endOfTrack' });
    player.status = 'paused';
    player.position = 179_900;
    timer.tick();
    expect(player.calls).toEqual([]);
    expect(timer.getState().mode).toEqual({ kind: 'endOfTrack' });
  });

  it('with a crossfade, stops before the next track fades in', () => {
    player.lead = 5000;
    timer.start({ kind: 'endOfTrack' });
    // 8 s to the end = 3 s before the crossfade starts: already fading.
    player.position = 172_000;
    timer.tick();
    expect(fades.at(-1)).toBeCloseTo(0.3);
    player.position = 174_800;
    timer.tick();
    expect(player.calls).toEqual(['pause']);
  });

  it('with a crossfade, treats the early track change as the automatic one', () => {
    player.lead = 5000;
    timer.start({ kind: 'endOfTrack' });
    player.position = 173_000;
    timer.tick();
    // Background tab: the crossfade started between two ticks, 4.5 s before the end.
    player.uid = 'q2';
    player.position = 500;
    timer.tick();
    expect(player.calls).toEqual(['pause', 'seek 0']);
  });

  it('follows a skip to the new track', () => {
    timer.start({ kind: 'endOfTrack' });
    player.position = 30_000;
    timer.tick();
    player.uid = 'q2';
    player.position = 1000;
    timer.tick();
    expect(player.calls).toEqual([]);
    player.position = 179_900;
    timer.tick();
    expect(player.calls).toEqual(['pause']);
  });

  it('stops the next track at once when the end was missed between ticks', () => {
    timer.start({ kind: 'endOfTrack' });
    player.position = 178_500;
    timer.tick();
    player.uid = 'q2';
    player.position = 800;
    timer.tick();
    expect(player.calls).toEqual(['pause', 'seek 0']);
    expect(timer.getState().mode).toBeNull();
  });
});

describe('fadeGain', () => {
  it('is linear over the fade window and clamped', () => {
    expect(fadeGain(SLEEP_FADE_MS)).toBe(1);
    expect(fadeGain(SLEEP_FADE_MS / 4)).toBe(0.25);
    expect(fadeGain(-5)).toBe(0);
    expect(fadeGain(1e9)).toBe(1);
  });
});
