'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export interface Paged<T> {
  readonly status: 'loading' | 'ready' | 'error';
  readonly items: readonly T[];
  readonly hasMore: boolean;
  readonly loadingMore: boolean;
  readonly error: unknown;
  loadMore: () => void;
  reload: () => void;
  /** Local change after a mutation (optimistic remove, reorder). */
  setItems: (update: (items: readonly T[]) => readonly T[]) => void;
}

interface PageOf<T> {
  items: T[];
  nextCursor: string | null;
}

/** First page for `key`, more on demand; a new key starts over. */
export function usePaged<T>(key: string, load: (cursor?: string) => Promise<PageOf<T>>): Paged<T> {
  const loadRef = useRef(load);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{
    key: string;
    attempt: number;
    status: 'loading' | 'ready' | 'error';
    items: readonly T[];
    cursor: string | null;
    loadingMore: boolean;
    error: unknown;
  } | null>(null);

  useEffect(() => {
    loadRef.current = load;
  });

  useEffect(() => {
    let active = true;
    loadRef.current().then(
      (page) => {
        if (!active) return;
        setState({
          key,
          attempt,
          status: 'ready',
          items: page.items,
          cursor: page.nextCursor,
          loadingMore: false,
          error: null,
        });
      },
      (error: unknown) => {
        if (!active) return;
        setState({
          key,
          attempt,
          status: 'error',
          items: [],
          cursor: null,
          loadingMore: false,
          error,
        });
      },
    );
    return () => {
      active = false;
    };
  }, [key, attempt]);

  const current = state !== null && state.key === key && state.attempt === attempt ? state : null;

  const loadMore = useCallback(() => {
    if (current === null || current.cursor === null || current.loadingMore) return;
    const { cursor } = current;
    setState({ ...current, loadingMore: true });
    loadRef.current(cursor).then(
      (page) => {
        setState((previous) =>
          previous === null || previous.key !== current.key || previous.attempt !== current.attempt
            ? previous
            : {
                ...previous,
                items: [...previous.items, ...page.items],
                cursor: page.nextCursor,
                loadingMore: false,
              },
        );
      },
      (error: unknown) => {
        setState((previous) =>
          previous === null ? previous : { ...previous, loadingMore: false, error },
        );
      },
    );
  }, [current]);

  const reload = useCallback(() => {
    setAttempt((n) => n + 1);
  }, []);

  const setItems = useCallback((update: (items: readonly T[]) => readonly T[]) => {
    setState((previous) =>
      previous === null ? previous : { ...previous, items: update(previous.items) },
    );
  }, []);

  return {
    status: current?.status ?? 'loading',
    items: current?.items ?? [],
    hasMore: (current?.cursor ?? null) !== null,
    loadingMore: current?.loadingMore ?? false,
    error: current?.error ?? null,
    loadMore,
    reload,
    setItems,
  };
}
