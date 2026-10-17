/**
 * Truck data + actions for truck owners (SRS §14).
 * Mirrors useShipments: async work only after an await, 'signedOut' derived.
 */

import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '@/hooks/use-auth';
import { api, ApiError, type ApiTruck, type TruckStatus } from '@/lib/api';
import { readSession } from '@/lib/auth';

export type NewTruckInput = {
  registrationNumber: string;
  truckType: string;
  capacityTons: number;
  currentLocation: string;
  /** 'YYYY-MM-DD' */
  availabilityDate: string;
  driverName?: string;
  driverPhone?: string;
  ratePerTon?: number;
};

export type TruckActionResult =
  | { ok: true; truck: ApiTruck }
  | { ok: false; field: string; message: string };

export function useTrucks() {
  const { status } = useAuth();
  const [trucks, setTrucks] = useState<ApiTruck[] | null>(null);
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
        const payload = await api.trucks(session.token);
        if (!cancelled) setTrucks(payload.trucks);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof ApiError ? e.message : 'Could not load your trucks.');
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
      const payload = await api.trucks(session.token);
      setTrucks(payload.trucks);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load your trucks.');
    } finally {
      setRefreshing(false);
    }
  }, []);

  if (status === 'signedOut') {
    return { trucks: null, loading: false, refreshing: false, error: null, reload };
  }

  return { trucks, loading, refreshing, error, reload };
}

export function useCreateTruck() {
  const [submitting, setSubmitting] = useState(false);

  const createTruck = useCallback(async (input: NewTruckInput): Promise<TruckActionResult> => {
    if (input.registrationNumber.trim().length < 3) {
      return { ok: false, field: 'registrationNumber', message: 'Enter the registration number' };
    }
    if (input.truckType.trim().length < 2) {
      return { ok: false, field: 'truckType', message: 'Enter the truck type' };
    }
    if (!(input.capacityTons > 0)) {
      return { ok: false, field: 'capacityTons', message: 'Enter the capacity in tons' };
    }
    if (input.currentLocation.trim().length < 2) {
      return { ok: false, field: 'currentLocation', message: 'Enter the truck location' };
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.availabilityDate)) {
      return { ok: false, field: 'availabilityDate', message: 'Choose an availability date' };
    }

    setSubmitting(true);
    try {
      const session = await readSession().catch(() => null);
      if (!session?.token) {
        return { ok: false, field: 'form', message: 'Session expired. Sign in again.' };
      }

      const result = await api.createTruck(session.token, {
        registrationNumber: input.registrationNumber.trim(),
        truckType: input.truckType.trim(),
        capacityTons: input.capacityTons,
        currentLocation: input.currentLocation.trim(),
        availabilityDate: input.availabilityDate,
        driverName: input.driverName?.trim() || undefined,
        driverPhone: input.driverPhone?.trim() || undefined,
        ratePerTon: input.ratePerTon,
      });
      return { ok: true, truck: result.truck };
    } catch (e) {
      if (e instanceof ApiError) return { ok: false, field: e.field, message: e.message };
      return { ok: false, field: 'form', message: 'Could not add the truck.' };
    } finally {
      setSubmitting(false);
    }
  }, []);

  return { createTruck, submitting };
}

export function useUpdateTruck() {
  const [saving, setSaving] = useState(false);

  const updateTruck = useCallback(
    async (
      id: string,
      input: { status?: TruckStatus; currentLocation?: string; availabilityDate?: string },
    ): Promise<TruckActionResult> => {
      setSaving(true);
      try {
        const session = await readSession().catch(() => null);
        if (!session?.token) {
          return { ok: false, field: 'form', message: 'Session expired. Sign in again.' };
        }

        const result = await api.updateTruck(session.token, id, input);
        return { ok: true, truck: result.truck };
      } catch (e) {
        if (e instanceof ApiError) return { ok: false, field: e.field, message: e.message };
        return { ok: false, field: 'form', message: 'Could not update the truck.' };
      } finally {
        setSaving(false);
      }
    },
    [],
  );

  return { updateTruck, saving };
}
