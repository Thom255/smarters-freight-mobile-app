import { Redirect } from 'expo-router';
import type { ReactNode } from 'react';

import { useAuth } from '@/hooks/use-auth';
import {
  dashboardPathForRole,
  roleCanAccessArea,
  type RoleArea,
} from '@/lib/auth-core';

/**
 * Client-side route guard for role-owned workspaces.
 *
 * The server is the authority: every admin endpoint carries
 * `auth.role:admin`, and resource controllers scope reads/writes by owner.
 * This guard only prevents a signed-in user from *rendering* another role's
 * dashboard after a deep link, and sends them to their own home instead.
 *
 * Session hydration is handled by the root navigator, so there is no role to
 * check while `status === 'loading'`; render nothing in that window.
 */
export function RoleGuard({ area, children }: { area: RoleArea; children: ReactNode }) {
  const { status, user } = useAuth();

  if (status === 'loading') return null;
  if (!user) return null;

  if (!roleCanAccessArea(user.role, area)) {
    return <Redirect href={dashboardPathForRole(user.role)} />;
  }

  return <>{children}</>;
}
