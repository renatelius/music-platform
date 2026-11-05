import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';

import {
  type ClearHistoryResult,
  type RecentPlays,
  RecentQuery,
  RecordPlaysRequest,
  type RecordPlaysResult,
  SyncChangesQuery,
  type SyncChangesPage,
  UpdateUserSettingsRequest,
  type UserSettings,
  type UserSettingsMutation,
  type WsTicket,
} from '@mp/contracts';

import { AuthGuard, type AuthedRequest, CurrentAuth } from '../auth/auth.guard.js';
import type { AuthContext } from '../auth/auth.service.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import type { AppConfig } from '../config/env.js';
import { APP_CONFIG } from '../infra/tokens.js';
import { LibraryBase } from '../library/library.controller.js';
import { LibraryService } from '../library/library.service.js';
import { HistoryService } from './history.service.js';
import { SettingsService } from './settings.service.js';
import { SyncService } from './sync.service.js';

/** Catching up and the live channel ticket (I7b). */
@Controller('sync')
@UseGuards(AuthGuard)
export class SyncController {
  constructor(@Inject(SyncService) private readonly sync: SyncService) {}

  @Get('changes')
  changes(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodValidationPipe(SyncChangesQuery)) query: SyncChangesQuery,
  ): Promise<SyncChangesPage> {
    return this.sync.changes(auth.userId, query.since, query.limit);
  }

  @Post('ws-ticket')
  @HttpCode(200)
  ticket(@CurrentAuth() auth: AuthContext): Promise<WsTicket> {
    return this.sync.issueTicket({ userId: auth.userId, familyId: auth.familyId });
  }
}

/** Listening history (I7b). */
@Controller('history')
@UseGuards(AuthGuard)
export class HistoryController extends LibraryBase {
  constructor(
    @Inject(HistoryService) private readonly history: HistoryService,
    @Inject(LibraryService) protected override readonly library: LibraryService,
    @Inject(APP_CONFIG) protected override readonly config: AppConfig,
  ) {
    super();
  }

  @Post('plays')
  @HttpCode(202)
  record(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(RecordPlaysRequest)) body: RecordPlaysRequest,
  ): Promise<RecordPlaysResult> {
    return this.history.record(auth.userId, auth.sessionId, body.events);
  }

  @Get('recent')
  recent(
    @CurrentAuth() auth: AuthContext,
    @Req() req: AuthedRequest,
    @Query(new ZodValidationPipe(RecentQuery)) query: RecentQuery,
  ): Promise<RecentPlays> {
    return this.history.recent(auth.userId, this.country(req), query.limit);
  }

  @Delete()
  clear(@CurrentAuth() auth: AuthContext): Promise<ClearHistoryResult> {
    return this.history.clear(auth.userId);
  }
}

/** Settings that follow the user to every device (I7b). */
@Controller('me/settings')
@UseGuards(AuthGuard)
export class SettingsController extends LibraryBase {
  constructor(
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(LibraryService) protected override readonly library: LibraryService,
    @Inject(APP_CONFIG) protected override readonly config: AppConfig,
  ) {
    super();
  }

  @Get()
  get(@CurrentAuth() auth: AuthContext): Promise<UserSettings> {
    return this.settings.get(auth.userId);
  }

  @Put()
  update(
    @CurrentAuth() auth: AuthContext,
    @Req() req: AuthedRequest,
    @Body(new ZodValidationPipe(UpdateUserSettingsRequest)) body: UpdateUserSettingsRequest,
  ): Promise<UserSettingsMutation> {
    return this.settings.update(this.options(auth, req), body);
  }
}
