/**
 * Admin revenue data hook — GET /api/admin/revenue through the Laravel
 * backend. Admin only: non-admin sessions never fire the request at all (the
 * endpoint answers 403 anyway), so the screen can render its restricted state
 * without spending a round trip.
 *
 * Follows useDashboard's contract: effects only *start* async work, every
 * setState happens after an await, and signed-out / unknown roles are handled
 * by derivation rather than by resetting state.
 */

import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '@/hooks/use-auth';
import { api, ApiError, type RevenuePayload } from '@/lib/api';
import { readSession } from '@/lib/auth';

export type RevenueState = {
  data: RevenuePayload | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  /** Re-fetch; keeps data on screen and flips only the refresh flag. */
  reload: () => Promise<void>;
};

const LOAD_ERROR = 'Could not load the revenue summary.';

export function useRevenue(): RevenueState {
  const { status, user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [data, setData] = useState<RevenuePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status !== 'authenticated' || !isAdmin) return;

    let cancelled = false;

    (async () => {
      const session = await readSession().catch(() => null);
      if (cancelled || !session?.token) {
        if (!cancelled) setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const payload = await api.adminRevenue(session.token);
        if (!cancelled) setData(payload);
      } catch (e) {
        if (!cancelled) setError(e instanceof ApiError ? e.message : LOAD_ERROR);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [status, isAdmin]);

  const reload = useCallback(async () => {
    const session = await readSession().catch(() => null);
    if (!session?.token) return;

    setRefreshing(true);
    setError(null);

    try {
      setData(await api.adminRevenue(session.token));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : LOAD_ERROR);
    } finally {
      setRefreshing(false);
    }
  }, []);

  // Derive the non-admin / signed-out views instead of mutating state: the
  // (tabs) route unmounts on sign-out, so stale totals can never linger.
  if (status === 'signedOut') {
    return { data: null, loading: false, refreshing: false, error: null, reload };
  }

  if (!isAdmin) {
    // Still hydrating (role unknown yet) → keep the skeleton up; a confirmed
    // non-admin → no data, no spinner, the screen renders its restricted card.
    return {
      data: null,
      loading: status === 'loading',
      refreshing: false,
      error: null,
      reload,
    };
  }

  return { data, loading, refreshing, error, reload };
}