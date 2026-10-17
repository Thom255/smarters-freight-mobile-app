/**
 * Shipment data + actions through the Laravel backend:
 * list/detail fetching (shipments screens), creation (new-shipment screen)
 * and updates (status transitions + detail edits on the detail screen).
 */

import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '@/hooks/use-auth';
import {
  api,
  ApiError,
  type ApiShipment,
  type ShipmentUpdateInput,
} from '@/lib/api';
import { readSession } from '@/lib/auth';
import {
  shipmentFormToCreateInput,
  validateShipmentForm,
  type ShipmentFormValues,
} from '@/lib/shipment-form';

export type CreateShipmentResult =
  | { ok: true; shipment: ApiShipment }
  | { ok: false; field: string; message: string };

/**
 * Fetches the caller's shipments (newest first) with loading / refresh /
 * error state, mirroring useDashboard's rules: async work only after an
 * await, and 'signedOut' handled by derivation instead of effect writes.
 */
export function useShipments() {
  const { status } = useAuth();
  const [shipments, setShipments] = useState<ApiShipment[] | null>(null);
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
        const payload = await api.shipments(session.token);
        if (!cancelled) setShipments(payload.shipments);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof ApiError ? e.message : 'Could not load your shipments.');
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
      const payload = await api.shipments(session.token);
      setShipments(payload.shipments);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load your shipments.');
    } finally {
      setRefreshing(false);
    }
  }, []);

  if (status === 'signedOut') {
    return { shipments: null, loading: false, refreshing: false, error: null, reload };
  }

  return { shipments, loading, refreshing, error, reload };
}

/**
 * Fetches a single shipment by id for the detail screen.
 */
export function useShipment(id: string) {
  const { status } = useAuth();
  const [shipment, setShipment] = useState<ApiShipment | null>(null);
  const [loading, setLoading] = useState(true);
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
        const payload = await api.shipment(session.token, id);
        if (!cancelled) setShipment(payload.shipment);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof ApiError ? e.message : 'Could not load this shipment.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [status, id]);

  /** Re-fetch after an error; keeps the view stable like useDashboard.reload. */
  const reload = useCallback(async () => {
    const session = await readSession().catch(() => null);
    if (!session?.token) return;

    setLoading(true);
    setError(null);

    try {
      const payload = await api.shipment(session.token, id);
      setShipment(payload.shipment);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load this shipment.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  if (status === 'signedOut') {
    return { shipment: null, loading: false, error: null, reload };
  }

  return { shipment, loading, error, reload };
}

/**
 * Returns createShipment + submitting flag. The caller owns the form; this
 * hook validates (again), posts the shipment and maps field errors.
 */
export function useCreateShipment() {
  const [submitting, setSubmitting] = useState(false);

  const createShipment = useCallback(
    async (values: ShipmentFormValues): Promise<CreateShipmentResult> => {
      const errors = validateShipmentForm(values);
      const firstField = Object.keys(errors)[0] as keyof typeof errors | undefined;
      if (firstField) {
        return { ok: false, field: firstField, message: errors[firstField] as string };
      }

      setSubmitting(true);
      try {
        const session = await readSession().catch(() => null);
        if (!session?.token) {
          return { ok: false, field: 'form', message: 'Session expired. Sign in again.' };
        }

        const result = await api.createShipment(session.token, shipmentFormToCreateInput(values));
        return { ok: true, shipment: result.shipment };
      } catch (e) {
        if (e instanceof ApiError) {
          return { ok: false, field: e.field, message: e.message };
        }
        return { ok: false, field: 'form', message: 'Could not create the shipment.' };
      } finally {
        setSubmitting(false);
      }
    },
    [],
  );

  return { createShipment, submitting };
}

export type UpdateShipmentResult =
  | { ok: true; shipment: ApiShipment }
  | { ok: false; field: string; message: string };

/**
 * Sends a status transition or a detail edit for one shipment. The caller owns
 * any confirm dialog and re-fetches with `reload()` afterwards so the timeline
 * shows the event the backend just recorded.
 */
export function useUpdateShipment() {
  const [saving, setSaving] = useState(false);

  const updateShipment = useCallback(
    async (id: string, input: ShipmentUpdateInput): Promise<UpdateShipmentResult> => {
      setSaving(true);
      try {
        const session = await readSession().catch(() => null);
        if (!session?.token) {
          return { ok: false, field: 'form', message: 'Session expired. Sign in again.' };
        }

        const result = await api.updateShipment(session.token, id, input);
        return { ok: true, shipment: result.shipment };
      } catch (e) {
        if (e instanceof ApiError) {
          return { ok: false, field: e.field, message: e.message };
        }
        return { ok: false, field: 'form', message: 'Could not update this shipment.' };
      } finally {
        setSaving(false);
      }
    },
    [],
  );

  return { updateShipment, saving };
}
