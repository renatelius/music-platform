import type { PlayerSnapshot } from '@mp/player-core';
import { describe, expect, it } from 'vitest';

import {
  decodeSnapshot,
  DEFAULT_WEB_SETTINGS,
  encodeSnapshot,
  hotkeyAction,
  type HotkeyInput,
  matchPreset,
  matchProfile,
  MAX_EQ_PROFILES,
  MAX_SAVED_ENTRIES,
  mergeSettings,
  parseSettings,
  removeEqProfile,
  saveEqProfile,
  toPlayerSettings,
} from './player-store';

const track = (id: string) => ({
  id,
  title: `Track ${id}`,
  durationMs: 200_000,
  artists: [{ id: 'a1', name: 'Artist' }],
  release: { id: 'r1', title: 'Release' },
  // Catalog details that must not be saved.
  license: { name: 'CC BY 4.0', url: null, attribution: 'x', sourceUrl: null },
});

function snapshot(count = 2): PlayerSnapshot {
  const entries = Array.from({ length: count }, (_, i) => ({
    uid: `q${String(i + 1)}`,
    track: track(`t${String(i)}`),
  }));
  return {
    version: 1,
    queue: {
      version: 1,
      entries,
      order: entries.map((entry) => entry.uid),
      position: 0,
      shuffle: false,
      repeat: 'off',
    },
    positionMs: 61_000,
    volume: 0.6,
    muted: false,
    settings: { crossfadeMs: 0, gaplessAlbums: true, replayGain: { mode: 'track', preampDb: 0 } },
  };
}

describe('balance and EQ profiles', () => {
  it('parses balance and profiles defensively', () => {
    const parsed = parseSettings(
      JSON.stringify({
        balance: 0.3333,
        eqProfiles: [
          { name: '  Car ', gains: [3, 2] },
          { name: '', gains: [] },
        ],
      }),
    );
    expect(parsed.balance).toBe(0.33);
    // One broken profile drops the list, not the other settings.
    expect(parsed.eqProfiles).toEqual([]);
    const ok = parseSettings(JSON.stringify({ eqProfiles: [{ name: ' Car ', gains: [3] }] }));
    expect(ok.eqProfiles).toEqual([{ name: 'Car', gains: [3, 0, 0, 0, 0, 0, 0, 0, 0, 0] }]);
    expect(parseSettings(JSON.stringify({ balance: 'left' })).balance).toBe(0);
  });

  it('saves, replaces, limits and removes profiles', () => {
    const first = saveEqProfile([], ' Car ', [1]);
    if (!first.ok) throw new Error('not saved');
    expect(first.profiles.map((p) => p.name)).toEqual(['Car']);
    const replaced = saveEqProfile(first.profiles, 'car', [5]);
    if (!replaced.ok) throw new Error('not saved');
    expect(replaced.profiles).toHaveLength(1);
    expect(replaced.profiles[0]?.gains[0]).toBe(5);
    expect(saveEqProfile([], '   ', [])).toEqual({ ok: false, reason: 'empty' });
    expect(saveEqProfile([], 'x'.repeat(41), [])).toEqual({ ok: false, reason: 'tooLong' });
    const full = Array.from({ length: MAX_EQ_PROFILES }, (_, i) => ({
      name: `P${String(i)}`,
      gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    }));
    expect(saveEqProfile(full, 'New', [])).toEqual({ ok: false, reason: 'full' });
    expect(saveEqProfile(full, 'p3', [1]).ok).toBe(true);
    // Removal is by the exact stored name (the last save renamed «Car» to «car»).
    expect(removeEqProfile(replaced.profiles, 'Car')).toHaveLength(1);
    expect(removeEqProfile(replaced.profiles, 'car')).toHaveLength(0);
  });

  it('recognises the active profile', () => {
    const profiles = [{ name: 'Car', gains: [3, 0, 0, 0, 0, 0, 0, 0, 0, 0] }];
    expect(matchProfile(profiles, [3])?.name).toBe('Car');
    expect(matchProfile(profiles, [2])).toBeNull();
  });
});

