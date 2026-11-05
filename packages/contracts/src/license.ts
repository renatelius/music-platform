import { z } from 'zod';

/**
 * Open licenses accepted for the streaming catalog (ADR-012, ADR-017). All of them allow
 * commercial use and derivative works (transcoding into renditions). NC, ND, Sampling+ and
 * other licenses are never imported.
 */
export const OpenLicense = z.enum([
  'CC0 1.0',
  'Public Domain Mark 1.0',
  'CC BY 1.0',
  'CC BY 2.0',
  'CC BY 2.5',
  'CC BY 3.0',
  'CC BY 4.0',
  'CC BY-SA 1.0',
  'CC BY-SA 2.0',
  'CC BY-SA 2.5',
  'CC BY-SA 3.0',
  'CC BY-SA 4.0',
]);
export type OpenLicense = z.infer<typeof OpenLicense>;

/** Official text of each license (shown next to the attribution). */
export const OPEN_LICENSE_URL: Readonly<Record<OpenLicense, string>> = {
  'CC0 1.0': 'https://creativecommons.org/publicdomain/zero/1.0/',
  'Public Domain Mark 1.0': 'https://creativecommons.org/publicdomain/mark/1.0/',
  'CC BY 1.0': 'https://creativecommons.org/licenses/by/1.0/',
  'CC BY 2.0': 'https://creativecommons.org/licenses/by/2.0/',
  'CC BY 2.5': 'https://creativecommons.org/licenses/by/2.5/',
  'CC BY 3.0': 'https://creativecommons.org/licenses/by/3.0/',
  'CC BY 4.0': 'https://creativecommons.org/licenses/by/4.0/',
  'CC BY-SA 1.0': 'https://creativecommons.org/licenses/by-sa/1.0/',
  'CC BY-SA 2.0': 'https://creativecommons.org/licenses/by-sa/2.0/',
  'CC BY-SA 2.5': 'https://creativecommons.org/licenses/by-sa/2.5/',
  'CC BY-SA 3.0': 'https://creativecommons.org/licenses/by-sa/3.0/',
  'CC BY-SA 4.0': 'https://creativecommons.org/licenses/by-sa/4.0/',
};

export function isOpenLicense(value: string): value is OpenLicense {
  return OpenLicense.safeParse(value).success;
}

/** CC0 and the Public Domain Mark: no attribution is legally required (we still credit). */
export function isPublicDomain(license: OpenLicense): boolean {
  return license === 'CC0 1.0' || license === 'Public Domain Mark 1.0';
}

/** Ready-to-show credit line, e.g. «"Song" by Artist, licensed under CC BY 4.0». */
export function formatAttribution(work: {
  readonly title: string;
  readonly artist: string;
  readonly license: OpenLicense;
}): string {
  const credit = `"${work.title}" by ${work.artist}`;
  if (work.license === 'CC0 1.0') return `${credit}, dedicated to the public domain (CC0 1.0)`;
  if (work.license === 'Public Domain Mark 1.0') {
    return `${credit}, marked with Public Domain Mark 1.0`;
  }
  return `${credit}, licensed under ${work.license}`;
}
