import type { IncomingHttpHeaders } from 'node:http';

/** Codes CDNs use for «unknown», Tor, anonymous proxies, satellite and continents. */
const NOT_A_COUNTRY = new Set(['XX', 'ZZ', 'T1', 'A1', 'A2', 'O1', 'EU', 'AP']);

/**
 * Listener country from the header the CDN or reverse proxy sets (ADR-023), e.g.
 * `cf-ipcountry`. Only the infrastructure decides: there is no client-side region the user
 * could change to get around territorial rights. Unset header name, missing or odd value → null.
 */
export function countryFromHeaders(
  headers: IncomingHttpHeaders,
  headerName: string | null,
): string | null {
  if (headerName === null) return null;
  const raw = headers[headerName];
  if (typeof raw !== 'string') return null;
  const code = raw.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code) || NOT_A_COUNTRY.has(code)) return null;
  return code;
}
