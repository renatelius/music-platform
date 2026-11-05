import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import type { AppConfig } from '../config/env.js';
import { APP_CONFIG } from '../infra/tokens.js';
import { CatalogController } from './catalog.controller.js';
import { MediaController } from './media.controller.js';
import { MediaTokens } from './media-token.js';

@Module({
  imports: [AuthModule],
  controllers: [CatalogController, MediaController],
  providers: [
    {
      provide: MediaTokens,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => new MediaTokens(config.auth.jwtSecret),
    },
  ],
})
export class CatalogModule {}
