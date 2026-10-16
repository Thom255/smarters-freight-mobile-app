/**
 * Dashboard data hook — GET /api/dashboard through the Laravel backend.
 *
 * The effect only *starts* an async fetch (all setState calls happen after
 * an await, never synchronously in the effect body); 'signedOut' is handled
 * by derivation, not by resetting state from the effect.
 */

import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '@/hooks/use-auth';
import { api, ApiError, type DashboardPayload } from '@/lib/api';
import { readSession } from '@/lib/auth';

export type DashboardState = {
  data: DashboardPayload | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  /** Re-fetch; keeps data on screen and flips only the refresh flag. */
  reload: () => Promise<void>;
};

export function useDashboard(): DashboardState {
  const { status } = useAuth();
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status !== 'authenticated') return;

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
        const payload = await api.dashboard(session.token);
        if (!cancelled) setData(payload);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof ApiError ? e.message : 'Could not load your dashboard.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [status]);

  const reload = useCallback(async () => {
    const session = await readSession().catch(() => null);
    if (!session?.token) return;

    setRefreshing(true);
    setError(null);

    try {
      setData(await api.dashboard(session.token));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load your dashboard.');
    } finally {
      setRefreshing(false);
    }
  }, []);

  // Signed out (or still hydrating): derive an empty view instead of
  // mutating state from the effect. The (tabs) route unmounts on sign-out
  // anyway, so stale data can never linger on screen.
  if (status === 'signedOut') {
    return { data: null, loading: false, refreshing: false, error: null, reload };
  }

  return { data, loading, refreshing, error, reload };
}
