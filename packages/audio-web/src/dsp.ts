// Pure audio math, shared by the engine and its tests (no DOM here).

export const dbToGain = (db: number): number => 10 ** (db / 20);

/** Slider 0..1 to amplitude: a squared curve, so the lower half of the slider is usable. */
export function volumeToGain(volume: number): number {
  const v = Math.min(Math.max(volume, 0), 1);
  return v * v;
}

/** ISO octave centres, 31 Hz to 16 kHz. */
export const EQ_BANDS_HZ: readonly number[] = [
  31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16_000,
];
export const EQ_MAX_DB = 12;
/** One octave per band. */
export const EQ_Q = 1.41;

export type EqPresetName =
  'flat' | 'bass' | 'treble' | 'vocal' | 'loudness' | 'acoustic' | 'electronic';

export const EQ_PRESETS: Readonly<Record<EqPresetName, readonly number[]>> = {
  flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  bass: [6, 5, 4, 2, 0, 0, 0, 0, 0, 0],
  treble: [0, 0, 0, 0, 0, 1, 2, 4, 5, 6],
  vocal: [-2, -1, 0, 2, 4, 4, 3, 1, 0, -1],
  loudness: [5, 4, 2, 0, -1, 0, 1, 3, 4, 5],
  acoustic: [3, 3, 2, 1, 1, 1, 2, 3, 2, 1],
  electronic: [5, 4, 1, 0, -2, 1, 0, 2, 4, 5],
};

/** Ten gains, clamped to ±12 dB; anything else becomes flat. */
export function normalizeEq(gains: readonly number[]): number[] {
  return EQ_BANDS_HZ.map((_, i) => {
    const gain = gains[i] ?? 0;
    return Number.isFinite(gain) ? Math.min(Math.max(gain, -EQ_MAX_DB), EQ_MAX_DB) : 0;
  });
}

/** Lowers the signal by the largest boost, so the equalizer never clips. */
export function eqPreampDb(gains: readonly number[]): number {
  const boost = Math.max(0, ...normalizeEq(gains));
  return boost > 0 ? -boost : 0;
}

/** Equal-power fade (constant loudness through a crossfade), scaled to `level`. */
export function fadeCurve(
  direction: 'in' | 'out',
  level: number,
  steps = 64,
): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(steps);
  for (let i = 0; i < steps; i += 1) {
    const t = steps === 1 ? 1 : i / (steps - 1);
    const value = direction === 'in' ? Math.sin((t * Math.PI) / 2) : Math.cos((t * Math.PI) / 2);
    curve[i] = value * level;
  }
  return curve;
}

/** A crossfade never takes more than half of either track. */
export function crossfadeSeconds(requestedMs: number, currentSec: number, nextSec: number): number {
  return Math.max(0, Math.min(requestedMs / 1000, currentSec / 2, nextSec / 2));
}
