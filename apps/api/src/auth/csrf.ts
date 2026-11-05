import type { IncomingMessage } from 'node:http';

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  return typeof value === 'string' ? value : undefined;
}

/** Origins (scheme://host:port) the web app is served from. */
export function allowedOrigins(urls: readonly string[]): ReadonlySet<string> {
  const origins = new Set<string>();
  for (const url of urls) {
    try {
      origins.add(new URL(url).origin);
    } catch {
      // Not a URL: ignored, config validation reports real mistakes.
    }
  }
  return origins;
}

/**
 * CSRF check for requests authenticated by the refresh cookie (ADR-022), on top of
 * `SameSite=Strict`. Browsers send `Origin` (or at least `Sec-Fetch-Site`) with every POST:
 * it must point at the web app. A client that sends neither is not a browser and cannot be
 * made to send a cross-site request with the user's cookie.
 */
export function isAllowedCookieRequest(
  req: IncomingMessage,
  origins: ReadonlySet<string>,
): boolean {
  const origin = header(req, 'origin');
  if (origin !== undefined) return origins.has(origin);
  const site = header(req, 'sec-fetch-site');
  if (site !== undefined) return site === 'same-origin' || site === 'none';
  return true;
}
