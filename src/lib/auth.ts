/**
 * Platform auth session: persists the backend-issued bearer token plus the
 * user profile in SecureStore/localStorage (via src/lib/storage.ts).
 *
 * All register/login/logout calls themselves live in src/lib/api.ts; this
 * module only owns session persistence.
 */

import { parseSession, type User } from './auth-core';
import { getItem, removeItem, setItem } from './storage';

const SESSION_KEY = 'smarters.session';

export type Session = {
  user: User;
  token: string;
  issuedAt: number;
};

export async function readSession(): Promise<Session | null> {
  const raw = await getItem(SESSION_KEY);
  // Validation/normalization (role backfill, corrupt-payload rejection) is
  // shared with the unit tests through auth-core's pure parseSession.
  return parseSession(raw);
}

export async function writeSession(user: User, token: string): Promise<void> {
  const session: Session = { user, token, issuedAt: Date.now() };
  await setItem(SESSION_KEY, JSON.stringify(session));
}

export async function clearSession(): Promise<void> {
  await removeItem(SESSION_KEY);
}
