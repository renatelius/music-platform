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
} from '@mp/contracts';

import { AuthGuard } from '../auth/auth.guard.js';
import { ApiError } from '../common/api-error.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import type { Database } from '../db/client.js';
import { DB } from '../infra/tokens.js';
import { getArtist, getHome, getRelease, getTrack, search, suggest } from './queries.js';

function found<T>(value: T | null, what: string): T {
  if (value === null) throw new ApiError('NOT_FOUND', { detail: `${what} not found.` });
  return value;
}

/** Catalog for signed-in users (ADR-018): only playable tracks are ever returned. */
@Controller('catalog')
@UseGuards(AuthGuard)
export class CatalogController {
  constructor(@Inject(DB) private readonly db: Database) {}

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
