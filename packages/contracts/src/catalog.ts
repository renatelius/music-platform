import { z } from 'zod';

import { AudioFormat, QualityTier } from './audio.js';
import { Id } from './common.js';

/** Only http(s) links reach clients (attribution and source links are rendered as anchors). */
export const HttpUrl = z
  .url()
  .max(2048)
  .regex(/^https?:\/\//i, 'Must be an http(s) URL');
export type HttpUrl = z.infer<typeof HttpUrl>;

export const ReleaseType = z.enum(['album', 'single', 'ep', 'compilation', 'live']);
export type ReleaseType = z.infer<typeof ReleaseType>;

export const ArtistRef = z.object({ id: Id, name: z.string() });
export type ArtistRef = z.infer<typeof ArtistRef>;

export const ReleaseRef = z.object({ id: Id, title: z.string() });
export type ReleaseRef = z.infer<typeof ReleaseRef>;

/** License of a track. Shown next to every track (CC BY / BY-SA require attribution). */
export const TrackLicense = z.object({
  /** Canonical name, e.g. "CC BY 4.0". */
  name: z.string().min(1),
  url: HttpUrl.nullable(),
  /** Ready-to-show credit line. */
  attribution: z.string().min(1),
  /** Page of the track at the source. */
  sourceUrl: HttpUrl.nullable(),
});
export type TrackLicense = z.infer<typeof TrackLicense>;

/**
 * Best rendition available for the track: never more than the source has
 * (`classifyQuality`). Render with `describeFormat(quality.format)`.
 */
export const TrackQuality = z.object({ tier: QualityTier, format: AudioFormat });
export type TrackQuality = z.infer<typeof TrackQuality>;

export const TrackDto = z.object({
  id: Id,
  title: z.string(),
  durationMs: z.number().int().nonnegative(),
  discNumber: z.number().int().min(1),
  trackNumber: z.number().int().min(1).nullable(),
  explicit: z.boolean(),
  artists: z.array(ArtistRef),
  release: ReleaseRef,
  quality: TrackQuality,
  license: TrackLicense,
});
export type TrackDto = z.infer<typeof TrackDto>;

export const ReleaseSummary = z.object({
  id: Id,
  title: z.string(),
  type: ReleaseType,
  /** YYYY-MM-DD */
  releaseDate: z.iso.date().nullable(),
  artists: z.array(ArtistRef),
  /** Playable tracks only. */
  trackCount: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative(),
});
export type ReleaseSummary = z.infer<typeof ReleaseSummary>;

export const ReleaseDetail = ReleaseSummary.extend({
  /** Page of the release at the source. */
  url: HttpUrl.nullable(),
  tracks: z.array(TrackDto),
});
export type ReleaseDetail = z.infer<typeof ReleaseDetail>;

export const ArtistSummary = z.object({
  id: Id,
  name: z.string(),
  trackCount: z.number().int().nonnegative(),
  releaseCount: z.number().int().nonnegative(),
});
export type ArtistSummary = z.infer<typeof ArtistSummary>;

export const ARTIST_TRACKS_LIMIT = 50;

export const ArtistDetail = ArtistSummary.extend({
  /** Page of the artist at the source. */
  url: HttpUrl.nullable(),
  releases: z.array(ReleaseSummary),
  /** Newest releases first, at most ARTIST_TRACKS_LIMIT. */
  tracks: z.array(TrackDto),
});
export type ArtistDetail = z.infer<typeof ArtistDetail>;

export const CatalogStats = z.object({
  tracks: z.number().int().nonnegative(),
  releases: z.number().int().nonnegative(),
  artists: z.number().int().nonnegative(),
});
export type CatalogStats = z.infer<typeof CatalogStats>;

/** Home screen: only sections backed by real data (no fake "popular" or "for you"). */
export const CatalogHome = z.object({
  stats: CatalogStats,
  /** Most recently added to the catalog. */
  recentReleases: z.array(ReleaseSummary),
  /** Random pick that changes once a day (same for everyone). */
  dailyTracks: z.array(TrackDto),
  /** Artists with the most tracks. */
  artists: z.array(ArtistSummary),
});
export type CatalogHome = z.infer<typeof CatalogHome>;

export const SEARCH_QUERY_MAX_LENGTH = 100;
export const SEARCH_LIMIT_DEFAULT = 10;
export const SEARCH_LIMIT_MAX = 50;
export const SUGGEST_LIMIT_DEFAULT = 8;
export const SUGGEST_LIMIT_MAX = 10;

/** Whitespace (tabs and newlines too) collapsed and trimmed; other control characters rejected. */
export const SearchText = z
  .string()
  .transform((value) => value.replace(/\s+/g, ' ').trim())
  .pipe(
    z
      .string()
      .min(1)
      .max(SEARCH_QUERY_MAX_LENGTH)
      .regex(/^\P{Cc}*$/u, 'Must not contain control characters'),
  );

export const SearchQuery = z.object({
  q: SearchText,
  limit: z.coerce.number().int().min(1).max(SEARCH_LIMIT_MAX).default(SEARCH_LIMIT_DEFAULT),
});
export type SearchQuery = z.infer<typeof SearchQuery>;

export const SearchResults = z.object({
  query: z.string(),
  tracks: z.array(TrackDto),
  releases: z.array(ReleaseSummary),
  artists: z.array(ArtistSummary),
});
export type SearchResults = z.infer<typeof SearchResults>;

export const SuggestQuery = z.object({
  q: SearchText,
  limit: z.coerce.number().int().min(1).max(SUGGEST_LIMIT_MAX).default(SUGGEST_LIMIT_DEFAULT),
});
export type SuggestQuery = z.infer<typeof SuggestQuery>;

export const SuggestionKind = z.enum(['artist', 'release', 'track']);
export type SuggestionKind = z.infer<typeof SuggestionKind>;

export const Suggestion = z.object({
  kind: SuggestionKind,
  id: Id,
  title: z.string(),
  /** Artists of a release or track; null for an artist. */
  subtitle: z.string().nullable(),
});
export type Suggestion = z.infer<typeof Suggestion>;

export const SuggestResults = z.object({ query: z.string(), items: z.array(Suggestion) });
export type SuggestResults = z.infer<typeof SuggestResults>;
