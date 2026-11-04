import { describe, expect, it } from 'vitest';

import { aggregateHealth } from './health.js';

describe('aggregateHealth', () => {
  const critical = ['postgres', 'redis'] as const;

  it('is ok when every check is ok', () => {
    expect(
      aggregateHealth(
        { postgres: { status: 'ok' }, redis: { status: 'ok' }, s3: { status: 'ok' } },
        critical,
      ),
    ).toBe('ok');
  });

  it('is degraded when a non-critical dependency fails', () => {
    expect(
      aggregateHealth(
        { postgres: { status: 'ok' }, redis: { status: 'ok' }, s3: { status: 'down' } },
        critical,
      ),
    ).toBe('degraded');
  });

  it('is down when a critical dependency is down', () => {
    expect(
      aggregateHealth({ postgres: { status: 'down' }, redis: { status: 'ok' } }, critical),
    ).toBe('down');
  });

  it('is down when a critical check is missing', () => {
    expect(aggregateHealth({ postgres: { status: 'ok' } }, critical)).toBe('down');
  });
});
