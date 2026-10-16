/**
 * Pure auth core — no React Native imports, so it can be unit
 * tested anywhere (including plain Node).
 *
 * Account storage and password verification live on the Laravel backend
 * (backend/ in this repo, hosted remotely): register/login go through
 * src/lib/api.ts. This module keeps the shared types plus the client-side
 * validation used for instant feedback before a request is sent — the server
 * re-validates everything with the exact same rules and messages.
 */

export type UserRole = 'truck_owner' | 'cargo_owner' | 'admin';

export type User = {
  id: string;
  identifier: string;
  name: string | null;
  role: UserRole;
  companyName: string | null;
  createdAt: number | null;
};

export type AuthField =
  | 'name'
  | 'identifier'
  | 'password'
  | 'confirm'
  | 'role'
  | 'form';

export type AuthSuccess = { ok: true; user: User };
export type AuthFailure = { ok: false; field: AuthField; message: string };
export type AuthResult = AuthSuccess | AuthFailure;

export type RegisterInput = {
  name: string;
  identifier: string;
  password: string;
  confirm?: string;
  role?: UserRole;
  companyName?: string;
};

export type LoginInput = {
  identifier: string;
  password: string;
};

/** Emails and phone numbers are matched case-insensitively and trimmed. */
export function normalizeIdentifier(value: string): string {
  return value.trim().toLowerCase();
}

export function validateIdentifier(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return 'Enter your email or phone number';

  const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(trimmed);
  const isPhone = /^\+?[\d\s()-]{7,15}$/.test(trimmed);

  if (!isEmail && !isPhone) {
    return 'Enter a valid email address or phone number';
  }
  return null;
}

export function validatePassword(value: string): string | null {
  if (!value) return 'Enter a password';
  if (value.length < 6) return 'Password must be at least 6 characters';
  return null;
}

export function validateName(value: string): string | null {
  if (!value.trim()) return 'Enter your full name';
  if (value.trim().length < 2) return 'Name looks too short';
  return null;
}

export function validateConfirm(password: string, confirm: string): string | null {
  if (confirm !== password) return 'Passwords do not match';
  return null;
}

export function validateRole(value: string | undefined | null): string | null {
  if (value === 'truck_owner' || value === 'cargo_owner') return null;
  return 'Choose whether you own trucks or cargo';
}

/** First failing field for the register form, or null when it may be sent. */
export function validateRegister(input: RegisterInput): AuthFailure | null {
  const nameError = validateName(input.name ?? '');
  if (nameError) return { ok: false, field: 'name', message: nameError };

  const identifierError = validateIdentifier(input.identifier);
  if (identifierError) return { ok: false, field: 'identifier', message: identifierError };

  const passwordError = validatePassword(input.password);
  if (passwordError) return { ok: false, field: 'password', message: passwordError };

  if (input.confirm !== undefined) {
    const confirmError = validateConfirm(input.password, input.confirm);
    if (confirmError) return { ok: false, field: 'confirm', message: confirmError };
  }

  if (input.role !== undefined) {
    const roleError = validateRole(input.role);
    if (roleError) return { ok: false, field: 'role', message: roleError };
  }

  return null;
}

/** First failing field for the login form, or null when it may be sent. */
export function validateLogin(input: LoginInput): AuthFailure | null {
  const identifierError = validateIdentifier(input.identifier);
  if (identifierError) return { ok: false, field: 'identifier', message: identifierError };

  if (!input.password) return { ok: false, field: 'password', message: 'Enter a password' };

  return null;
}

const KNOWN_FIELDS: readonly string[] = [
  'name',
  'identifier',
  'password',
  'confirm',
  'role',
  'form',
];

/**
 * Converts any thrown API/network error into an AuthFailure the screens can
 * render inline. Unknown fields collapse to 'form'.
 */
export function toAuthFailure(error: unknown): AuthFailure {
  if (error && typeof error === 'object') {
    const candidate = error as { field?: unknown; message?: unknown };

    if (typeof candidate.message === 'string' && candidate.message.length > 0) {
      const field =
        typeof candidate.field === 'string' && KNOWN_FIELDS.includes(candidate.field)
          ? (candidate.field as AuthField)
          : 'form';
      return { ok: false, field, message: candidate.message };
    }
  }

  return { ok: false, field: 'form', message: 'Something went wrong. Please try again.' };
}
