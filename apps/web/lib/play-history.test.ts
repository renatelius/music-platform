import type { PlayEvent } from '@mp/contracts';
import { describe, expect, it } from 'vitest';

import { PlayTracker } from './play-history';

const entry = (uid: string, id: string, durationMs = 200_000) => ({
  uid,
  track: { id, durationMs },
});

function setup() {
  let time = Date.parse('2026-11-05T12:00:00Z');
  const events: PlayEvent[] = [];
  let id = 0;
  const tracker = new PlayTracker(
    (event) => events.push(event),
    () => time,
    () => `e${String((id += 1))}`,
  );
  return {
    tracker,
    events,
    advance: (ms: number) => {
      time += ms;
    },
  };
}

describe('PlayTracker', () => {
  it('reports the time a track sounded, without pauses, when the next one starts', () => {
    const { tracker, events, advance } = setup();
    const a = entry('1', 'track-a');
    tracker.update({ status: 'playing', current: a });
    advance(20_000);
    tracker.update({ status: 'paused', current: a });
    advance(60_000);
    tracker.update({ status: 'playing', current: a });
    advance(15_000);
    tracker.update({ status: 'playing', current: entry('2', 'track-b') });
    expect(events).toEqual([
      {
        clientEventId: 'e1',
        trackId: 'track-a',
        startedAt: '2026-11-05T12:00:00.000Z',
        playedMs: 35_000,
        completed: false,
        skipped: false,
        context: null,
      },
    ]);
  });

  it('marks skips and complete plays', () => {
    const { tracker, events, advance } = setup();
    tracker.update({ status: 'playing', current: entry('1', 'a') });
    advance(5_000);
    tracker.update({ status: 'playing', current: entry('2', 'b', 60_000) });
    advance(59_000);
    tracker.update({ status: 'idle', current: null });
    expect(events.map((e) => [e.trackId, e.skipped, e.completed])).toEqual([
      ['a', true, false],
      ['b', false, true],
    ]);
  });

  it('ignores a click through the queue and a track that never played', () => {
    const { tracker, events, advance } = setup();
    tracker.update({ status: 'paused', current: entry('1', 'a') });
    advance(30_000);
    tracker.update({ status: 'playing', current: entry('2', 'b') });
    advance(500);
    tracker.update({ status: 'playing', current: entry('3', 'c') });
    expect(events).toEqual([]);
  });

  it('ends the current play when the page goes away', () => {
    const { tracker, events, advance } = setup();
    tracker.update({ status: 'playing', current: entry('1', 'a') });
    advance(40_000);
    tracker.flush();
    expect(events.map((e) => e.playedMs)).toEqual([40_000]);
    tracker.flush();
    expect(events).toHaveLength(1);
  });
});
