/**
 * Booking request data + actions (SRS §18–§22).
 *
 * A booking is created when one party asks another to reserve their truck or
 * load. The responder accepts or rejects; either party can cancel. This hook
 * mirrors use-trucks: async work only after an await, 'signedOut' derived.
 */

import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '@/hooks/use-auth';
import { api, ApiError, type ApiBooking } from '@/lib/api';
import { readSession } from '@/lib/auth';

export type BookingActionResult =
  | { ok: true; booking: ApiBooking }
  | { ok: false; field: string; message: string };

export function useBookings() {
  const { status } = useAuth();
  const [bookings, setBookings] = useState<ApiBooking[] | null>(null);
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
        const payload = await api.bookings(session.token);
        if (!cancelled) setBookings(payload.bookings);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof ApiError ? e.message : 'Could not load your bookings.');
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
      const payload = await api.bookings(session.token);
      setBookings(payload.bookings);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load your bookings.');
    } finally {
      setRefreshing(false);
    }
  }, []);

  if (status === 'signedOut') {
    return { bookings: null, loading: false, refreshing: false, error: null, reload };
  }

  return { bookings, loading, refreshing, error, reload };
}

export type BookingDecision = 'accept' | 'reject' | 'cancel';

/** Accept / reject / cancel a booking. `submittingId` is the booking in flight. */
export function useBookingActions() {
  const [submittingId, setSubmittingId] = useState<string | null>(null);

  const decide = useCallback(
    async (id: string, action: BookingDecision): Promise<BookingActionResult> => {
      setSubmittingId(id);
      try {
        const session = await readSession().catch(() => null);
        if (!session?.token) {
          return { ok: false, field: 'session', message: 'Session expired. Sign in again.' };
        }

        const result =
          action === 'accept'
            ? await api.acceptBooking(session.token, id)
            : action === 'reject'
              ? await api.rejectBooking(session.token, id)
              : await api.cancelBooking(session.token, id);

        return { ok: true, booking: result.booking };
      } catch (e) {
        if (e instanceof ApiError) return { ok: false, field: e.field, message: e.message };
        return { ok: false, field: 'form', message: 'Could not update the booking.' };
      } finally {
        setSubmittingId(null);
      }
    },
    [],
  );

  return { decide, submittingId };
}
