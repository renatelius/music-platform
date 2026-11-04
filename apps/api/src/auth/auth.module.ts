import { Module } from '@nestjs/common';

import { AuditService } from '../audit/audit.service.js';
import type { AppConfig } from '../config/env.js';
import { APP_CONFIG } from '../infra/tokens.js';
import { MailService } from '../mail/mail.service.js';
import { AuthRateLimiter } from './auth-rate-limit.js';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { MeController } from './me.controller.js';
import { AccessTokens } from './tokens.js';

@Module({
  controllers: [AuthController, MeController],
  providers: [
    {
      provide: AccessTokens,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        new AccessTokens({
          secret: config.auth.jwtSecret,
          issuer: config.auth.issuer,
          audience: config.auth.audience,
          ttlSec: config.auth.accessTtlSec,
        }),
    },
    AuditService,
    MailService,
    AuthRateLimiter,
    AuthService,
    AuthGuard,
  ],
  exports: [AuthService, AuthGuard],
})
export class AuthModule {}
