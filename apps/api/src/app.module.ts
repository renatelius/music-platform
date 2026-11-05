import { type DynamicModule, Module } from '@nestjs/common';

import { AuthModule } from './auth/auth.module.js';
import { CatalogModule } from './catalog/catalog.module.js';
import type { AppConfig } from './config/env.js';
import { DocsModule } from './docs/docs.module.js';
import { HealthModule } from './health/health.module.js';
import { InfraModule } from './infra/infra.module.js';
import { LibraryModule } from './library/library.module.js';
import { SyncModule } from './sync/sync.module.js';

@Module({})
export class AppModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        InfraModule.forRoot(config),
        HealthModule,
        AuthModule,
        CatalogModule,
        LibraryModule,
        SyncModule,
        ...(config.api.docs ? [DocsModule] : []),
      ],
    };
  }
}
