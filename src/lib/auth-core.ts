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

/** Screens whose access is decided by the server-verified account role. */
export type RoleArea = 'admin' | 'cargo' | 'trucks';

/** The home route each role lands on after sign-in / session restore. */
export type DashboardPath = '/' | '/admin';

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
  | 'token'
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

export type ForgotPasswordInput = {
  identifier: string;
};

export type ResetPasswordInput = {
  identifier: string;
  token: string;
  password: string;
  confirm?: string;
};

/** Emails and phone numbers are matched case-insensitively and trimmed. */
export function normalizeIdentifier(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Coerces a persisted role to a known value.
 *
 * Storage is client-side, so a tampered/corrupt session must not be able to
 * route the app to the admin area. This only affects navigation; every admin
 * API is still enforced by the backend's `auth.role:admin` middleware.
 */
export function normalizeRole(value: unknown): UserRole {
  return value === 'admin' || value === 'truck_owner' || value === 'cargo_owner'
    ? value
    : 'cargo_owner';
}

/**
 * Role-based landing route. Admins get the system dashboard; cargo and truck
 * owners share the role-aware workspace dashboard.
 */
export function dashboardPathForRole(role: UserRole | null | undefined): DashboardPath {
  return role === 'admin' ? '/admin' : '/';
}

/** The persisted session shape written by src/lib/auth.ts. */
export type StoredSession = { user: User; token: string; issuedAt: number };

/**
 * Validates and normalizes a raw persisted session (SecureStore/localStorage
 * string). Kept pure so session restoration — including role preservation
 * across an app restart — is unit-testable outside React Native.
 *
 * Returns null ("no session") for anything unusable: corrupt JSON, a missing
 * user id or token, or an account whose role field is absent/corrupted. The
 * role is run through normalizeRole, so a tampered session can at most route
 * the app to the least-privileged dashboard; every admin API is still gated
 * server-side by `auth.role:admin` regardless of what this returns.
 */
export function parseSession(raw: string | null | undefined): StoredSession | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (parsed === null || typeof parsed !== 'object') return null;

  const session = parsed as {
    user?: { id?: unknown; role?: unknown; companyName?: unknown; name?: unknown; identifier?: unknown; createdAt?: unknown };
    token?: unknown;
    issuedAt?: unknown;
  };

  if (!session.user || typeof session.user.id !== 'string' || session.user.id === '') {
    return null;
  }

  if (typeof session.token !== 'string' || session.token === '') {
    return null;
  }

  return {
    user: {
      id: session.user.id,
      identifier: typeof session.user.identifier === 'string' ? session.user.identifier : '',
      name: typeof session.user.name === 'string' ? session.user.name : null,
      // Sessions written before roles existed (or tampered with) fall back
      // to the least-privileged role — never to admin.
      role: normalizeRole(session.user.role),
      companyName: typeof session.user.companyName === 'string' ? session.user.companyName : null,
      createdAt: typeof session.user.createdAt === 'number' ? session.user.createdAt : null,
    },
    token: session.token,
    issuedAt: typeof session.issuedAt === 'number' ? session.issuedAt : 0,
  };
}

/**
 * Whether a role may open one of the role-owned dashboards. Admin is
 * intentionally excluded from the cargo-owner and truck-owner workspaces:
 * admins manage those records through the admin console instead.
 */
export function roleCanAccessArea(
  role: UserRole | null | undefined,
  area: RoleArea,
): boolean {
  switch (area) {
    case 'admin':
      return role === 'admin';
    case 'cargo':
      return role === 'cargo_owner';
    case 'trucks':
      return role === 'truck_owner';
  }
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

/** First failing field for the forgot-password form, or null when it may be sent. */
export function validateForgotPassword(input: ForgotPasswordInput): AuthFailure | null {
  const identifierError = validateIdentifier(input.identifier);
  if (identifierError) return { ok: false, field: 'identifier', message: identifierError };

  return null;
}

/** First failing field for the reset-password form, or null when it may be sent. */
export function validateResetPassword(input: ResetPasswordInput): AuthFailure | null {
  if (!input.token?.trim()) {
    return {
      ok: false,
      field: 'token',
      message: 'This reset link is invalid. Request a new one.',
    };
  }

  const identifierError = validateIdentifier(input.identifier);
  if (identifierError) return { ok: false, field: 'identifier', message: identifierError };

  const passwordError = validatePassword(input.password);
  if (passwordError) return { ok: false, field: 'password', message: passwordError };

  if (input.confirm !== undefined) {
    const confirmError = validateConfirm(input.password, input.confirm);
    if (confirmError) return { ok: false, field: 'confirm', message: confirmError };
  }

  return null;
}

const KNOWN_FIELDS: readonly string[] = [
  'name',
  'identifier',
  'password',
  'confirm',
  'role',
  'token',
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
