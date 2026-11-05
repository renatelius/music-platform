// Player settings and the saved session in localStorage: pure parsing, safe against old,
// broken or hand-edited values (anything unexpected falls back to defaults).
import { EQ_PRESETS, type EqPresetName, normalizeBalance, normalizeEq } from '@mp/audio-web';
import {
  DEFAULT_PLAYER_SETTINGS,
  MAX_CROSSFADE_MS,
  type PlayerSettings,
  type PlayerSnapshot,
  type QualityPreference,
} from '@mp/player-core';
import { PlaybackSettings } from '@mp/contracts';
import { z } from 'zod';

/** Device-level playback preferences (account page, «Playback»). */
export interface WebPlayerSettings {
  readonly crossfadeMs: number;
  readonly gaplessAlbums: boolean;
  readonly replayGain: 'track' | 'off';
  readonly quality: QualityPreference;
  readonly eqEnabled: boolean;
  /** Ten gains in dB. */
  readonly eqGains: readonly number[];
  /** Left/right balance, −1..1. */
  readonly balance: number;
  /** The user's own equalizer settings, saved by name (ТЗ v3 §6.2). */
  readonly eqProfiles: readonly EqProfile[];
}

export interface EqProfile {
  readonly name: string;
  readonly gains: readonly number[];
}

export const MAX_EQ_PROFILES = 10;
export const MAX_EQ_PROFILE_NAME = 40;

export const DEFAULT_WEB_SETTINGS: WebPlayerSettings = {
  crossfadeMs: 0,
  gaplessAlbums: true,
  replayGain: 'track',
  quality: 'auto',
  eqEnabled: false,
  eqGains: normalizeEq([]),
  balance: 0,
  eqProfiles: [],
};

export const SETTINGS_KEY = 'remusic.player.settings.v1';
/** The queue is personal: one saved session per account on this device. */
export const sessionKey = (userId: string): string => `remusic.player.session.v1:${userId}`;
/** Larger queues are not saved (localStorage is small and synchronous). */
export const MAX_SAVED_ENTRIES = 500;

const SettingsSchema = z.object({
  crossfadeMs: z
    .number()
    .int()
    .min(0)
    .max(MAX_CROSSFADE_MS)
    .catch(DEFAULT_WEB_SETTINGS.crossfadeMs),
  gaplessAlbums: z.boolean().catch(DEFAULT_WEB_SETTINGS.gaplessAlbums),
  replayGain: z.enum(['track', 'off']).catch(DEFAULT_WEB_SETTINGS.replayGain),
  quality: z.enum(['auto', 'data-saver', 'lossless']).catch(DEFAULT_WEB_SETTINGS.quality),
  eqEnabled: z.boolean().catch(DEFAULT_WEB_SETTINGS.eqEnabled),
  eqGains: z
    .array(z.number())
    .catch([])
    .transform((gains) => normalizeEq(gains)),
  balance: z.number().catch(0).transform(normalizeBalance),
  eqProfiles: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(MAX_EQ_PROFILE_NAME),
        gains: z.array(z.number()).transform((gains) => normalizeEq(gains)),
      }),
    )
    .max(MAX_EQ_PROFILES)
    .catch([]),
});

