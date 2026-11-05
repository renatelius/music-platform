import { describe, expect, it } from 'vitest';

import {
  formatAttribution,
  isOpenLicense,
  isPublicDomain,
  OPEN_LICENSE_URL,
  OpenLicense,
} from './license.js';

describe('open licenses', () => {
  it('accepts only licenses that allow commercial use and derivatives', () => {
    expect(isOpenLicense('CC BY 4.0')).toBe(true);
    expect(isOpenLicense('CC BY-SA 3.0')).toBe(true);
    expect(isOpenLicense('CC0 1.0')).toBe(true);
    expect(isOpenLicense('Public Domain Mark 1.0')).toBe(true);
    for (const closed of [
      'CC BY-NC 4.0',
      'CC BY-ND 4.0',
      'CC BY-NC-SA 3.0',
      'CC BY-NC-ND 3.0',
      'CC Sampling+ 1.0',
      'Free Art License',
      '',
    ]) {
      expect(isOpenLicense(closed)).toBe(false);
    }
  });

  it('has an https link to the text of every license', () => {
    for (const license of OpenLicense.options) {
      expect(OPEN_LICENSE_URL[license]).toMatch(/^https:\/\/creativecommons\.org\/.+\/$/);
    }
    expect(OPEN_LICENSE_URL['CC BY-SA 4.0']).toBe(
      'https://creativecommons.org/licenses/by-sa/4.0/',
    );
  });

  it('formats the credit line for each kind of license', () => {
    expect(formatAttribution({ title: 'Song', artist: 'Artist', license: 'CC BY 4.0' })).toBe(
      '"Song" by Artist, licensed under CC BY 4.0',
    );
    expect(formatAttribution({ title: 'Song', artist: 'Artist', license: 'CC0 1.0' })).toBe(
      '"Song" by Artist, dedicated to the public domain (CC0 1.0)',
    );
    expect(
      formatAttribution({ title: 'Song', artist: 'Artist', license: 'Public Domain Mark 1.0' }),
    ).toBe('"Song" by Artist, marked with Public Domain Mark 1.0');
  });

  it('knows which licenses are public domain', () => {
    expect(isPublicDomain('CC0 1.0')).toBe(true);
    expect(isPublicDomain('Public Domain Mark 1.0')).toBe(true);
    expect(isPublicDomain('CC BY 3.0')).toBe(false);
  });
});
