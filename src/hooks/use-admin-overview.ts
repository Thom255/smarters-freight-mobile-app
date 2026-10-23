import { useCallback, useEffect, useRef, useState } from 'react';

import { useAuth } from '@/hooks/use-auth';
import { api, ApiError, type AdminOverviewPayload } from '@/lib/api';
import { readSession } from '@/lib/auth';

export type AdminOverviewState = {
  data: AdminOverviewPayload | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  reload: () => Promise<void>;
};

const LOAD_ERROR = 'Could not load the system overview.';

export function useAdminOverview(): AdminOverviewState {
  const { status, user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [data, setData] = useState<AdminOverviewPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Newest load wins: a slow older response is dropped, not applied late. */
  const sequenceRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const isActive = useCallback(
    (sequence: number) => mountedRef.current && sequence === sequenceRef.current,
    [],
  );

  useEffect(() => {
    if (status !== 'authenticated' || !isAdmin) return;

    const sequence = ++sequenceRef.current;
    let cancelled = false;

    (async () => {
      const session = await readSession().catch(() => null);
      if (cancelled || !isActive(sequence) || !session?.token) {
        if (!cancelled && isActive(sequence)) setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const payload = await api.adminOverview(session.token);
        if (isActive(sequence)) setData(payload);
      } catch (e) {
        if (isActive(sequence)) setError(e instanceof ApiError ? e.message : LOAD_ERROR);
      } finally {
        if (isActive(sequence)) setLoading(false);
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
      const payload = await api.adminOverview(session.token);
      if (isActive(sequence)) setData(payload);
    } catch (e) {
      // Keep the last good overview on screen; the banner covers the failure.
      if (isActive(sequence)) setError(e instanceof ApiError ? e.message : LOAD_ERROR);
    } finally {
      if (isActive(sequence)) setRefreshing(false);
    }
  }, [isActive]);

  if (status === 'signedOut') {
    return { data: null, loading: false, refreshing: false, error: null, reload };
  }

  if (!isAdmin) {
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
