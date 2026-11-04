import { Controller, Get, Inject, UseGuards } from '@nestjs/common';

import type { UserDto } from '@mp/contracts';

import { type AuthContext, AuthService, toUserDto } from './auth.service.js';
import { AuthGuard, CurrentAuth } from './auth.guard.js';

@Controller('me')
@UseGuards(AuthGuard)
export class MeController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Get()
  async me(@CurrentAuth() auth: AuthContext): Promise<UserDto> {
    return toUserDto(await this.auth.getUser(auth.userId));
  }
}
