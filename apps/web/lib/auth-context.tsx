'use client';

import { ApiClient, type LockFn, type Session } from '@mp/api-client';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

export type AuthState =
  | { status: 'loading' }
  | { status: 'signedOut' }
  | { status: 'unavailable' }
  | { status: 'signedIn'; session: Session };

/** Web Locks keep two tabs from rotating the same refresh token at once. */
export function createWebLock(): LockFn | undefined {
  if (typeof navigator === 'undefined' || !('locks' in navigator)) return undefined;
  return async <T,>(name: string, run: () => Promise<T>): Promise<T> => {
    let result: { value: T } | undefined;
    await navigator.locks.request(name, async () => {
      result = { value: await run() };
    });
    if (result === undefined) throw new Error('Lock callback did not run');
    return result.value;
  };
}

/** One client per browser tab. The API is reached through the same-origin proxy (/api/*). */
export const apiClient = new ApiClient({ baseUrl: '/api', lock: createWebLock() });

interface AuthContextValue {
  state: AuthState;
  client: ApiClient;
  retry: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(
    () =>
      apiClient.subscribe((session) => {
        setState(session === null ? { status: 'signedOut' } : { status: 'signedIn', session });
      }),
    [],
  );

  useEffect(() => {
    let active = true;
    apiClient.restore().then(
      (session) => {
        if (active && session === null) setState({ status: 'signedOut' });
      },
      () => {
        if (active) setState({ status: 'unavailable' });
      },
    );
    return () => {
      active = false;
    };
  }, [attempt]);

  const retry = useCallback(() => {
    setState({ status: 'loading' });
    setAttempt((n) => n + 1);
  }, []);

  const value = useMemo(() => ({ state, client: apiClient, retry }), [state, retry]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (value === null) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}

/** For screens rendered inside <RequireAuth>. */
export function useSession(): Session {
  const { state } = useAuth();
  if (state.status !== 'signedIn') throw new Error('useSession requires a signed-in user');
  return state.session;
}
