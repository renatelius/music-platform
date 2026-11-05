// Rights Resolver (ТЗ v3 §3.2, ADR-023): may this track be played here, now, in this mode?
// Pure and platform-free; the catalog SQL (catalog/queries.ts, CURRENT_STREAM_RIGHT) mirrors
// the stream rule, and the integration tests check that both agree.

export type RightsMode = 'stream' | 'offline' | 'preview';
export type RightStatus = 'active' | 'suspended' | 'revoked';

/** One row of `track_rights`, as the resolver needs it. */
export interface RightRecord {
  /** ISO 3166-1 alpha-2 codes where the right applies; null = worldwide. */
  readonly territories: readonly string[] | null;
  readonly allowStream: boolean;
  readonly allowOffline: boolean;
  readonly allowPreview: boolean;
  readonly validFrom: Date | null;
  readonly validTo: Date | null;
  readonly status: RightStatus;
}

export interface RightsContext {
  readonly mode: RightsMode;
  /** Country of the listener as the infrastructure reports it; null when unknown. */
  readonly country: string | null;
  readonly now: Date;
}

export type DenyReason =
  | 'no_rights'
  | 'inactive'
  | 'mode_not_allowed'
  | 'not_yet_valid'
  | 'expired'
  | 'territory'
  | 'region_unknown';

export type RightsDecision =
  | { readonly allowed: true; readonly right: RightRecord }
  | { readonly allowed: false; readonly reason: DenyReason };

/** When several rights fail, report the one that came closest to allowing playback. */
const REASON_PRIORITY: readonly DenyReason[] = [
  'region_unknown',
  'territory',
  'not_yet_valid',
  'expired',
  'mode_not_allowed',
  'inactive',
];

function allowsMode(right: RightRecord, mode: RightsMode): boolean {
  switch (mode) {
    case 'stream':
      return right.allowStream;
    case 'offline':
      return right.allowOffline;
    case 'preview':
      return right.allowPreview;
  }
}

function check(right: RightRecord, ctx: RightsContext): DenyReason | null {
  if (right.status !== 'active') return 'inactive';
  if (!allowsMode(right, ctx.mode)) return 'mode_not_allowed';
  if (right.validFrom !== null && right.validFrom.getTime() > ctx.now.getTime()) {
    return 'not_yet_valid';
  }
  if (right.validTo !== null && right.validTo.getTime() <= ctx.now.getTime()) return 'expired';
  if (right.territories === null) return null;
  // Fail closed: a territorial right never applies when the country is unknown.
  if (ctx.country === null) return 'region_unknown';
  return right.territories.includes(ctx.country) ? null : 'territory';
}

/**
 * Allowed when at least one right allows the mode, is active, is valid at `now` and covers the
 * listener's country. No rights, or not enough information, means no playback (fail closed).
 */
export function resolveRights(rights: readonly RightRecord[], ctx: RightsContext): RightsDecision {
  if (rights.length === 0) return { allowed: false, reason: 'no_rights' };
  const reasons = new Set<DenyReason>();
  for (const right of rights) {
    const reason = check(right, ctx);
    if (reason === null) return { allowed: true, right };
    reasons.add(reason);
  }
  const reason = REASON_PRIORITY.find((r) => reasons.has(r)) ?? 'no_rights';
  return { allowed: false, reason };
}
