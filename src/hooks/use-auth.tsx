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

import { api, ApiError, onUnauthorized } from '@/lib/api';
import {
  toAuthFailure,
  validateForgotPassword,
  validateLogin,
  validateRegister,
  validateResetPassword,
  type AuthResult,
  type ForgotPasswordInput,
  type LoginInput,
  type RegisterInput,
  type ResetPasswordInput,
  type User,
} from '@/lib/auth-core';
import { clearSession, readSession, writeSession } from '@/lib/auth';

export type AuthStatus = 'loading' | 'authenticated' | 'signedOut';

/** Result of the two password-recovery steps screens need to render. */
export type PasswordResetResult =
  | { ok: true; message: string }
  | { ok: false; field: string; message: string };

export type AuthContextValue = {
  status: AuthStatus;
  user: User | null;
  signIn: (input: LoginInput) => Promise<AuthResult>;
  signUp: (input: RegisterInput) => Promise<AuthResult>;
  signOut: () => Promise<void>;
  requestPasswordReset: (input: ForgotPasswordInput) => Promise<PasswordResetResult>;
  resetPassword: (input: ResetPasswordInput) => Promise<PasswordResetResult>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<User | null>(null);

  /** Drops the local session without a server round trip. Idempotent. */
  const clearLocalSession = useCallback(async () => {
    await clearSession().catch(() => undefined);
    setUser(null);
    setStatus('signedOut');
  }, []);

  // Any authenticated request rejected with 401 (expired/revoked token, or a
  // deleted account) ends the session here — the protected routes unmount and
  // the user lands back on sign-in instead of staring at an error no refresh
  // could fix.
  useEffect(() => onUnauthorized(() => void clearLocalSession()), [clearLocalSession]);

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

  const requestPasswordReset = useCallback(
    async (input: ForgotPasswordInput): Promise<PasswordResetResult> => {
      const invalid = validateForgotPassword(input);
      if (invalid) return { ok: false, field: invalid.field, message: invalid.message };

      try {
        const result = await api.forgotPassword({ identifier: input.identifier.trim() });
        return { ok: true, message: result.message };
      } catch (error) {
        const failure = toAuthFailure(error);
        return { ok: false, field: failure.field, message: failure.message };
      }
    },
    [],
  );

  const resetPassword = useCallback(
    async (input: ResetPasswordInput): Promise<PasswordResetResult> => {
      const invalid = validateResetPassword(input);
      if (invalid) return { ok: false, field: invalid.field, message: invalid.message };

      try {
        const result = await api.resetPassword(input);
        return { ok: true, message: result.message };
      } catch (error) {
        const failure = toAuthFailure(error);
        return { ok: false, field: failure.field, message: failure.message };
      }
    },
    [],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      signIn,
      signUp,
      signOut,
      requestPasswordReset,
      resetPassword,
    }),
    [status, user, signIn, signUp, signOut, requestPasswordReset, resetPassword],
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
