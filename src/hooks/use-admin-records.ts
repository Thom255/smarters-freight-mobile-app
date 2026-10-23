/**
 * Admin console records hook — the system-wide lists behind the admin
 * "System records" screen (users, cargo, trucks, bookings, shipments).
 *
 * Follows the useRevenue contract: the effect only *starts* async work, every
 * setState happens after an await, and the signed-out / non-admin views are
 * derived instead of mutating state.
 *
 * One list is fetched per tab and then cached, so switching tabs does not
 * re-fetch what is already on screen; pull-to-refresh forces the active tab
 * to reload.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { useAuth } from '@/hooks/use-auth';
import {
  api,
  ApiError,
  type AdminAccountStatus,
  type AdminBookingRecord,
  type AdminCargoRecord,
  type AdminShipmentRecord,
  type AdminTruckRecord,
  type AdminUser,
} from '@/lib/api';
import { readSession } from '@/lib/auth';
import type { UserRole } from '@/lib/auth-core';

export type AdminRecordTab = 'users' | 'cargo' | 'trucks' | 'bookings' | 'shipments';

export type AdminRecordLists = {
  users: AdminUser[];
  cargo: AdminCargoRecord[];
  trucks: AdminTruckRecord[];
  bookings: AdminBookingRecord[];
  shipments: AdminShipmentRecord[];
};

export type AdminRecordsState = {
  lists: Partial<AdminRecordLists>;
  /** The active tab has no rows yet and no error — the screen shows a skeleton. */
  loading: boolean;
  /** The active tab failed to load. */
  error: string | null;
  refreshing: boolean;
  /** Id of the account currently being written, or null. */
  updatingId: string | null;
  /** Re-fetch the active tab, keeping the current list on screen. */
  reload: () => Promise<void>;
  /** Change another account's role and/or status. */
  updateUser: (
    id: string,
    input: { role?: UserRole; status?: AdminAccountStatus },
  ) => Promise<void>;
};

const LOAD_ERROR = 'Could not load the records.';
const NO_SESSION_ERROR = 'Your session has expired. Please sign in again.';

const FETCHERS: {
  [K in AdminRecordTab]: (token: string) => Promise<AdminRecordLists[K]>;
} = {
  users: async (token) => (await api.adminUsers(token)).users,
  cargo: async (token) => (await api.adminCargoList(token)).cargo,
  trucks: async (token) => (await api.adminTrucksList(token)).trucks,
  bookings: async (token) => (await api.adminBookingsList(token)).bookings,
  shipments: async (token) => (await api.adminShipmentsList(token)).shipments,
};

/** Type-safe list merge for the computed `[tab]` key. */
function withList<K extends AdminRecordTab>(
  lists: Partial<AdminRecordLists>,
  tab: K,
  rows: AdminRecordLists[K],
): Partial<AdminRecordLists> {
  return { ...lists, [tab]: rows };
}

export function useAdminRecords(tab: AdminRecordTab): AdminRecordsState {
  const { status, user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [lists, setLists] = useState<Partial<AdminRecordLists>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The tab the error belongs to — errors never leak across tabs. */
  const [errorTab, setErrorTab] = useState<AdminRecordTab | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  /** Tabs already fetched — keeps tab switches off the network. */
  const loadedRef = useRef<Partial<Record<AdminRecordTab, boolean>>>({});

  useEffect(() => {
    if (status !== 'authenticated' || !isAdmin) return;

    let cancelled = false;

    (async () => {
      const session = await readSession().catch(() => null);
      if (cancelled) return;

      if (!session?.token) {
        setErrorTab(tab);
        setError(NO_SESSION_ERROR);
        return;
      }

      // Already on screen — no second round trip.
      if (loadedRef.current[tab]) return;

      setErrorTab(null);
      setError(null);

      try {
        const rows = await FETCHERS[tab](session.token);
        if (cancelled) return;

        loadedRef.current[tab] = true;
        setLists((prev) => withList(prev, tab, rows));
      } catch (e) {
        if (cancelled) return;

        setErrorTab(tab);
        setError(e instanceof ApiError ? e.message : LOAD_ERROR);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [status, isAdmin, tab]);

  const reload = useCallback(async () => {
    const session = await readSession().catch(() => null);
    if (!session?.token) {
      setErrorTab(tab);
      setError(NO_SESSION_ERROR);
      return;
    }

    setRefreshing(true);
    setErrorTab(null);
    setError(null);

    try {
      const rows = await FETCHERS[tab](session.token);
      loadedRef.current[tab] = true;
      setLists((prev) => withList(prev, tab, rows));
    } catch (e) {
      setErrorTab(tab);
      setError(e instanceof ApiError ? e.message : LOAD_ERROR);
    } finally {
      setRefreshing(false);
    }
  }, [tab]);

  const updateUser = useCallback(
    async (id: string, input: { role?: UserRole; status?: AdminAccountStatus }) => {
      const session = await readSession().catch(() => null);
      if (!session?.token) throw new Error(NO_SESSION_ERROR);

      setUpdatingId(id);

      try {
        const result = await api.updateAdminUser(session.token, id, input);

        setLists((prev) => {
          const users = prev.users;
          if (!users) return prev;

          return {
            ...prev,
            users: users.map((account) =>
              account.id === id ? result.user : account,
            ),
          };
        });
      } finally {
        setUpdatingId(null);
      }
    },
    [],
  );

  // Derive the non-admin / signed-out views instead of mutating state.
  if (status === 'signedOut') {
    return {
      lists: {},
      loading: false,
      error: null,
      refreshing: false,
      updatingId: null,
      reload,
      updateUser,
    };
  }

  if (!isAdmin) {
    return {
      lists: {},
      loading: status === 'loading',
      error: null,
      refreshing: false,
      updatingId: null,
      reload,
      updateUser,
    };
  }

  const tabRows = lists[tab];
  const tabError = errorTab === tab ? error : null;

  return {
    lists,
    // No rows and no error → the first load for this tab is still running.
    loading: tabRows === undefined && tabError === null,
    error: tabError,
    refreshing,
    updatingId,
    reload,
    updateUser,
  };
}
