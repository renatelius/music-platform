import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';

import {
  AddPlaylistItemsRequest,
  type AddPlaylistItemsResult,
  CreatePlaylistRequest,
  type FollowedArtistsPage,
  IDEMPOTENCY_KEY_HEADER,
  IdempotencyKey,
  Id,
  type LibraryChange,
  type LibraryContains,
  LibraryContainsRequest,
  type LikedTracksPage,
  MovePlaylistItemRequest,
  PageQuery,
  type PlaylistItemsPage,
  PlaylistItemsQuery,
  type PlaylistList,
  type PlaylistMutation,
  type PlaylistSummary,
  type SavedReleasesPage,
  UpdatePlaylistRequest,
} from '@mp/contracts';

import { AuthGuard, type AuthedRequest, CurrentAuth } from '../auth/auth.guard.js';
import type { AuthContext } from '../auth/auth.service.js';
import { ApiError } from '../common/api-error.js';
import { pathOnly } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import type { AppConfig } from '../config/env.js';
import { APP_CONFIG } from '../infra/tokens.js';
import { countryFromHeaders } from '../rights/country.js';
import { LibraryService, type MutationOptions, type SavedKindName } from './library.service.js';

const IdParam = new ZodValidationPipe(Id);

/** Shared by both controllers: who, where, and the Idempotency-Key of a mutation. */
export abstract class LibraryBase {
  protected abstract readonly library: LibraryService;
  protected abstract readonly config: AppConfig;

  protected country(req: AuthedRequest): string | null {
    return countryFromHeaders(req.headers, this.config.geo.countryHeader);
  }

  protected options(auth: AuthContext, req: AuthedRequest): MutationOptions {
    const header = req.headers[IDEMPOTENCY_KEY_HEADER];
    let key: string | null = null;
    if (header !== undefined) {
      const parsed = IdempotencyKey.safeParse(Array.isArray(header) ? header[0] : header);
      if (!parsed.success) {
        throw new ApiError('VALIDATION_FAILED', {
          errors: [{ path: 'Idempotency-Key', message: 'Must be a UUID' }],
        });
      }
      key = parsed.data.toLowerCase();
    }
    return {
      userId: auth.userId,
      country: this.country(req),
      key,
      route: `${req.method ?? ''} ${pathOnly(req.originalUrl ?? req.url)}`,
    };
  }
}

/** Liked tracks, saved releases, followed artists (I7a). */
@Controller('library')
@UseGuards(AuthGuard)
export class LibraryController extends LibraryBase {
  constructor(
    @Inject(LibraryService) protected override readonly library: LibraryService,
    @Inject(APP_CONFIG) protected override readonly config: AppConfig,
  ) {
    super();
  }

  @Get('tracks')
  tracks(
    @CurrentAuth() auth: AuthContext,
    @Req() req: AuthedRequest,
    @Query(new ZodValidationPipe(PageQuery)) query: PageQuery,
  ): Promise<LikedTracksPage> {
    return this.library.likedTracks(auth.userId, this.country(req), query.limit, query.cursor);
  }

  @Get('releases')
  releases(
    @CurrentAuth() auth: AuthContext,
    @Req() req: AuthedRequest,
    @Query(new ZodValidationPipe(PageQuery)) query: PageQuery,
  ): Promise<SavedReleasesPage> {
    return this.library.savedReleases(auth.userId, this.country(req), query.limit, query.cursor);
  }

  @Get('artists')
  artists(
    @CurrentAuth() auth: AuthContext,
    @Req() req: AuthedRequest,
    @Query(new ZodValidationPipe(PageQuery)) query: PageQuery,
  ): Promise<FollowedArtistsPage> {
    return this.library.followedArtists(auth.userId, this.country(req), query.limit, query.cursor);
  }

  private add(kind: SavedKindName, auth: AuthContext, req: AuthedRequest, id: string) {
    return this.library.add(kind, this.options(auth, req), id);
  }

  private remove(kind: SavedKindName, auth: AuthContext, req: AuthedRequest, id: string) {
    return this.library.remove(kind, this.options(auth, req), id);
  }

  @Put('tracks/:id')
  likeTrack(
    @CurrentAuth() auth: AuthContext,
    @Req() req: AuthedRequest,
    @Param('id', IdParam) id: string,
  ): Promise<LibraryChange> {
    return this.add('track', auth, req, id);
  }

  @Delete('tracks/:id')
  unlikeTrack(
    @CurrentAuth() auth: AuthContext,
    @Req() req: AuthedRequest,
    @Param('id', IdParam) id: string,
  ): Promise<LibraryChange> {
    return this.remove('track', auth, req, id);
  }

