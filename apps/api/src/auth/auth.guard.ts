import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  Inject,
  Injectable,
} from '@nestjs/common';

import { ApiError } from '../common/api-error.js';
import type { HttpRequest } from '../common/request-context.js';
import { type AuthContext, AuthService } from './auth.service.js';

export type AuthedRequest = HttpRequest & { auth?: AuthContext };

export function bearerToken(header: string | undefined): string | undefined {
  if (header === undefined) return undefined;
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  return match?.[1];
}

const unauthenticated = () =>
  new ApiError('UNAUTHENTICATED', {
    detail: 'Access token is missing, invalid or expired.',
    headers: { 'www-authenticate': 'Bearer' },
  });

/** Requires `Authorization: Bearer <access token>` bound to an active session. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const token = bearerToken(req.headers.authorization);
    if (token === undefined) throw unauthenticated();
    const auth = await this.auth.authenticate(token);
    if (auth === null) throw unauthenticated();
    req.auth = auth;
    return true;
  }
}

export const CurrentAuth = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthContext => {
    const auth = context.switchToHttp().getRequest<AuthedRequest>().auth;
    if (auth === undefined) throw unauthenticated();
    return auth;
  },
);
