import { describe, expect, it } from 'vitest';

import { formatBytes, increment, seededShuffle, sleep, TaskPool } from './util.js';

describe('seededShuffle', () => {
  const items = Array.from({ length: 50 }, (_, i) => i);

  it('returns a permutation that depends only on the seed', () => {
    const a = seededShuffle(items, 'remusic');
    expect(seededShuffle(items, 'remusic')).toEqual(a);
    expect([...a].sort((x, y) => x - y)).toEqual(items);
    expect(a).not.toEqual(items);
    expect(seededShuffle(items, 'other')).not.toEqual(a);
    expect(seededShuffle([], 'x')).toEqual([]);
  });
});

describe('TaskPool', () => {
  it('never runs more tasks at once than its limit and waits for all of them', async () => {
    const pool = new TaskPool(2);
    let running = 0;
    let peak = 0;
    let done = 0;
    for (let i = 0; i < 6; i += 1) {
      await pool.run(async () => {
        running += 1;
        peak = Math.max(peak, running);
        await sleep(10);
        running -= 1;
        done += 1;
      });
    }
    await pool.drain();
    expect(peak).toBe(2);
    expect(done).toBe(6);
  });

  it('rejects a limit below one', () => {
    expect(() => new TaskPool(0)).toThrow();
  });
});

describe('helpers', () => {
  it('counts and formats', () => {
    const counts: Record<string, number> = {};
    increment(counts, 'a');
    increment(counts, 'a', 2);
    expect(counts).toEqual({ a: 3 });
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(250 * 1024 * 1024)).toBe('250 MB');
  });
});
