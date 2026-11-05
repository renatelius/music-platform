import { describe, expect, it } from 'vitest';

import { countryFromHeaders } from './country.js';
import { type RightRecord, resolveRights } from './rights-resolver.js';

const now = new Date('2026-11-05T12:00:00Z');
const right = (patch: Partial<RightRecord> = {}): RightRecord => ({
  territories: null,
  allowStream: true,
  allowOffline: false,
  allowPreview: true,
  validFrom: null,
  validTo: null,
  status: 'active',
  ...patch,
});
const stream = (country: string | null = null) => ({ mode: 'stream' as const, country, now });

describe('resolveRights', () => {
  it('allows a worldwide active right, even when the country is unknown', () => {
    expect(resolveRights([right()], stream())).toMatchObject({ allowed: true });
  });

  it('fails closed without rights', () => {
    expect(resolveRights([], stream('DE'))).toEqual({ allowed: false, reason: 'no_rights' });
  });

  it('applies territories only to a known country', () => {
    const us = right({ territories: ['US', 'CA'] });
    expect(resolveRights([us], stream('US'))).toMatchObject({ allowed: true });
    expect(resolveRights([us], stream('DE'))).toEqual({ allowed: false, reason: 'territory' });
    expect(resolveRights([us], stream(null))).toEqual({
      allowed: false,
      reason: 'region_unknown',
    });
  });

  it('checks the mode', () => {
    expect(resolveRights([right()], { mode: 'offline', country: null, now })).toEqual({
      allowed: false,
      reason: 'mode_not_allowed',
    });
    expect(resolveRights([right({ allowStream: false })], stream())).toMatchObject({
      reason: 'mode_not_allowed',
    });
    expect(resolveRights([right()], { mode: 'preview', country: null, now })).toMatchObject({
      allowed: true,
    });
  });

  it('respects the validity window, end exclusive', () => {
    const later = new Date(now.getTime() + 1000);
    expect(resolveRights([right({ validFrom: later })], stream())).toMatchObject({
      reason: 'not_yet_valid',
    });
    expect(resolveRights([right({ validTo: now })], stream())).toMatchObject({
      reason: 'expired',
    });
    expect(resolveRights([right({ validFrom: now, validTo: later })], stream())).toMatchObject({
      allowed: true,
    });
  });

  it('blocks suspended and revoked licences', () => {
    for (const status of ['suspended', 'revoked'] as const) {
      expect(resolveRights([right({ status })], stream())).toEqual({
        allowed: false,
        reason: 'inactive',
      });
    }
  });

  it('plays when any one right allows it, and explains the closest refusal otherwise', () => {
    const rights = [right({ status: 'revoked' }), right({ territories: ['JP'] })];
    expect(resolveRights(rights, stream('JP'))).toMatchObject({ allowed: true });
    expect(resolveRights(rights, stream('FR'))).toEqual({ allowed: false, reason: 'territory' });
  });
});

describe('countryFromHeaders', () => {
  const headers = (value: string | string[] | undefined) => ({ 'cf-ipcountry': value });

  it('reads the configured header only', () => {
    expect(countryFromHeaders(headers('de'), 'cf-ipcountry')).toBe('DE');
    expect(countryFromHeaders(headers('DE'), null)).toBeNull();
    expect(countryFromHeaders(headers('DE'), 'x-country')).toBeNull();
  });

  it('rejects unknown, anonymous and malformed values', () => {
    for (const value of ['XX', 'T1', 'A1', 'EU', 'DEU', '', ' ', '1A']) {
      expect(countryFromHeaders(headers(value), 'cf-ipcountry'), value).toBeNull();
    }
    expect(countryFromHeaders(headers(['DE', 'US']), 'cf-ipcountry')).toBeNull();
    expect(countryFromHeaders(headers(undefined), 'cf-ipcountry')).toBeNull();
  });
});
