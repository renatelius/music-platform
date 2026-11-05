import { describe, expect, it } from 'vitest';

import { countsAsPlay, PlayEvent } from './history.js';
import { createProblem } from './problem.js';
import { PlaybackSettings } from './settings.js';
import { SyncChangesQuery, WsServerMessage, WsTicket } from './sync.js';

const playback = {
  crossfadeMs: 3000,
  gaplessAlbums: true,
  replayGain: 'track',
  quality: 'auto',
  eqEnabled: false,
  eqGains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  balance: 0,
  eqProfiles: [],
};

describe('sync contracts', () => {
  it('reads the version from the query string and caps the page', () => {
    expect(SyncChangesQuery.parse({ since: '12' })).toEqual({ since: 12, limit: 500 });
    expect(SyncChangesQuery.safeParse({ since: '-1' }).success).toBe(false);
    expect(SyncChangesQuery.safeParse({ since: '0', limit: '501' }).success).toBe(false);
  });

  it('knows the live channel messages and the ticket format', () => {
    expect(WsServerMessage.parse({ type: 'changed', seq: 3 })).toEqual({ type: 'changed', seq: 3 });
    expect(WsServerMessage.safeParse({ type: 'data', seq: 3 }).success).toBe(false);
    expect(
      WsTicket.safeParse({ ticket: 'a'.repeat(43), expiresAt: '2026-11-05T12:00:00Z' }).success,
    ).toBe(true);
    expect(WsTicket.safeParse({ ticket: 'a b', expiresAt: '2026-11-05T12:00:00Z' }).success).toBe(
      false,
    );
  });

  it('answers 410 when a client is too far behind', () => {
    expect(createProblem('GONE').status).toBe(410);
  });
});

describe('history contracts', () => {
  it('counts a play from 30 s or half of a short track', () => {
    expect(countsAsPlay(29_999, 240_000)).toBe(false);
    expect(countsAsPlay(30_000, 240_000)).toBe(true);
    expect(countsAsPlay(10_000, 20_000)).toBe(true);
    expect(countsAsPlay(9_999, 20_000)).toBe(false);
  });

  it('fills the context in when a client has none', () => {
    const event = PlayEvent.parse({
      clientEventId: '0190f000-0000-7000-8000-000000000001',
      trackId: '0190f000-0000-7000-8000-000000000002',
      startedAt: '2026-11-05T12:00:00Z',
      playedMs: 1000,
      completed: false,
      skipped: true,
    });
    expect(event.context).toBeNull();
  });
});

describe('settings contracts', () => {
  it('accepts the player settings and refuses values out of range', () => {
    expect(PlaybackSettings.safeParse(playback).success).toBe(true);
    expect(PlaybackSettings.safeParse({ ...playback, eqGains: [1, 2] }).success).toBe(false);
    expect(PlaybackSettings.safeParse({ ...playback, crossfadeMs: 13_000 }).success).toBe(false);
    expect(PlaybackSettings.safeParse({ ...playback, balance: 2 }).success).toBe(false);
  });
});
