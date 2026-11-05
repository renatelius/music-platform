import type { ServerResponse } from 'node:http';

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';

import {
  type AuthResponse,
  CLIENT_TYPE_HEADER,
  EmailTokenRequest,
  ForgotPasswordRequest,
  Id,
  LoginRequest,
  REFRESH_COOKIE,
  RefreshRequest,
  RegisterRequest,
  ResetPasswordRequest,
  type SessionList,
  type UserDto,
} from '@mp/contracts';

import { ApiError } from '../common/api-error.js';
import { getRequestId, type HttpRequest } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import type { AppConfig } from '../config/env.js';
import { APP_CONFIG } from '../infra/tokens.js';
import { AuthRateLimiter } from './auth-rate-limit.js';
import {
  type AuthContext,
  AuthService,
  type IssuedAuth,
  type RequestMeta,
  toUserDto,
} from './auth.service.js';
import { AuthGuard, bearerToken, CurrentAuth } from './auth.guard.js';
import { clearRefreshCookie, type CookieOptions, readCookie, setRefreshCookie } from './cookies.js';
import { allowedOrigins, isAllowedCookieRequest } from './csrf.js';

function requestMeta(req: HttpRequest, deviceName?: string): RequestMeta {
  const userAgent = req.headers['user-agent'];
  return {
    ip: req.ip ?? req.socket.remoteAddress ?? null,
    userAgent: typeof userAgent === 'string' ? userAgent.slice(0, 512) : null,
    requestId: getRequestId(req),
    deviceName,
  };
}