describe('settings', () => {
  it('falls back to defaults for missing, broken or out-of-range values', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_WEB_SETTINGS);
    expect(parseSettings('{not json')).toEqual(DEFAULT_WEB_SETTINGS);
    expect(parseSettings('42')).toEqual(DEFAULT_WEB_SETTINGS);
    const partial = parseSettings(
      JSON.stringify({ crossfadeMs: 99_999, quality: 'lossless', eqGains: [30] }),
    );
    expect(partial).toMatchObject({ crossfadeMs: 0, quality: 'lossless', replayGain: 'track' });
    expect(partial.eqGains).toEqual([12, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('merges a change and maps to player settings', () => {
    const next = mergeSettings(DEFAULT_WEB_SETTINGS, { crossfadeMs: 6000, replayGain: 'off' });
    expect(toPlayerSettings(next)).toEqual({
      crossfadeMs: 6000,
      gaplessAlbums: true,
      replayGain: { mode: 'off', preampDb: 0 },
    });
  });

  it('recognizes presets', () => {
    expect(matchPreset([0, 0, 0])).toBe('flat');
    expect(matchPreset([6, 5, 4, 2, 0, 0, 0, 0, 0, 0])).toBe('bass');
    expect(matchPreset([1, 2, 3])).toBeNull();
  });
});

describe('saved session', () => {
  it('round-trips without catalog details', () => {
    const raw = encodeSnapshot(snapshot());
    expect(raw).not.toBeNull();
    expect(raw).not.toContain('license');
    const decoded = decodeSnapshot(raw);
    expect(decoded?.positionMs).toBe(61_000);
    expect(decoded?.queue.entries[0]?.track).toEqual({
      id: 't0',
      title: 'Track t0',
      durationMs: 200_000,
      artists: [{ id: 'a1', name: 'Artist' }],
      release: { id: 'r1', title: 'Release' },
    });
  });

  it('does not save an empty or a huge queue', () => {
    expect(encodeSnapshot(snapshot(0))).toBeNull();
    expect(encodeSnapshot(snapshot(MAX_SAVED_ENTRIES + 1))).toBeNull();
  });

  it('rejects broken data', () => {
    expect(decodeSnapshot(null)).toBeNull();
    expect(decodeSnapshot('{')).toBeNull();
    expect(decodeSnapshot(JSON.stringify({ ...snapshot(), version: 2 }))).toBeNull();
    expect(decodeSnapshot(JSON.stringify({ ...snapshot(), volume: 5 }))).toBeNull();
  });
});

describe('hotkeyAction', () => {
  const key = (k: string, patch: Partial<HotkeyInput> = {}): HotkeyInput => ({
    key: k,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    target: 'other',
    ...patch,
  });

  it('maps the player shortcuts', () => {
    expect(hotkeyAction(key(' '))).toBe('toggle');
    expect(hotkeyAction(key('k'))).toBe('toggle');
    expect(hotkeyAction(key('M'))).toBe('mute');
    expect(hotkeyAction(key('ArrowLeft'))).toBe('back');
    expect(hotkeyAction(key('ArrowRight'))).toBe('forward');
    expect(hotkeyAction(key('ArrowLeft', { shiftKey: true }))).toBe('previous');
    expect(hotkeyAction(key('ArrowRight', { shiftKey: true }))).toBe('next');
    expect(hotkeyAction(key('x'))).toBeNull();
  });

  it('leaves typing, sliders, buttons and browser shortcuts alone', () => {
    expect(hotkeyAction(key(' ', { target: 'text' }))).toBeNull();
    expect(hotkeyAction(key('ArrowLeft', { target: 'text' }))).toBeNull();
    expect(hotkeyAction(key(' ', { target: 'button' }))).toBeNull();
    expect(hotkeyAction(key('k', { target: 'button' }))).toBe('toggle');
    expect(hotkeyAction(key('ArrowLeft', { altKey: true }))).toBeNull();
    expect(hotkeyAction(key('k', { ctrlKey: true }))).toBeNull();
  });
});
