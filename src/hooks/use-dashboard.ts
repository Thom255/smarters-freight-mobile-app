/**
 * Dashboard data hook — GET /api/dashboard through the Laravel backend.
 *
 * Reliability rules enforced here:
 *  - every load (initial effect or manual reload) takes a sequence number;
 *    a slow older response can never overwrite a newer one;
 *  - all setState calls are gated on the mounted flag + current sequence, so
 *    nothing lands after the screen unmounts;
 *  - a failed refresh keeps `data` on screen and only surfaces `error`, while
 *    a failed FIRST load shows the full error card with a working retry;
 *  - the initial skeleton shows while the first load (or its retry) is
 *    pending with no data yet;
 *  - transient network failures are retried with bounded backoff inside the
 *    API client (never 401/403), so a backend that is still starting up
 *    heals on its own instead of dumping the user on the error screen.
 *
 * The effect only *starts* an async fetch (all setState calls happen after
 * an await, never synchronously in the effect body); 'signedOut' is handled
 * by derivation, not by resetting state from the effect.
 */

import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

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

const LOAD_ERROR = 'Could not load your dashboard.';

export function useDashboard(): DashboardState {
  const { status, user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Monotonic id of the newest load; responses from older loads are dropped. */
  const sequenceRef = useRef(0);
  const mountedRef = useRef(true);
  /** The initial load already owns the first focus; later focuses refetch. */
  const hasAttemptedInitialLoadRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /** True only while this load is still the newest one on a mounted screen. */
  const isActive = useCallback(
    (sequence: number) => mountedRef.current && sequence === sequenceRef.current,
    [],
  );

  useEffect(() => {
    // Admins are redirected to the admin dashboard, so the owner-scoped
    // dashboard request is never fired for them.
    if (status !== 'authenticated' || isAdmin) return;

    // Taking a new sequence also invalidates any reload still in flight, so
    // its (older) result can never land on top of this load's outcome.
    const sequence = ++sequenceRef.current;
    let cancelled = false;

    (async () => {
      const session = await readSession().catch(() => null);
      // Bail when the screen unmounted OR a newer load (pull-to-refresh /
      // manual retry) already took over — that load owns the flags now.
      if (cancelled || !isActive(sequence) || !session?.token) {
        if (!cancelled && isActive(sequence)) setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const payload = await api.dashboard(session.token);
        if (isActive(sequence)) setData(payload);
      } catch (e) {
        if (isActive(sequence)) {
          setError(e instanceof ApiError ? e.message : LOAD_ERROR);
        }
      } finally {
        if (isActive(sequence)) {
          hasAttemptedInitialLoadRef.current = true;
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [status, isAdmin, isActive]);

  const reload = useCallback(async () => {
    const sequence = ++sequenceRef.current;
    const session = await readSession().catch(() => null);
    if (!session?.token || !isActive(sequence)) return;

    setRefreshing(true);
    setError(null);

    try {
      const payload = await api.dashboard(session.token);
      if (isActive(sequence)) setData(payload);
    } catch (e) {
      // Keep whatever is already on screen �?" the banner + Retry cover it.
      if (isActive(sequence)) {
        setError(e instanceof ApiError ? e.message : LOAD_ERROR);
      }
    } finally {
      if (isActive(sequence)) setRefreshing(false);
    }
  }, [isActive]);

  // Returning to the dashboard (for example, after adding a truck on the
  // Fleet tab) must show the new totals without a manual pull-to-refresh.
  // The initial effect above already handles first focus; this only runs on
  // later focused visits.
  useFocusEffect(
    useCallback(() => {
      if (
        status !== 'authenticated' ||
        isAdmin ||
        !hasAttemptedInitialLoadRef.current
      ) {
        return;
      }

      void reload();
    }, [status, isAdmin, reload]),
  );

  // Signed out (or still hydrating): derive an empty view instead of
  // mutating state from the effect. The (tabs) route unmounts on sign-out
  // anyway, so stale data can never linger on screen.
  if (status === 'signedOut') {
    return { data: null, loading: false, refreshing: false, error: null, reload };
  }

  return { data, loading, refreshing, error, reload };
}