const isNative = (req: HttpRequest) => req.headers[CLIENT_TYPE_HEADER] === 'native';
const ipKey = (meta: RequestMeta) => meta.ip ?? 'unknown';

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(AuthRateLimiter) private readonly limits: AuthRateLimiter,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {
    this.cookieOrigins = allowedOrigins([config.webAppUrl, ...config.api.corsOrigins]);
  }

  /** Where the web app runs: the refresh cookie is honoured only from there (CSRF). */
  private readonly cookieOrigins: ReadonlySet<string>;

  private get cookieOptions(): CookieOptions {
    return { secure: this.config.auth.cookieSecure, path: this.config.auth.cookiePath };
  }

  @Post('register')
  @HttpCode(201)
  async register(
    @Body(new ZodValidationPipe(RegisterRequest)) body: RegisterRequest,
    @Req() req: HttpRequest,
    @Res({ passthrough: true }) res: ServerResponse,
  ): Promise<AuthResponse> {
    const meta = requestMeta(req, body.deviceName);
    await this.limits.consume('register', ipKey(meta));
    return this.deliver(await this.auth.register(body, meta), req, res);
  }

  @Post('login')
  @HttpCode(200)
  async login(
    @Body(new ZodValidationPipe(LoginRequest)) body: LoginRequest,
    @Req() req: HttpRequest,
    @Res({ passthrough: true }) res: ServerResponse,
  ): Promise<AuthResponse> {
    const meta = requestMeta(req, body.deviceName);
    await this.limits.consume('loginIp', ipKey(meta));
    await this.limits.consume('loginEmail', body.email);
    return this.deliver(await this.auth.login(body, meta), req, res);
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Body(new ZodValidationPipe(RefreshRequest)) body: RefreshRequest,
    @Req() req: HttpRequest,
    @Res({ passthrough: true }) res: ServerResponse,
  ): Promise<AuthResponse> {
    const meta = requestMeta(req);
    await this.limits.consume('refreshIp', ipKey(meta));
    const token = body.refreshToken ?? this.cookieToken(req);
    if (token === undefined) {
      throw new ApiError('UNAUTHENTICATED', { detail: 'Refresh token is missing.' });
    }
    try {
      return this.deliver(await this.auth.refresh(token, meta), req, res);
    } catch (error) {
      // 409 means another tab already rotated the token: the browser holds the newest cookie.
      const rejected = error instanceof ApiError && error.code === 'UNAUTHENTICATED';
      if (rejected && !isNative(req)) clearRefreshCookie(res, this.cookieOptions);
      throw error;
    }
  }

  @Post('logout')
  @HttpCode(204)
  async logout(
    @Body(new ZodValidationPipe(RefreshRequest)) body: RefreshRequest,
    @Req() req: HttpRequest,
    @Res({ passthrough: true }) res: ServerResponse,
  ): Promise<void> {
    await this.auth.logout(
      body.refreshToken ?? this.cookieToken(req),
      bearerToken(req.headers.authorization),
      requestMeta(req),
    );
    clearRefreshCookie(res, this.cookieOptions);
  }

  @Post('logout-all')
  @HttpCode(204)
  @UseGuards(AuthGuard)
  async logoutAll(
    @CurrentAuth() auth: AuthContext,
    @Req() req: HttpRequest,
    @Res({ passthrough: true }) res: ServerResponse,
  ): Promise<void> {
    await this.auth.logoutAll(auth, requestMeta(req));
    clearRefreshCookie(res, this.cookieOptions);
  }

  @Get('sessions')
  @UseGuards(AuthGuard)
  async sessions(@CurrentAuth() auth: AuthContext): Promise<SessionList> {
    return { items: await this.auth.listSessions(auth) };
  }

  @Delete('sessions/:id')
  @HttpCode(204)
  @UseGuards(AuthGuard)
  async revokeSession(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ZodValidationPipe(Id)) id: string,
    @Req() req: HttpRequest,
  ): Promise<void> {
    await this.auth.revokeSession(auth, id, requestMeta(req));
  }

  @Post('email/verify')
  @HttpCode(200)
  async verifyEmail(
    @Body(new ZodValidationPipe(EmailTokenRequest)) body: EmailTokenRequest,
    @Req() req: HttpRequest,
  ): Promise<UserDto> {
    const meta = requestMeta(req);
    await this.limits.consume('tokenIp', ipKey(meta));
    return toUserDto(await this.auth.verifyEmail(body.token, meta));
  }

  @Post('email/resend')
  @HttpCode(202)
  @UseGuards(AuthGuard)
  async resendVerification(@CurrentAuth() auth: AuthContext): Promise<void> {
    await this.limits.consume('resendVerification', auth.userId);
    await this.auth.resendVerification(auth);
  }

  @Post('password/forgot')
  @HttpCode(202)
  async forgotPassword(
    @Body(new ZodValidationPipe(ForgotPasswordRequest)) body: ForgotPasswordRequest,
    @Req() req: HttpRequest,
  ): Promise<void> {
    const meta = requestMeta(req);
    await this.limits.consume('forgotIp', ipKey(meta));
    await this.limits.consume('forgotEmail', body.email);
    await this.auth.forgotPassword(body, meta);
  }

  @Post('password/reset')
  @HttpCode(204)
  async resetPassword(
    @Body(new ZodValidationPipe(ResetPasswordRequest)) body: ResetPasswordRequest,
    @Req() req: HttpRequest,
    @Res({ passthrough: true }) res: ServerResponse,
  ): Promise<void> {
    const meta = requestMeta(req);
    await this.limits.consume('tokenIp', ipKey(meta));
    await this.auth.resetPassword(body, meta);
    clearRefreshCookie(res, this.cookieOptions);
  }

  /** The refresh cookie, refused for cross-site browser requests (CSRF, ADR-022). */
  private cookieToken(req: HttpRequest): string | undefined {
    const token = readCookie(req, REFRESH_COOKIE);
    if (token !== undefined && !isAllowedCookieRequest(req, this.cookieOrigins)) {
      throw new ApiError('FORBIDDEN', { detail: 'Cross-site request refused.' });
    }
    return token;
  }

  /** Browsers get the refresh token as an HttpOnly cookie, native apps in the body. */
  private deliver(issued: IssuedAuth, req: HttpRequest, res: ServerResponse): AuthResponse {
    const native = isNative(req);
    if (!native) {
      setRefreshCookie(res, issued.refreshToken, issued.refreshTokenExpiresAt, this.cookieOptions);
    }
    return {
      accessToken: issued.accessToken,
      accessTokenExpiresAt: issued.accessTokenExpiresAt.toISOString(),
      ...(native ? { refreshToken: issued.refreshToken } : {}),
      refreshTokenExpiresAt: issued.refreshTokenExpiresAt.toISOString(),
      user: toUserDto(issued.user),
    };
  }
}
