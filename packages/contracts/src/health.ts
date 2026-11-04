import { z } from 'zod';

export const HealthStatus = z.enum(['ok', 'degraded', 'down']);
export type HealthStatus = z.infer<typeof HealthStatus>;

export const DependencyCheck = z.object({
  status: HealthStatus,
  latencyMs: z.number().nonnegative().optional(),
  error: z.string().optional(),
});
export type DependencyCheck = z.infer<typeof DependencyCheck>;

export const HealthResponse = z.object({
  status: HealthStatus,
  version: z.string().min(1),
  uptimeSec: z.number().nonnegative(),
  checks: z.record(z.string(), DependencyCheck),
});
export type HealthResponse = z.infer<typeof HealthResponse>;

/**
 * Overall status from dependency checks.
 * - any critical dependency down or missing -> `down`
 * - anything else not `ok` -> `degraded`
 * - otherwise `ok`
 */
export function aggregateHealth(
  checks: Readonly<Record<string, Pick<DependencyCheck, 'status'>>>,
  critical: readonly string[],
): HealthStatus {
  for (const name of critical) {
    const check = checks[name];
    if (check === undefined || check.status === 'down') return 'down';
  }
  const allOk = Object.values(checks).every((check) => check.status === 'ok');
  return allOk ? 'ok' : 'degraded';
}
