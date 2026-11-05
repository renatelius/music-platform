import { Controller, Get, Inject, Param, Query, Req, UseGuards } from '@nestjs/common';

import {
  type ArtistDetail,
  type CatalogHome,
  Id,
  type ReleaseDetail,
  SearchQuery,
  type SearchResults,
  SuggestQuery,
  type SuggestResults,
  type TrackDto,
  contentTypeFor,
  mimeTypeFor,
  type TrackStream,
} from '@mp/contracts';

import { AuthGuard } from '../auth/auth.guard.js';
import { ApiError } from '../common/api-error.js';
import type { HttpRequest } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import type { AppConfig } from '../config/env.js';
import type { Database } from '../db/client.js';
import { APP_CONFIG, DB } from '../infra/tokens.js';
import { countryFromHeaders } from '../rights/country.js';
import { resolveRights } from '../rights/rights-resolver.js';
import { MediaTokens } from './media-token.js';
import {
  getArtist,
  getHome,
  getRelease,
  getTrack,
  getTrackRights,
  getTrackStreamData,
  search,
  suggest,
  withCountry,
} from './queries.js';

function found<T>(value: T | null, what: string): T {
  if (value === null) throw new ApiError('NOT_FOUND', { detail: `${what} not found.` });
  return value;
}

/**
 * Catalog for signed-in users (ADR-018): only tracks playable for this listener are returned —
 * here and now, in their country (ADR-023).
 */
@Controller('catalog')
@UseGuards(AuthGuard)
export class CatalogController {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(MediaTokens) private readonly tokens: MediaTokens,
  ) {}

  /** Listener country from the CDN header; null when unknown or not configured. */
  private country(req: HttpRequest): string | null {
    return countryFromHeaders(req.headers, this.config.geo.countryHeader);
  }

  @Get('home')
  home(@Req() req: HttpRequest): Promise<CatalogHome> {
    return withCountry(this.db, this.country(req), (db) => getHome(db));
  }

  @Get('releases/:id')
  async release(
    @Param('id', new ZodValidationPipe(Id)) id: string,
    @Req() req: HttpRequest,
  ): Promise<ReleaseDetail> {
    return found(
      await withCountry(this.db, this.country(req), (db) => getRelease(db, id)),
      'Release',
    );
  }

  @Get('artists/:id')
  async artist(
    @Param('id', new ZodValidationPipe(Id)) id: string,
    @Req() req: HttpRequest,
  ): Promise<ArtistDetail> {
    return found(
      await withCountry(this.db, this.country(req), (db) => getArtist(db, id)),
      'Artist',
    );
  }

  @Get('tracks/:id')
  async track(
    @Param('id', new ZodValidationPipe(Id)) id: string,
    @Req() req: HttpRequest,
  ): Promise<TrackDto> {
    return found(await withCountry(this.db, this.country(req), (db) => getTrack(db, id)), 'Track');
  }

  /** Signed links to every rendition plus loudness: what a player needs to play the track. */
  @Get('tracks/:id/stream')
  async stream(
    @Param('id', new ZodValidationPipe(Id)) id: string,
    @Req() req: HttpRequest,
  ): Promise<TrackStream> {
    const country = this.country(req);
    const loaded = await withCountry(this.db, country, async (db) => ({
      data: await getTrackStreamData(db, id),
      rights: await getTrackRights(db, id),
    }));
    // Second, independent check before any link is signed: the Rights Resolver (ADR-023).
    const decision = resolveRights(loaded.rights, { mode: 'stream', country, now: new Date() });
    const data = found(decision.allowed ? loaded.data : null, 'Track');
    const expiresAt = new Date(Date.now() + this.config.stream.urlTtlSec * 1000);
    const sources = data.renditions.map(({ s3Key, ...rendition }) => {
      const token = this.tokens.sign({
        key: s3Key,
        sizeBytes: rendition.sizeBytes,
        contentType: contentTypeFor(rendition.container),
        expiresAt,
      });
      return {
        ...rendition,
        mimeType: mimeTypeFor(rendition.codec, rendition.container),
        url: `/media/${token}`,
      };
    });
    return {
      trackId: id,
      durationMs: data.durationMs,
      expiresAt: expiresAt.toISOString(),
      loudness: data.loudness,
      sources,
    };
  }

  @Get('search')
  search(
    @Query(new ZodValidationPipe(SearchQuery)) query: SearchQuery,
    @Req() req: HttpRequest,
  ): Promise<SearchResults> {
    return withCountry(this.db, this.country(req), (db) => search(db, query.q, query.limit));
  }

  @Get('search/suggest')
  suggest(
    @Query(new ZodValidationPipe(SuggestQuery)) query: SuggestQuery,
    @Req() req: HttpRequest,
  ): Promise<SuggestResults> {
    return withCountry(this.db, this.country(req), (db) => suggest(db, query.q, query.limit));
  }
}
