import { type DynamicModule, Module } from '@nestjs/common';

import type { AppConfig } from './config/env.js';
import { HealthModule } from './health/health.module.js';
import { InfraModule } from './infra/infra.module.js';

@Module({})
export class AppModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [InfraModule.forRoot(config), HealthModule],
    };
  }
}
