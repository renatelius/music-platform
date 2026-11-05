import { describe, expect, it } from 'vitest';

import { PlayQueue } from './queue.js';
import type { QueueTrack } from './types.js';

const track = (id: string, release = 'r1'): QueueTrack => ({
  id,
  title: `Track ${id}`,
  durationMs: 180_000,
  artists: [{ id: 'a1', name: 'Artist' }],
  release: { id: release, title: 'Release' },
});
const tracks = (...ids: string[]) => ids.map((id) => track(id));
const ids = (queue: PlayQueue) => queue.list().map((entry) => entry.track.id);

/** Deterministic "random" for shuffles. */
function seeded(seed = 7): () => number {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
}

describe('PlayQueue', () => {
  it('starts at the requested track and clamps the index', () => {
    const queue = new PlayQueue();
    queue.replace(tracks('a', 'b', 'c'), 1);
    expect(queue.current()?.track.id).toBe('b');
    queue.replace(tracks('a', 'b'), 10);
    expect(queue.current()?.track.id).toBe('b');
    queue.replace([]);
    expect(queue.current()).toBeNull();
    expect(queue.index).toBe(-1);
    expect(queue.peekNext(true)).toBeNull();
  });

  it('gives every entry its own uid, even for the same track', () => {
    const queue = new PlayQueue();
    queue.replace(tracks('a', 'a'));
    const [first, second] = queue.list();
    expect(first?.uid).not.toBe(second?.uid);
  });

  it('follows repeat modes for automatic and manual next', () => {
    const queue = new PlayQueue();
    queue.replace(tracks('a', 'b'), 1);
    expect(queue.peekNext(true)).toBeNull();
    expect(queue.peekNext(false)).toBeNull();
    queue.setRepeat('all');
    expect(queue.peekNext(true)).toBe(0);
    queue.setRepeat('one');
    expect(queue.peekNext(true)).toBe(1);
    expect(queue.peekNext(false)).toBe(0);
  });

  it('goes back, wraps with repeat all, and stays on the first track otherwise', () => {
    const queue = new PlayQueue();
    queue.replace(tracks('a', 'b', 'c'), 1);
    expect(queue.peekPrevious()).toBe(0);
    queue.moveTo(0);
    expect(queue.peekPrevious()).toBe(0);
    queue.setRepeat('all');
    expect(queue.peekPrevious()).toBe(2);
  });

  it('shuffles with the current track first and restores the original order', () => {
    const queue = new PlayQueue(seeded());
    const all = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    queue.replace(tracks(...all), 3);
    queue.setShuffle(true);
    expect(queue.index).toBe(0);
    expect(queue.current()?.track.id).toBe('d');
    expect([...ids(queue)].sort()).toEqual(all);
    expect(ids(queue)).not.toEqual(['d', 'a', 'b', 'c', 'e', 'f', 'g', 'h']);

    queue.moveTo(4);
    const now = queue.current()?.track.id;
    queue.setShuffle(false);
    expect(ids(queue)).toEqual(all);
    expect(queue.current()?.track.id).toBe(now);
  });

  it('starts a shuffled queue with the chosen track', () => {
    const queue = new PlayQueue(seeded(3));
    queue.setShuffle(true);
    queue.replace(tracks('a', 'b', 'c', 'd'), 2);
    expect(queue.index).toBe(0);
    expect(queue.current()?.track.id).toBe('c');
  });

  it('adds next after the current track in both orders, and appends at the end', () => {
    const queue = new PlayQueue(seeded());
    queue.replace(tracks('a', 'b', 'c'), 0);
    queue.addNext(tracks('x'));
    queue.append(tracks('z'));
    expect(ids(queue)).toEqual(['a', 'x', 'b', 'c', 'z']);
    queue.setShuffle(true);
    queue.addNext(tracks('y'));
    expect(ids(queue)[1]).toBe('y');
    queue.setShuffle(false);
    expect(ids(queue)).toEqual(['a', 'y', 'x', 'b', 'c', 'z']);
  });

  it('removes and moves entries but never removes the current one', () => {
    const queue = new PlayQueue();
    queue.replace(tracks('a', 'b', 'c', 'd'), 2);
    const [a, , c, d] = queue.list();
    expect(queue.remove(c?.uid ?? '')).toBe(false);
    expect(queue.remove(a?.uid ?? '')).toBe(true);
    expect(ids(queue)).toEqual(['b', 'c', 'd']);
    expect(queue.current()?.track.id).toBe('c');
    expect(queue.move(d?.uid ?? '', 0)).toBe(true);
    expect(ids(queue)).toEqual(['d', 'b', 'c']);
    expect(queue.current()?.track.id).toBe('c');
    expect(queue.index).toBe(2);
    expect(queue.remove('nope')).toBe(false);
  });

  it('round-trips a snapshot and rejects inconsistent ones', () => {
    const queue = new PlayQueue(seeded());
    queue.replace(tracks('a', 'b', 'c'), 1);
    queue.setShuffle(true);
    queue.setRepeat('all');
    const snapshot = queue.snapshot();

    const restored = new PlayQueue();
    expect(restored.restore(snapshot)).toBe(true);
    expect(ids(restored)).toEqual(ids(queue));
    expect(restored.current()?.uid).toBe(queue.current()?.uid);
    expect(restored.shuffle).toBe(true);
    expect(restored.repeat).toBe('all');
    // New entries never reuse restored uids.
    const [added] = restored.append(tracks('d'));
    expect(snapshot.entries.map((entry) => entry.uid)).not.toContain(added?.uid);

    const broken = new PlayQueue();
    expect(broken.restore({ ...snapshot, position: 7 })).toBe(false);
    expect(broken.restore({ ...snapshot, order: [...snapshot.order.slice(1), 'x'] })).toBe(false);
    expect(broken.restore({ ...snapshot, order: snapshot.order.slice(1) })).toBe(false);
    expect(broken.current()).toBeNull();
  });
});
