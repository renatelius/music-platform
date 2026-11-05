import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { CatalogController } from './catalog.controller.js';

@Module({
  imports: [AuthModule],
  controllers: [CatalogController],
})
export class CatalogModule {}
