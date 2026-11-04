import { Body, Controller, Get, Inject, Patch, UseGuards } from '@nestjs/common';

import { UpdateProfileRequest, type UserDto } from '@mp/contracts';

import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { AuthGuard, CurrentAuth } from './auth.guard.js';
import { type AuthContext, AuthService, toUserDto } from './auth.service.js';

@Controller('me')
@UseGuards(AuthGuard)
export class MeController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Get()
  async me(@CurrentAuth() auth: AuthContext): Promise<UserDto> {
    return toUserDto(await this.auth.getUser(auth.userId));
  }

  @Patch()
  async update(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(UpdateProfileRequest)) body: UpdateProfileRequest,
  ): Promise<UserDto> {
    return toUserDto(await this.auth.updateProfile(auth.userId, body));
  }
}
