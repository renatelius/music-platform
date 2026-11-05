import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

export const REQUEST_ID_HEADER = 'x-request-id';

const VALID_REQUEST_ID = /^[A-Za-z0-9._:-]{8,128}$/;
const requestIds = new WeakMap<IncomingMessage, string>();

export type HttpRequest = IncomingMessage & { originalUrl?: string; ip?: string };
export type NextFn = (error?: unknown) => void;

export function isValidRequestId(value: unknown): value is string {
  return typeof value === 'string' && VALID_REQUEST_ID.test(value);
}

export function getRequestId(req: IncomingMessage): string | undefined {
  return requestIds.get(req);
}

/** Accepts a well-formed incoming X-Request-Id (from a proxy) or generates one. */
export function requestIdMiddleware() {
  return (req: IncomingMessage, res: ServerResponse, next: NextFn): void => {
    const incoming = req.headers[REQUEST_ID_HEADER];
    const id = isValidRequestId(incoming) ? incoming : randomUUID();
    requestIds.set(req, id);
    res.setHeader(REQUEST_ID_HEADER, id);
    next();
  };
}

/** Client address; honours `trust proxy` when Express has resolved `req.ip`. */
export function clientIp(req: HttpRequest): string {
  return req.ip ?? req.socket.remoteAddress ?? 'unknown';
}

/** A signed media link carries its token in the path (`/media/<token>`, ADR-019). */
const MEDIA_TOKEN_PATH = /\/media\/[^/]+/;

/**
 * Path without the query string and with media tokens masked, so tokens in URLs never reach
 * logs, rate-limit answers or error bodies (ADR-022).
 */
export function pathOnly(url: string | undefined): string {
  const path = (url ?? '/').split('?')[0] ?? '/';
  return path.replace(MEDIA_TOKEN_PATH, '/media/:token');
}
