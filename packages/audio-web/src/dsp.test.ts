import { describe, expect, it } from 'vitest';

import {
  crossfadeSeconds,
  dbToGain,
  EQ_BANDS_HZ,
  EQ_PRESETS,
  eqPreampDb,
  fadeCurve,
  normalizeBalance,
  normalizeEq,
  volumeToGain,
} from './dsp.js';

describe('normalizeBalance', () => {
  it('clamps, rounds and snaps to centre', () => {
    expect(normalizeBalance(0.004)).toBe(0);
    expect(normalizeBalance(-3)).toBe(-1);
    expect(normalizeBalance(0.333)).toBe(0.33);
    expect(normalizeBalance(Number.NaN)).toBe(0);
  });
});

describe('gain math', () => {
  it('converts decibels and volume', () => {
    expect(dbToGain(0)).toBe(1);
    expect(dbToGain(-6)).toBeCloseTo(0.501, 3);
    expect(dbToGain(6)).toBeCloseTo(1.995, 3);
    expect(volumeToGain(0)).toBe(0);
    expect(volumeToGain(0.5)).toBe(0.25);
    expect(volumeToGain(1)).toBe(1);
    expect(volumeToGain(7)).toBe(1);
    expect(volumeToGain(-1)).toBe(0);
  });
});

describe('equalizer', () => {
  it('has ten bands and presets within range', () => {
    expect(EQ_BANDS_HZ).toHaveLength(10);
    for (const gains of Object.values(EQ_PRESETS)) {
      expect(gains).toHaveLength(10);
      expect(normalizeEq(gains)).toEqual(gains);
    }
  });

  it('clamps gains and lowers the signal by the largest boost', () => {
    expect(normalizeEq([20, -20, Number.NaN])).toEqual([12, -12, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(eqPreampDb(EQ_PRESETS.bass)).toBe(-6);
    expect(eqPreampDb([-3, -3])).toBe(0);
    expect(eqPreampDb(EQ_PRESETS.flat)).toBe(0);
  });
});

describe('crossfade', () => {
  it('keeps the power constant through an equal-power fade', () => {
    const fadeIn = fadeCurve('in', 1, 33);
    const fadeOut = fadeCurve('out', 1, 33);
    expect(fadeIn[0]).toBe(0);
    expect(fadeIn[32]).toBeCloseTo(1, 6);
    expect(fadeOut[0]).toBe(1);
    expect(fadeOut[32]).toBeCloseTo(0, 6);
    for (let i = 0; i < 33; i += 1) {
      expect((fadeIn[i] ?? 0) ** 2 + (fadeOut[i] ?? 0) ** 2).toBeCloseTo(1, 5);
    }
    expect(fadeCurve('out', 0.5, 2)[0]).toBe(0.5);
  });

  it('never takes more than half of either track', () => {
    expect(crossfadeSeconds(6000, 200, 180)).toBe(6);
    expect(crossfadeSeconds(6000, 8, 180)).toBe(4);
    expect(crossfadeSeconds(6000, 200, 3)).toBe(1.5);
    expect(crossfadeSeconds(0, 200, 180)).toBe(0);
  });
});
