/** Deterministic Fisher-Yates shuffle: the same seed always gives the same order. */
export function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  // FNV-1a hash of the seed, then mulberry32.
  let hash = 2_166_136_261;
  for (const char of seed) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  let state = hash >>> 0;
  const random = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const a = out[i];
    const b = out[j];
    if (a !== undefined && b !== undefined) {
      out[i] = b;
      out[j] = a;
    }
  }
  return out;
}

/** Runs at most `limit` tasks at the same time. Tasks must handle their own errors. */
export class TaskPool {
  private readonly active = new Set<Promise<void>>();

  constructor(private readonly limit: number) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error('TaskPool limit must be >= 1');
  }

  /** Resolves as soon as the task has started (waits for a free slot first). */
  async run(task: () => Promise<void>): Promise<void> {
    while (this.active.size >= this.limit) await Promise.race(this.active);
    const promise: Promise<void> = task().finally(() => {
      this.active.delete(promise);
    });
    this.active.add(promise);
  }

  async drain(): Promise<void> {
    await Promise.all(this.active);
  }
}

export function increment(counts: Record<string, number>, key: string, by = 1): void {
  counts[key] = (counts[key] ?? 0) + by;
}

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit] ?? 'TB'}`;
}
