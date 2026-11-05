import { z } from 'zod';

import { IsoDateTime } from './common.js';

// Account settings that follow the user to every device (I7b, docs/I7_PLAN.md §4).

export const EQ_BAND_COUNT = 10;
export const EQ_LIMIT_DB = 12;
export const CROSSFADE_LIMIT_MS = 12_000;
export const EQ_PROFILES_MAX = 10;
export const EQ_PROFILE_NAME_MAX = 40;

const Gains = z.array(z.number().min(-EQ_LIMIT_DB).max(EQ_LIMIT_DB)).length(EQ_BAND_COUNT);

/** Playback preferences: the same fields as the player settings of the web app. */
export const PlaybackSettings = z.object({
  crossfadeMs: z.number().int().min(0).max(CROSSFADE_LIMIT_MS),
  gaplessAlbums: z.boolean(),
  replayGain: z.enum(['track', 'off']),
  quality: z.enum(['auto', 'data-saver', 'lossless']),
  eqEnabled: z.boolean(),
  eqGains: Gains,
  balance: z.number().min(-1).max(1),
  eqProfiles: z
    .array(z.object({ name: z.string().trim().min(1).max(EQ_PROFILE_NAME_MAX), gains: Gains }))
    .max(EQ_PROFILES_MAX),
});
export type PlaybackSettings = z.infer<typeof PlaybackSettings>;

/** `playback: null` until a client saves it once; `historyEnabled` is on by default. */
export const UserSettings = z.object({
  playback: PlaybackSettings.nullable(),
  historyEnabled: z.boolean(),
  updatedAt: IsoDateTime.nullable(),
});
export type UserSettings = z.infer<typeof UserSettings>;

export const UpdateUserSettingsRequest = z.object({
  playback: PlaybackSettings.optional(),
  historyEnabled: z.boolean().optional(),
});
export type UpdateUserSettingsRequest = z.infer<typeof UpdateUserSettingsRequest>;

export const UserSettingsMutation = UserSettings.extend({ seq: z.number().int().nonnegative() });
export type UserSettingsMutation = z.infer<typeof UserSettingsMutation>;
