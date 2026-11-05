import type { SyncChange, SyncChangesPage } from '@mp/contracts';
import { describe, expect, it } from 'vitest';

import { RETRY_MAX_MS, RETRY_MIN_MS, SyncEngine, type SyncEngineOptions } from './engine.js';
import { MemoryOutbox } from './memory.js';
import type { FailureKind, OutboxEntry, SyncTransport, Timer } from './types.js';

class Offline extends Error {}
class Refused extends Error {}
class Gone extends Error {}

/** Timers fire only when the test says so. */
class FakeTimer implements Timer {
  private next = 0;
  readonly pending = new Map<number, { run: () => void; ms: number }>();

  set(run: () => void, ms: number): unknown {
    this.next += 1;
    this.pending.set(this.next, { run, ms });
    return this.next;
  }

  clear(handle: unknown): void {
    this.pending.delete(handle as number);
  }

  delays(): number[] {
    return [...this.pending.values()].map((timer) => timer.ms);
  }

  fireAll(): void {
    const timers = [...this.pending.entries()];
    this.pending.clear();
    for (const [, timer] of timers) timer.run();
  }
}

const settle = async () => {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
};

function change(seq: number, mutationId: string | null = null): SyncChange {
  return {
    seq,
    entity: 'track_like',
    entityId: '0190f000-0000-7000-8000-000000000001',
    op: 'upsert',
    payload: null,
    mutationId,
    at: '2026-11-05T12:00:00Z',
  };
}

class FakeTransport implements SyncTransport {
  sent: OutboxEntry[] = [];
  online = true;
  refuse = new Set<string>();
  seq = 0;
  log: SyncChange[] = [];
  gone = false;
  pageSize = 500;

  send(entry: OutboxEntry): Promise<void> {
    if (!this.online) return Promise.reject(new Offline());
    if (this.refuse.has(entry.id)) return Promise.reject(new Refused());
    this.sent.push(entry);
    return Promise.resolve();
  }

  changes(since: number): Promise<SyncChangesPage> {
    if (!this.online) return Promise.reject(new Offline());
    if (this.gone) return Promise.reject(new Gone());
    const after = this.log.filter((c) => c.seq > since);
    const changes = after.slice(0, this.pageSize);
    return Promise.resolve({
      changes,
      seq: changes.at(-1)?.seq ?? since,
      hasMore: after.length > changes.length,
    });
  }

  state(): Promise<number> {
    if (!this.online) return Promise.reject(new Offline());
    return Promise.resolve(this.seq);
  }

  classify(error: unknown): FailureKind {
    if (error instanceof Offline) return 'retry';
    if (error instanceof Gone) return 'gone';
    return 'reject';
  }
}

function setup(patch: Partial<SyncEngineOptions> = {}) {
  const storage = new MemoryOutbox();
  const transport = new FakeTransport();
  const timer = new FakeTimer();
  let id = 0;
  let clock = 1000;
  const remote: SyncChange[][] = [];
  const rejected: OutboxEntry[] = [];
  const sentEvents: OutboxEntry[] = [];
  let resets = 0;
  const engine = new SyncEngine({
    storage,
    transport,
    timer,
    newId: () => `id-${String((id += 1))}`,
    now: () => (clock += 1),
    onRemote: (changes) => remote.push([...changes]),
    onRejected: (entry) => rejected.push(entry),
    onSent: (entry) => sentEvents.push(entry),
    onReset: () => (resets += 1),
    ...patch,
  });
  return { engine, storage, transport, timer, remote, rejected, sentEvents, resets: () => resets };
}

const like = (id: string, saved = true) =>
  ({ type: 'library', kind: 'tracks', id, saved }) as const;

