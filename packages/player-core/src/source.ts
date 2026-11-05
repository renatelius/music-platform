import type { AudioCodec, StreamSource, TrackLoudnessInfo, TrackStream } from '@mp/contracts';

/**
 * - `auto`: best lossy rendition in the preferred codec (Opus where it plays, else AAC);
 * - `data-saver`: the smallest lossy rendition;
 * - `lossless`: lossless or Hi-Res when the track has it, otherwise like `auto`.
 */
export type QualityPreference = 'auto' | 'data-saver' | 'lossless';

/** Opus sounds better than AAC at the same bitrate; AAC plays everywhere (Safari, iOS). */
export const DEFAULT_CODEC_ORDER: readonly AudioCodec[] = ['opus', 'aac'];

const isLossy = (source: StreamSource) => source.quality === 'lossy';
const kbps = (source: StreamSource) => source.bitrateKbps ?? Number.MAX_SAFE_INTEGER;

/** The rendition to play, or null when the client can play none of them. */
export function chooseSource(
  sources: readonly StreamSource[],
  canPlay: (mimeType: string) => boolean,
  preference: QualityPreference = 'auto',
  codecOrder: readonly AudioCodec[] = DEFAULT_CODEC_ORDER,
): StreamSource | null {
  const playable = sources.filter((source) => canPlay(source.mimeType));
  if (playable.length === 0) return null;

  if (preference === 'lossless') {
    const rank = { hires: 2, lossless: 1, lossy: 0 } as const;
    const best = playable
      .filter((source) => !isLossy(source))
      .sort(
        (a, b) => rank[b.quality] - rank[a.quality] || (b.bitDepth ?? 0) - (a.bitDepth ?? 0),
      )[0];
    if (best !== undefined) return best;
  }

  const lossy = playable.filter(isLossy);
  if (lossy.length === 0) return playable[0] ?? null;

  if (preference === 'data-saver') {
    return [...lossy].sort((a, b) => kbps(a) - kbps(b))[0] ?? null;
  }
  for (const codec of codecOrder) {
    const best = lossy
      .filter((source) => source.codec === codec)
      .sort((a, b) => kbps(b) - kbps(a))[0];
    if (best !== undefined) return best;
  }
  return [...lossy].sort((a, b) => kbps(b) - kbps(a))[0] ?? null;
}

export interface ReplayGainSettings {
  readonly mode: 'track' | 'off';
  /** Added to the ReplayGain value; -6..+6 dB. */
  readonly preampDb: number;
}

/** True peak never goes above this after the gain (headroom for lossy decoding). */
export const TRUE_PEAK_CEILING_DBTP = -1;

/** Gain for a track: ReplayGain 2.0 plus preamp, limited so the true peak stays below -1 dBTP. */
export function replayGainDb(
  loudness: TrackLoudnessInfo | null,
  settings: ReplayGainSettings,
): number {
  if (settings.mode === 'off' || loudness === null) return 0;
  const wanted = loudness.replayGainDb + settings.preampDb;
  return Math.min(wanted, TRUE_PEAK_CEILING_DBTP - loudness.truePeakDbtp);
}

export type NotPlayableReason = 'not_found' | 'unsupported';

/** The track cannot be played at all (gone from the catalog, or no format the client plays). */
export class NotPlayableError extends Error {
  override name = 'NotPlayableError';

  constructor(readonly reason: NotPlayableReason) {
    super(`Track is not playable: ${reason}`);
  }
}

export interface ResolvedSource {
  /** Absolute or same-origin URL to load. */
  readonly url: string;
  readonly source: StreamSource;
  readonly loudness: TrackLoudnessInfo | null;
}

export interface SourceResolver {
  /** Throws NotPlayableError, or another error when the server is unreachable. */
  resolve(trackId: string): Promise<ResolvedSource>;
  /** Forget a cached link (it expired or failed). */
  invalidate(trackId: string): void;
}

export interface StreamResolverOptions {
  fetchStream(trackId: string): Promise<TrackStream>;
  mediaUrl(path: string): string;
  canPlay(mimeType: string): boolean;
  preference(): QualityPreference;
  /** True for "the track does not exist / is not playable" answers (HTTP 404). */
  isNotFound(error: unknown): boolean;
  now?: () => number;
  /** A link is renewed this long before it expires. */
  marginMs?: number;
}

/** Resolver over the catalog API: one /stream request per track while its links are valid. */
export function createStreamResolver(options: StreamResolverOptions): SourceResolver {
  const now = options.now ?? Date.now;
  const margin = options.marginMs ?? 60_000;
  const cache = new Map<string, Promise<TrackStream>>();

  const fetchFresh = (trackId: string): Promise<TrackStream> => {
    const request = options.fetchStream(trackId);
    cache.set(trackId, request);
    void request.catch(() => {
      if (cache.get(trackId) === request) cache.delete(trackId);
    });
    return request;
  };

  const stream = async (trackId: string): Promise<TrackStream> => {
    const cached = cache.get(trackId);
    if (cached !== undefined) {
      const value = await cached.catch(() => null);
      if (value !== null && new Date(value.expiresAt).getTime() - margin > now()) return value;
    }
    return fetchFresh(trackId);
  };

  return {
    async resolve(trackId) {
      let value: TrackStream;
      try {
        value = await stream(trackId);
      } catch (error) {
        if (options.isNotFound(error)) throw new NotPlayableError('not_found');
        throw error;
      }
      const source = chooseSource(
        value.sources,
        (mimeType) => options.canPlay(mimeType),
        options.preference(),
      );
      if (source === null) throw new NotPlayableError('unsupported');
      return { url: options.mediaUrl(source.url), source, loudness: value.loudness };
    },
    invalidate(trackId) {
      cache.delete(trackId);
    },
  };
}
