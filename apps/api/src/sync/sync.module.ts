import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { LibraryModule } from '../library/library.module.js';
import { HistoryService } from './history.service.js';
import { SettingsService } from './settings.service.js';
import { HistoryController, SettingsController, SyncController } from './sync.controller.js';
import { SyncGateway } from './sync.gateway.js';
import { SyncService } from './sync.service.js';

/** Synchronization: change log, live channel, history, settings (I7b, ADR-020). */
@Module({
  imports: [AuthModule, LibraryModule],
  controllers: [SyncController, HistoryController, SettingsController],
  providers: [SyncService, SyncGateway, HistoryService, SettingsService],
  exports: [SyncGateway],
})
export class SyncModule {}