function parseJson(raw: string | null): unknown {
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

export function parseSettings(raw: string | null): WebPlayerSettings {
  const parsed = SettingsSchema.safeParse(parseJson(raw));
  return parsed.success ? parsed.data : DEFAULT_WEB_SETTINGS;
}

export function mergeSettings(
  current: WebPlayerSettings,
  patch: Partial<WebPlayerSettings>,
): WebPlayerSettings {
  return SettingsSchema.parse({ ...current, ...patch });
}

export function toPlayerSettings(settings: WebPlayerSettings): PlayerSettings {
  return {
    crossfadeMs: settings.crossfadeMs,
    gaplessAlbums: settings.gaplessAlbums,
    replayGain: {
      mode: settings.replayGain,
      preampDb: DEFAULT_PLAYER_SETTINGS.replayGain.preampDb,
    },
  };
}

export const EQ_PRESET_NAMES = Object.keys(EQ_PRESETS) as EqPresetName[];

export type SaveProfileResult =
  | { readonly ok: true; readonly profiles: readonly EqProfile[] }
  | { readonly ok: false; readonly reason: 'empty' | 'tooLong' | 'full' };

/** Adds a profile, or replaces the one with the same name (case-insensitive). */
export function saveEqProfile(
  profiles: readonly EqProfile[],
  rawName: string,
  gains: readonly number[],
): SaveProfileResult {
  const name = rawName.trim();
  if (name === '') return { ok: false, reason: 'empty' };
  if (name.length > MAX_EQ_PROFILE_NAME) return { ok: false, reason: 'tooLong' };
  const key = name.toLocaleLowerCase();
  const rest = profiles.filter((profile) => profile.name.toLocaleLowerCase() !== key);
  if (rest.length === profiles.length && profiles.length >= MAX_EQ_PROFILES) {
    return { ok: false, reason: 'full' };
  }
  return { ok: true, profiles: [...rest, { name, gains: normalizeEq(gains) }] };
}

export function removeEqProfile(profiles: readonly EqProfile[], name: string): EqProfile[] {
  return profiles.filter((profile) => profile.name !== name);
}

/** The saved profile these gains match exactly, or null. */
export function matchProfile(
  profiles: readonly EqProfile[],
  gains: readonly number[],
): EqProfile | null {
  const normalized = normalizeEq(gains);
  return (
    profiles.find((profile) =>
      profile.gains.every((gain, i) => Math.abs(gain - (normalized[i] ?? 0)) < 0.01),
    ) ?? null
  );
}

/** The preset these gains match exactly, or null («custom»). */
export function matchPreset(gains: readonly number[]): EqPresetName | null {
  const normalized = normalizeEq(gains);
  return (
    EQ_PRESET_NAMES.find((name) =>
      EQ_PRESETS[name].every((gain, i) => Math.abs(gain - (normalized[i] ?? 0)) < 0.01),
    ) ?? null
  );
}

// ---------------------------------------------------------------- saved session

const Id = z.string().min(1).max(64);
const Name = z.string().max(500);
const SavedTrack = z.object({
  id: Id,
  title: Name,
  durationMs: z.number().int().positive(),
  artists: z.array(z.object({ id: Id, name: Name })).max(50),
  release: z.object({ id: Id, title: Name }),
});
const Uid = z.string().min(1).max(32);
const SnapshotSchema = z.object({
  version: z.literal(1),
  queue: z.object({
    version: z.literal(1),
    entries: z.array(z.object({ uid: Uid, track: SavedTrack })).max(MAX_SAVED_ENTRIES),
    order: z.array(Uid).max(MAX_SAVED_ENTRIES),
    position: z.number().int(),
    shuffle: z.boolean(),
    repeat: z.enum(['off', 'all', 'one']),
  }),
  positionMs: z.number().min(0),
  volume: z.number().min(0).max(1),
  muted: z.boolean(),
  settings: z.object({
    crossfadeMs: z.number(),
    gaplessAlbums: z.boolean(),
    replayGain: z.object({ mode: z.enum(['track', 'off']), preampDb: z.number() }),
  }),
});

/** JSON to store, or null when there is nothing worth keeping (empty or huge queue). */
export function encodeSnapshot(snapshot: PlayerSnapshot): string | null {
  const { entries } = snapshot.queue;
  if (entries.length === 0 || entries.length > MAX_SAVED_ENTRIES) return null;
  return JSON.stringify({
    ...snapshot,
    queue: {
      ...snapshot.queue,
      // Only what the player needs: catalog details (license, quality) are fetched again.
      entries: entries.map(({ uid, track }) => ({
        uid,
        track: {
          id: track.id,
          title: track.title,
          durationMs: track.durationMs,
          artists: track.artists.map((artist) => ({ id: artist.id, name: artist.name })),
          release: { id: track.release.id, title: track.release.title },
        },
      })),
    },
  });
}

export function decodeSnapshot(raw: string | null): PlayerSnapshot | null {
  const parsed = SnapshotSchema.safeParse(parseJson(raw));
  return parsed.success ? parsed.data : null;
}

// ---------------------------------------------------------------- keyboard

export type HotkeyAction = 'toggle' | 'back' | 'forward' | 'previous' | 'next' | 'mute' | 'like';

/** `text`: typing or a slider has focus; `button`: Space would click it. */
export type HotkeyTarget = 'text' | 'button' | 'other';

export interface HotkeyInput {
  readonly key: string;
  readonly shiftKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly target: HotkeyTarget;
}

/** Global player shortcuts; never steals keys from text fields, sliders or buttons. */
export function hotkeyAction(input: HotkeyInput): HotkeyAction | null {
  if (input.ctrlKey || input.metaKey || input.altKey || input.target === 'text') return null;
  switch (input.key) {
    case ' ':
      return input.target === 'button' ? null : 'toggle';
    case 'k':
    case 'K':
      return 'toggle';
    case 'm':
    case 'M':
      return 'mute';
    // L likes the playing track; Д is the same key on the Russian layout.
    case 'l':
    case 'L':
    case 'д':
    case 'Д':
      return 'like';
    case 'ArrowLeft':
      return input.shiftKey ? 'previous' : 'back';
    case 'ArrowRight':
      return input.shiftKey ? 'next' : 'forward';
    default:
      return null;
  }
}

// ---------------------------------------------------------------- account settings (I7b)

/** The playback part of the account settings; null if something is out of the shared range. */
export function toPlaybackSettings(settings: WebPlayerSettings): PlaybackSettings | null {
  const parsed = PlaybackSettings.safeParse({
    crossfadeMs: settings.crossfadeMs,
    gaplessAlbums: settings.gaplessAlbums,
    replayGain: settings.replayGain,
    quality: settings.quality,
    eqEnabled: settings.eqEnabled,
    eqGains: [...settings.eqGains],
    balance: settings.balance,
    eqProfiles: settings.eqProfiles.map((profile) => ({
      name: profile.name,
      gains: [...profile.gains],
    })),
  });
  return parsed.success ? parsed.data : null;
}

/** Account settings applied to this device (values are checked again here). */
export function fromPlaybackSettings(
  current: WebPlayerSettings,
  playback: PlaybackSettings,
): WebPlayerSettings {
  return mergeSettings(current, playback);
}

export function sameSettings(a: WebPlayerSettings, b: WebPlayerSettings): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
