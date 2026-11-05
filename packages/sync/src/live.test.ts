import { describe, expect, it } from 'vitest';

import { LiveChannel, RECONNECT_MIN_MS, type SocketLike } from './live.js';
import type { Timer } from './types.js';

class FakeSocket implements SocketLike {
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  constructor(readonly ticket: string) {}

  close(): void {
    this.closed = true;
  }
}

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
  fireAll(): void {
    const timers = [...this.pending.values()];
    this.pending.clear();
    for (const timer of timers) timer.run();
  }
}

const settle = async () => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

function setup() {
  const sockets: FakeSocket[] = [];
  const seqs: number[] = [];
  const states: boolean[] = [];
  const timer = new FakeTimer();
  let tickets = 0;
  let failTicket = false;
  const live = new LiveChannel({
    ticket: () =>
      failTicket ? Promise.reject(new Error('offline')) : Promise.resolve(`t${String(++tickets)}`),
    open: (ticket) => {
      const socket = new FakeSocket(ticket);
      sockets.push(socket);
      return socket;
    },
    timer,
    onSeq: (seq) => seqs.push(seq),
    onConnected: (connected) => states.push(connected),
  });
  return {
    live,
    sockets,
    seqs,
    states,
    timer,
    setFailTicket: (value: boolean) => {
      failTicket = value;
    },
  };
}

describe('LiveChannel', () => {
  it('passes versions from hello and changed, ignores anything else', async () => {
    const { live, sockets, seqs, states } = setup();
    live.start();
    await settle();
    const socket = sockets[0];
    if (socket === undefined) throw new Error('no socket');
    expect(socket.ticket).toBe('t1');
    socket.onopen?.();
    socket.onmessage?.({ data: JSON.stringify({ type: 'hello', seq: 3 }) });
    socket.onmessage?.({ data: JSON.stringify({ type: 'changed', seq: 4 }) });
    socket.onmessage?.({ data: '{"type":"other"}' });
    socket.onmessage?.({ data: 'not json' });
    expect(seqs).toEqual([3, 4]);
    expect(states).toEqual([true]);
    expect(live.isConnected).toBe(true);
  });

  it('reconnects with a new ticket after the channel is lost', async () => {
    const { live, sockets, timer } = setup();
    live.start();
    await settle();
    sockets[0]?.onopen?.();
    sockets[0]?.onclose?.({ code: 1006 });
    expect([...timer.pending.values()].map((t) => t.ms)).toEqual([RECONNECT_MIN_MS]);
    timer.fireAll();
    await settle();
    expect(sockets.map((s) => s.ticket)).toEqual(['t1', 't2']);
  });

  it('keeps trying while there is no network and connects at once when it is back', async () => {
    const { live, sockets, timer, setFailTicket } = setup();
    setFailTicket(true);
    live.start();
    await settle();
    timer.fireAll();
    await settle();
    expect([...timer.pending.values()].map((t) => t.ms)).toEqual([RECONNECT_MIN_MS * 2]);
    setFailTicket(false);
    live.reconnectNow();
    await settle();
    expect(sockets).toHaveLength(1);
    expect(timer.pending.size).toBe(0);
  });

  it('stops for good', async () => {
    const { live, sockets, timer } = setup();
    live.start();
    await settle();
    live.stop();
    expect(sockets[0]?.closed).toBe(true);
    expect(timer.pending.size).toBe(0);
  });
});
