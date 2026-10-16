/**
 * App-wide auth state.
 *
 * Hydrates the saved session on launch (then revalidates it against
 * GET /api/auth/me) and exposes signIn / signUp / signOut backed by the
 * Laravel backend — the local account store is gone.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { api, ApiError } from '@/lib/api';
import {
  toAuthFailure,
  validateLogin,
  validateRegister,
  type AuthResult,
  type LoginInput,
  type RegisterInput,
  type User,
} from '@/lib/auth-core';
import { clearSession, readSession, writeSession } from '@/lib/auth';

export type AuthStatus = 'loading' | 'authenticated' | 'signedOut';

export type AuthContextValue = {
  status: AuthStatus;
  user: User | null;
  signIn: (input: LoginInput) => Promise<AuthResult>;
  signUp: (input: RegisterInput) => Promise<AuthResult>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    let active = true;

    (async () => {
      try {
        const session = await readSession();
        if (!active) return;

        if (!session) {
          setUser(null);
          setStatus('signedOut');
          return;
        }

        // Optimistically restore, then verify the token is still valid.
        setUser(session.user);
        setStatus('authenticated');

        try {
          const me = await api.me(session.token);
          if (!active) return;
          setUser(me.user);
          await writeSession(me.user, session.token);
        } catch (error) {
          if (!active) return;
          // Only sign out on a rejected token — keep the session offline.
          if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
            await clearSession();
            setUser(null);
            setStatus('signedOut');
          }
        }
      } catch {
        if (!active) return;
        setUser(null);
        setStatus('signedOut');
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  const signIn = useCallback(async (input: LoginInput): Promise<AuthResult> => {
    const invalid = validateLogin(input);
    if (invalid) return invalid;

    try {
      const result = await api.login(input);
      await writeSession(result.user, result.token);
      setUser(result.user);
      setStatus('authenticated');
      return { ok: true, user: result.user };
    } catch (error) {
      return toAuthFailure(error);
    }
  }, []);

  const signUp = useCallback(async (input: RegisterInput): Promise<AuthResult> => {
    const invalid = validateRegister(input);
    if (invalid) return invalid;

    try {
      const result = await api.register(input);
      await writeSession(result.user, result.token);
      setUser(result.user);
      setStatus('authenticated');
      return { ok: true, user: result.user };
    } catch (error) {
      return toAuthFailure(error);
    }
  }, []);

  const signOut = useCallback(async () => {
    // Read the token before clearing so the server revokes it too.
    const session = await readSession().catch(() => null);

    await clearSession();
    setUser(null);
    setStatus('signedOut');

    if (session?.token) {
      await api.logout(session.token).catch(() => {
        // Best effort — local session is already gone.
      });
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, signIn, signUp, signOut }),
    [status, user, signIn, signUp, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an <AuthProvider>');
  }
  return context;
}