  @Put('releases/:id')
  saveRelease(
    @CurrentAuth() auth: AuthContext,
    @Req() req: AuthedRequest,
    @Param('id', IdParam) id: string,
  ): Promise<LibraryChange> {
    return this.add('release', auth, req, id);
  }

  @Delete('releases/:id')
  unsaveRelease(
    @CurrentAuth() auth: AuthContext,
    @Req() req: AuthedRequest,
    @Param('id', IdParam) id: string,
  ): Promise<LibraryChange> {
    return this.remove('release', auth, req, id);
  }

  @Put('artists/:id')
  followArtist(
    @CurrentAuth() auth: AuthContext,
    @Req() req: AuthedRequest,
    @Param('id', IdParam) id: string,
  ): Promise<LibraryChange> {
    return this.add('artist', auth, req, id);
  }

  @Delete('artists/:id')
  unfollowArtist(
    @CurrentAuth() auth: AuthContext,
    @Req() req: AuthedRequest,
    @Param('id', IdParam) id: string,
  ): Promise<LibraryChange> {
    return this.remove('artist', auth, req, id);
  }

  /** Hearts, "Saved" and "Following" for one screen in one request. */
  @Post('contains')
  @HttpCode(200)
  contains(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(LibraryContainsRequest)) body: LibraryContainsRequest,
  ): Promise<LibraryContains> {
    return this.library.contains(auth.userId, body);
  }
}

/** The user's own playlists (I7a). Someone else's playlist is 404, never 403. */
@Controller('playlists')
@UseGuards(AuthGuard)
export class PlaylistsController extends LibraryBase {
  constructor(
    @Inject(LibraryService) protected override readonly library: LibraryService,
    @Inject(APP_CONFIG) protected override readonly config: AppConfig,
  ) {
    super();
  }

  @Get()
  list(@CurrentAuth() auth: AuthContext): Promise<PlaylistList> {
    return this.library.playlists(auth.userId);
  }

  @Post()
  create(
    @CurrentAuth() auth: AuthContext,
    @Req() req: AuthedRequest,
    @Body(new ZodValidationPipe(CreatePlaylistRequest)) body: CreatePlaylistRequest,
  ): Promise<PlaylistMutation> {
    return this.library.createPlaylist(this.options(auth, req), body);
  }

  @Get(':id')
  get(
    @CurrentAuth() auth: AuthContext,
    @Param('id', IdParam) id: string,
  ): Promise<PlaylistSummary> {
    return this.library.playlist(auth.userId, id);
  }

  @Patch(':id')
  update(
    @CurrentAuth() auth: AuthContext,
    @Req() req: AuthedRequest,
    @Param('id', IdParam) id: string,
    @Body(new ZodValidationPipe(UpdatePlaylistRequest)) body: UpdatePlaylistRequest,
  ): Promise<PlaylistMutation> {
    return this.library.updatePlaylist(this.options(auth, req), id, body);
  }

  @Delete(':id')
  delete(
    @CurrentAuth() auth: AuthContext,
    @Req() req: AuthedRequest,
    @Param('id', IdParam) id: string,
  ): Promise<LibraryChange> {
    return this.library.deletePlaylist(this.options(auth, req), id);
  }

  @Get(':id/items')
  items(
    @CurrentAuth() auth: AuthContext,
    @Req() req: AuthedRequest,
    @Param('id', IdParam) id: string,
    @Query(new ZodValidationPipe(PlaylistItemsQuery)) query: PlaylistItemsQuery,
  ): Promise<PlaylistItemsPage> {
    return this.library.items(auth.userId, this.country(req), id, query.limit, query.cursor);
  }

  @Post(':id/items')
  addItems(
    @CurrentAuth() auth: AuthContext,
    @Req() req: AuthedRequest,
    @Param('id', IdParam) id: string,
    @Body(new ZodValidationPipe(AddPlaylistItemsRequest)) body: AddPlaylistItemsRequest,
  ): Promise<AddPlaylistItemsResult> {
    return this.library.addItems(this.options(auth, req), id, body);
  }

  @Patch(':id/items/:itemId')
  moveItem(
    @CurrentAuth() auth: AuthContext,
    @Req() req: AuthedRequest,
    @Param('id', IdParam) id: string,
    @Param('itemId', IdParam) itemId: string,
    @Body(new ZodValidationPipe(MovePlaylistItemRequest)) body: MovePlaylistItemRequest,
  ): Promise<LibraryChange> {
    return this.library.moveItem(this.options(auth, req), id, itemId, body.after);
  }

  @Delete(':id/items/:itemId')
  removeItem(
    @CurrentAuth() auth: AuthContext,
    @Req() req: AuthedRequest,
    @Param('id', IdParam) id: string,
    @Param('itemId', IdParam) itemId: string,
  ): Promise<LibraryChange> {
    return this.library.removeItem(this.options(auth, req), id, itemId);
  }
}
