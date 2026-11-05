import { ApiRequestError, NetworkError } from '@mp/api-client';
import { createProblem } from '@mp/contracts';
import { describe, expect, it } from 'vitest';

import { classifySyncError } from './sync-transport';

const failure = (status: number) =>
  new ApiRequestError(status, status === 410 ? createProblem('GONE') : null);

describe('classifySyncError', () => {
  it('sends again when the network or the server is the problem', () => {
    expect(classifySyncError(new NetworkError(new Error('down')))).toBe('retry');
    for (const status of [401, 408, 429, 500, 502, 503]) {
      expect(classifySyncError(failure(status)), String(status)).toBe('retry');
    }
  });

  it('gives up on a refusal and reloads on 410', () => {
    for (const status of [400, 403, 404, 409, 422]) {
      expect(classifySyncError(failure(status)), String(status)).toBe('reject');
    }
    expect(classifySyncError(failure(410))).toBe('gone');
    expect(classifySyncError(new Error('bug'))).toBe('reject');
  });
});