describe('SyncEngine outbox', () => {
  it('sends queued changes in order and empties the queue', async () => {
    const { engine, transport, storage, sentEvents } = setup();
    await engine.start();
    await engine.enqueue(like('a'));
    await engine.enqueue({ type: 'playlist.create', name: 'Road', description: null });
    await engine.flush();
    await settle();
    expect(transport.sent.map((e) => e.op.type)).toEqual(['library', 'playlist.create']);
    expect(sentEvents).toHaveLength(2);
    expect(await storage.list()).toEqual([]);
    expect(engine.getStatus()).toMatchObject({ pending: 0, offline: false });
  });

  it('keeps changes made offline, retries with growing pauses and sends them once', async () => {
    const { engine, transport, timer, storage } = setup();
    transport.online = false;
    await engine.start();
    await engine.enqueue(like('a'));
    await settle();
    expect(engine.getStatus()).toMatchObject({ pending: 1, offline: true });
    expect(timer.delays()).toEqual([RETRY_MIN_MS]);
    timer.fireAll();
    await settle();
    expect(timer.delays()).toEqual([RETRY_MIN_MS * 2]);
    for (let i = 0; i < 10; i += 1) {
      timer.fireAll();
      await settle();
    }
    expect(timer.delays()).toEqual([RETRY_MAX_MS]);
    expect(await storage.list()).toHaveLength(1);

    transport.online = true;
    engine.online();
    await settle();
    expect(transport.sent).toHaveLength(1);
    expect(engine.getStatus()).toMatchObject({ pending: 0, offline: false });
    expect(timer.delays()).toEqual([]);
  });

  it('survives a reload: a new engine on the same storage sends what was left', async () => {
    const first = setup();
    first.transport.online = false;
    await first.engine.start();
    await first.engine.enqueue(like('a'));
    first.engine.dispose();

    const transport = new FakeTransport();
    const second = new SyncEngine({
      storage: first.storage,
      transport,
      timer: new FakeTimer(),
      newId: () => 'x',
      now: () => 0,
    });
    await second.start();
    await settle();
    expect(transport.sent.map((e) => e.id)).toEqual(['id-1']);
  });

  it('keeps only the last state of a like and merges settings while waiting', async () => {
    const { engine, transport, storage } = setup();
    transport.online = false;
    await engine.start();
    await engine.enqueue(like('a', true));
    await settle();
    await engine.enqueue(like('b', true));
    await engine.enqueue(like('a', false));
    await engine.enqueue({ type: 'settings', historyEnabled: false });
    await engine.enqueue({ type: 'settings', playback: undefined, historyEnabled: true });
    const ops = (await storage.list()).map((e) => e.op);
    expect(ops).toEqual([
      like('b', true),
      like('a', false),
      { type: 'settings', playback: undefined, historyEnabled: true },
    ]);
  });

  it('drops a change the server refuses and reports it', async () => {
    const { engine, transport, rejected } = setup();
    await engine.start();
    transport.refuse.add('id-1');
    await engine.enqueue(like('gone'));
    await engine.enqueue(like('b'));
    await engine.flush();
    await settle();
    expect(rejected.map((e) => e.id)).toEqual(['id-1']);
    expect(transport.sent.map((e) => e.id)).toEqual(['id-2']);
  });

  it('sends under the lock, so two tabs never send the same queue at once', async () => {
    const order: string[] = [];
    let held = false;
    const lock = async <T>(_name: string, run: () => Promise<T>): Promise<T> => {
      expect(held).toBe(false);
      held = true;
      order.push('lock');
      try {
        return await run();
      } finally {
        held = false;
      }
    };
    const { engine, transport } = setup({ lock });
    await engine.start();
    await Promise.all([engine.enqueue(like('a')), engine.enqueue(like('b'))]);
    await engine.flush();
    await settle();
    expect(transport.sent).toHaveLength(2);
    expect(order.length).toBeGreaterThan(0);
  });
});

describe('SyncEngine catching up', () => {
  it('starts from the current version and then takes only newer changes', async () => {
    const { engine, transport, remote } = setup();
    transport.seq = 5;
    transport.log = [change(4), change(5)];
    await engine.start();
    expect(engine.getStatus().seq).toBe(5);
    expect(remote).toEqual([]);

    transport.log.push(change(6), change(7));
    engine.notify(7);
    await settle();
    expect(remote).toEqual([[change(6), change(7)]]);
    expect(engine.getStatus().seq).toBe(7);
    engine.notify(7);
    await settle();
    expect(remote).toHaveLength(1);
  });

  it('skips its own changes, also the ones it made directly', async () => {
    const { engine, transport, remote } = setup();
    await engine.start();
    const entry = await engine.enqueue(like('a'));
    engine.remember('direct-key');
    transport.log = [change(1, entry.id), change(2, 'direct-key'), change(3, 'other-tab')];
    await engine.catchUp();
    expect(remote).toEqual([[change(3, 'other-tab')]]);
    expect(engine.getStatus().seq).toBe(3);
  });

  it('pages through a long log', async () => {
    const { engine, transport, remote } = setup();
    await engine.start();
    transport.pageSize = 2;
    transport.log = [1, 2, 3, 4, 5].map((seq) => change(seq));
    await engine.catchUp();
    expect(remote.map((page) => page.map((c) => c.seq))).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('reloads everything when the log no longer has its version', async () => {
    const { engine, transport, resets } = setup();
    await engine.start();
    transport.gone = true;
    transport.seq = 40;
    await engine.catchUp();
    expect(resets()).toBe(1);
    expect(engine.getStatus().seq).toBe(40);
  });

  it('waits quietly without network', async () => {
    const { engine, transport, remote } = setup();
    transport.online = false;
    await engine.start();
    expect(engine.getStatus().seq).toBeNull();
    transport.online = true;
    transport.seq = 3;
    engine.online();
    await settle();
    expect(engine.getStatus().seq).toBe(3);
    expect(remote).toEqual([]);
  });
});
