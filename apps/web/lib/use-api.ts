'use client';

import { ApiRequestError } from '@mp/api-client';
import { useCallback, useEffect, useRef, useState } from 'react';

export type Loadable<T> =
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  | { status: 'notFound' }
  | { status: 'error'; error: unknown };

/** 404, and 422 for a malformed id in the URL: the page simply does not exist. */
function isNotFound(error: unknown): boolean {
  return error instanceof ApiRequestError && (error.status === 404 || error.status === 422);
}

/**
 * Loads data for `key`; a new key starts a new request and ignores answers to the old one.
 * `load` may change on every render, only `key` decides when to reload.
 */
export function useApi<T>(
  key: string,
  load: () => Promise<T>,
): Loadable<T> & { retry: () => void } {
  const loadRef = useRef(load);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; attempt: number; value: Loadable<T> } | null>(
    null,
  );

  useEffect(() => {
    loadRef.current = load;
  });

  useEffect(() => {
    let active = true;
    loadRef.current().then(
      (data) => {
        if (active) setResult({ key, attempt, value: { status: 'ready', data } });
      },
      (error: unknown) => {
        if (!active) return;
        setResult({
          key,
          attempt,
          value: isNotFound(error) ? { status: 'notFound' } : { status: 'error', error },
        });
      },
    );
    return () => {
      active = false;
    };
  }, [key, attempt]);

  const retry = useCallback(() => {
    setAttempt((n) => n + 1);
  }, []);

  const value: Loadable<T> =
    result !== null && result.key === key && result.attempt === attempt
      ? result.value
      : { status: 'loading' };
  return { ...value, retry };
}

/** Sets the browser tab title once the page knows what it shows. */
export function useDocumentTitle(title: string | null): void {
  useEffect(() => {
    if (title !== null) document.title = `${title} · ReMusic`;
  }, [title]);
}
