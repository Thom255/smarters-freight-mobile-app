/**
 * Open marketplace browse (SRS §18–§22).
 *
 * Unlike use-trucks/use-cargo (owner-scoped), these list every available truck
 * and every posted load across all owners so a party can find a counterpart.
 */

import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '@/hooks/use-auth';
import { api, ApiError, type ApiCargo, type ApiTruck } from '@/lib/api';
import { readSession } from '@/lib/auth';

type ResourceState<T> = {
  data: T | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  reload: () => Promise<void>;
};

function useBrowseResource<T>(
  load: (token: string) => Promise<T>,
  message: string,
): ResourceState<T> {
  const { status } = useAuth();
  const [data, setData] = useState<T | null>(null);
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
        const result = await load(session.token);
        if (!cancelled) setData(result);
      } catch (e) {
        if (!cancelled) setError(e instanceof ApiError ? e.message : message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // `load` is recreated each render; keying only off auth status is intended.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const reload = useCallback(async () => {
    const session = await readSession().catch(() => null);
    if (!session?.token) return;

    setRefreshing(true);
    setError(null);

    try {
      setData(await load(session.token));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : message);
    } finally {
      setRefreshing(false);
    }
  }, [load, message]);

  if (status === 'signedOut') {
    return { data: null, loading: false, refreshing: false, error: null, reload };
  }

  return { data, loading, refreshing, error, reload };
}

/** Every truck currently listed as available. */
export function useMarketplaceTrucks() {
  const { data, ...rest } = useBrowseResource(
    async (token) => (await api.marketplaceTrucks(token)).trucks,
    'Could not load available trucks.',
  );
  return { trucks: data, ...rest };
}

/** Every load currently posted. */
export function useMarketplaceCargo() {
  const { data, ...rest } = useBrowseResource(
    async (token) => (await api.marketplaceCargo(token)).cargo,
    'Could not load posted loads.',
  );
  return { cargo: data, ...rest };
}

/** One available truck, for the browse detail screen. */
export function useMarketplaceTruck(id: string) {
  const [truck, setTruck] = useState<ApiTruck | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
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
        const result = await api.marketplaceTruck(session.token, id);
        if (!cancelled) setTruck(result.truck);
      } catch (e) {
        if (!cancelled) setError(e instanceof ApiError ? e.message : 'Could not load this truck.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [id]);

  return { truck, loading, error };
}

/** One posted load, for the browse detail screen. */
export function useMarketplaceCargoItem(id: string) {
  const [cargo, setCargo] = useState<ApiCargo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
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
        const result = await api.marketplaceCargoItem(session.token, id);
        if (!cancelled) setCargo(result.cargo);
      } catch (e) {
        if (!cancelled) setError(e instanceof ApiError ? e.message : 'Could not load this load.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [id]);

  return { cargo, loading, error };
}
