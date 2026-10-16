/**
 * Cargo data + actions for cargo owners (SRS §16–§17).
 */

import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '@/hooks/use-auth';
import { api, ApiError, type ApiCargo, type CargoStatus } from '@/lib/api';
import { readSession } from '@/lib/auth';

export type NewCargoInput = {
  cargoType: string;
  description?: string;
  weightTons: number;
  pickupLocation: string;
  destination: string;
  /** 'YYYY-MM-DD' */
  pickupDate: string;
  preferredTruckType?: string;
  budget?: number;
  specialRequirements?: string;
};

export type CargoActionResult =
  | { ok: true; cargo: ApiCargo }
  | { ok: false; field: string; message: string };

export function useCargo() {
  const { status } = useAuth();
  const [cargo, setCargo] = useState<ApiCargo[] | null>(null);
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
        const payload = await api.cargo(session.token);
        if (!cancelled) setCargo(payload.cargo);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof ApiError ? e.message : 'Could not load your cargo.');
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
      const payload = await api.cargo(session.token);
      setCargo(payload.cargo);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load your cargo.');
    } finally {
      setRefreshing(false);
    }
  }, []);

  if (status === 'signedOut') {
    return { cargo: null, loading: false, refreshing: false, error: null, reload };
  }

  return { cargo, loading, refreshing, error, reload };
}

export function useCreateCargo() {
  const [submitting, setSubmitting] = useState(false);

  const createCargo = useCallback(async (input: NewCargoInput): Promise<CargoActionResult> => {
    if (input.cargoType.trim().length < 2) {
      return { ok: false, field: 'cargoType', message: 'Enter the cargo type' };
    }
    if (!(input.weightTons > 0)) {
      return { ok: false, field: 'weightTons', message: 'Enter the weight in tons' };
    }
    if (input.pickupLocation.trim().length < 2) {
      return { ok: false, field: 'pickupLocation', message: 'Enter the pickup location' };
    }
    if (input.destination.trim().length < 2) {
      return { ok: false, field: 'destination', message: 'Enter the destination' };
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.pickupDate)) {
      return { ok: false, field: 'pickupDate', message: 'Choose a pickup date' };
    }

    setSubmitting(true);
    try {
      const session = await readSession().catch(() => null);
      if (!session?.token) {
        return { ok: false, field: 'form', message: 'Session expired. Sign in again.' };
      }

      const result = await api.createCargo(session.token, {
        cargoType: input.cargoType.trim(),
        description: input.description?.trim() || undefined,
        weightTons: input.weightTons,
        pickupLocation: input.pickupLocation.trim(),
        destination: input.destination.trim(),
        pickupDate: input.pickupDate,
        preferredTruckType: input.preferredTruckType?.trim() || undefined,
        budget: input.budget,
        specialRequirements: input.specialRequirements?.trim() || undefined,
      });
      return { ok: true, cargo: result.cargo };
    } catch (e) {
      if (e instanceof ApiError) return { ok: false, field: e.field, message: e.message };
      return { ok: false, field: 'form', message: 'Could not post the cargo.' };
    } finally {
      setSubmitting(false);
    }
  }, []);

  return { createCargo, submitting };
}

export function useUpdateCargo() {
  const [saving, setSaving] = useState(false);

  const updateCargo = useCallback(
    async (id: string, input: { status?: CargoStatus }): Promise<CargoActionResult> => {
      setSaving(true);
      try {
        const session = await readSession().catch(() => null);
        if (!session?.token) {
          return { ok: false, field: 'form', message: 'Session expired. Sign in again.' };
        }

        const result = await api.updateCargo(session.token, id, input);
        return { ok: true, cargo: result.cargo };
      } catch (e) {
        if (e instanceof ApiError) return { ok: false, field: e.field, message: e.message };
        return { ok: false, field: 'form', message: 'Could not update the cargo.' };
      } finally {
        setSaving(false);
      }
    },
    [],
  );

  return { updateCargo, saving };
}
