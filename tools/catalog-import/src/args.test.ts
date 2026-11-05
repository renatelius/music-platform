import { describe, expect, it } from 'vitest';

import { parseCliArgs } from './args.js';

describe('parseCliArgs', () => {
  it('has defaults for a plain run', () => {
    expect(parseCliArgs([])).toEqual({
      target: 300,
      maxPerRelease: 10,
      concurrency: null,
      maxParts: Number.MAX_SAFE_INTEGER,
      retryFailed: false,
      dryRun: false,
      verifyOnly: false,
      revision: 'main',
      seed: 'remusic',
      help: false,
    });
  });

  it('reads every option', () => {
    expect(
      parseCliArgs([
        '--target',
        '20',
        '--max-per-release',
        '3',
        '--concurrency',
        '4',
        '--max-parts',
        '5',
        '--retry-failed',
        '--dry-run',
        '--verify',
        '--revision',
        'abc',
        '--seed',
        'x',
        '-h',
      ]),
    ).toEqual({
      target: 20,
      maxPerRelease: 3,
      concurrency: 4,
      maxParts: 5,
      retryFailed: true,
      dryRun: true,
      verifyOnly: true,
      revision: 'abc',
      seed: 'x',
      help: true,
    });
  });

  it('rejects bad numbers and unknown options', () => {
    expect(() => parseCliArgs(['--target', '0'])).toThrow(/--target/);
    expect(() => parseCliArgs(['--target', '1.5'])).toThrow(/--target/);
    expect(() => parseCliArgs(['--concurrency', 'two'])).toThrow(/--concurrency/);
    expect(() => parseCliArgs(['--nope'])).toThrow();
    expect(() => parseCliArgs(['positional'])).toThrow();
  });
});
