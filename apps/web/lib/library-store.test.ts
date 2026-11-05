import { describe, expect, it } from 'vitest';

import { CONTAINS_BATCH, type ContainsQuery, SavedStore } from './library-store';

function setup(saved: ContainsQuery = { tracks: [], releases: [], artists: [] }) {
  const queries: ContainsQuery[] = [];
  const sent: string[] = [];
  let fail = false;
  let run: (() => void) | null = null;
  const store = new SavedStore(
    (query) => {
      queries.push(query);
      return Promise.resolve({
        tracks: query.tracks.filter((id) => saved.tracks.includes(id)),
        releases: query.releases.filter((id) => saved.releases.includes(id)),
        artists: query.artists.filter((id) => saved.artists.includes(id)),
      });
    },
    (kind, id, value) => {
      sent.push(`${kind}:${id}:${String(value)}`);
      return fail ? Promise.reject(new Error('offline')) : Promise.resolve();
    },
    (next) => {
      run = next;
    },
  );
  const flush = async () => {
    const pending = run;
    run = null;
    pending?.();
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  };
  return { store, queries, sent, flush, failNext: () => (fail = true) };
}

describe('SavedStore', () => {
  it('asks once per tick for every unknown id and remembers the answer', async () => {
    const { store, queries, flush } = setup({ tracks: ['a'], releases: ['r'], artists: [] });
    store.request('tracks', 'a');
    store.request('tracks', 'b');
    store.request('tracks', 'a');
    store.request('releases', 'r');
    expect(store.get('tracks', 'a')).toBeUndefined();
    await flush();
    expect(queries).toEqual([{ tracks: ['a', 'b'], releases: ['r'], artists: [] }]);
    expect(store.get('tracks', 'a')).toBe(true);
    expect(store.get('tracks', 'b')).toBe(false);
    expect(store.get('releases', 'r')).toBe(true);
    store.request('tracks', 'a');
    await flush();
    expect(queries).toHaveLength(1);
  });

  it(`splits large screens into requests of at most ${String(CONTAINS_BATCH)} ids`, async () => {
    const { store, queries, flush } = setup();
    for (let i = 0; i < 250; i += 1) store.request('tracks', `t${String(i)}`);
    await flush();
    expect(queries.map((query) => query.tracks.length)).toEqual([100, 100, 50]);
  });

  it('toggles at once and rolls back when the server refuses', async () => {
    const { store, sent, flush, failNext } = setup({ tracks: ['a'], releases: [], artists: [] });
    store.request('tracks', 'a');
    await flush();
    let changes = 0;
    store.subscribe(() => (changes += 1));
    expect(await store.toggle('tracks', 'a')).toBe(false);
    expect(store.get('tracks', 'a')).toBe(false);
    failNext();
    await expect(store.toggle('tracks', 'a')).rejects.toThrow('offline');
    expect(store.get('tracks', 'a')).toBe(false);
    expect(sent).toEqual(['tracks:a:false', 'tracks:a:true']);
    expect(changes).toBe(3);
  });

  it('asks again about known ids on refresh', async () => {
    const saved: ContainsQuery = { tracks: [], releases: [], artists: [] };
    const { store, queries, flush } = setup(saved);
    store.request('artists', 'x');
    await flush();
    expect(store.get('artists', 'x')).toBe(false);
    saved.artists.push('x');
    store.refresh();
    await flush();
    expect(queries).toHaveLength(2);
    expect(store.get('artists', 'x')).toBe(true);
  });

  it('keeps a waiting change over the server answer and marks a refused one', async () => {
    const { store, flush } = setup({ tracks: [], releases: [], artists: [] });
    store.setOverlay((kind, id) => (kind === 'tracks' && id === 'a' ? true : undefined));
    store.request('tracks', 'a');
    store.request('tracks', 'b');
    await flush();
    expect(store.get('tracks', 'a')).toBe(true);
    expect(store.get('tracks', 'b')).toBe(false);

    store.rejected('tracks', 'a', false);
    expect(store.get('tracks', 'a')).toBe(false);
    expect(store.hasFailed('tracks', 'a')).toBe(true);
    await store.toggle('tracks', 'a');
    expect(store.hasFailed('tracks', 'a')).toBe(false);
  });
});
