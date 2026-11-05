import { Controller, Get, Inject, Param, Query, UseGuards } from '@nestjs/common';

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
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import type { AppConfig } from '../config/env.js';
import type { Database } from '../db/client.js';
import { APP_CONFIG, DB } from '../infra/tokens.js';
import { MediaTokens } from './media-token.js';
import {
  getArtist,
  getHome,
  getRelease,
  getTrack,
  getTrackStreamData,
  search,
  suggest,
} from './queries.js';

function found<T>(value: T | null, what: string): T {
  if (value === null) throw new ApiError('NOT_FOUND', { detail: `${what} not found.` });
  return value;
}

/** Catalog for signed-in users (ADR-018): only playable tracks are ever returned. */
@Controller('catalog')
@UseGuards(AuthGuard)
export class CatalogController {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(MediaTokens) private readonly tokens: MediaTokens,
  ) {}

  @Get('home')
  home(): Promise<CatalogHome> {
    return getHome(this.db);
  }

  @Get('releases/:id')
  async release(@Param('id', new ZodValidationPipe(Id)) id: string): Promise<ReleaseDetail> {
    return found(await getRelease(this.db, id), 'Release');
  }

  @Get('artists/:id')
  async artist(@Param('id', new ZodValidationPipe(Id)) id: string): Promise<ArtistDetail> {
    return found(await getArtist(this.db, id), 'Artist');
  }

  @Get('tracks/:id')
  async track(@Param('id', new ZodValidationPipe(Id)) id: string): Promise<TrackDto> {
    return found(await getTrack(this.db, id), 'Track');
  }

  /** Signed links to every rendition plus loudness: what a player needs to play the track. */
  @Get('tracks/:id/stream')
  async stream(@Param('id', new ZodValidationPipe(Id)) id: string): Promise<TrackStream> {
    const data = found(await getTrackStreamData(this.db, id), 'Track');
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
  search(@Query(new ZodValidationPipe(SearchQuery)) query: SearchQuery): Promise<SearchResults> {
    return search(this.db, query.q, query.limit);
  }

  @Get('search/suggest')
  suggest(
    @Query(new ZodValidationPipe(SuggestQuery)) query: SuggestQuery,
  ): Promise<SuggestResults> {
    return suggest(this.db, query.q, query.limit);
  }
}
