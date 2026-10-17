/**
 * Matching data (SRS §18–§22). Matches are computed server-side on every
 * request, so these hooks just fetch the role-appropriate list.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';

import { useAuth } from '@/hooks/use-auth';
import { api, ApiError, type ApiBooking, type ApiCargo, type ApiMatch, type ApiTruck } from '@/lib/api';
import { readSession } from '@/lib/auth';

type MatchState = {
  matches: ApiMatch[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
};

/**
 * Shared loader for the three match endpoints. `fetcher` receives the bearer
 * token and returns the match array; `key` changes when the target does.
 */
function useMatchesResource(
  fetcher: (token: string) => Promise<ApiMatch[]>,
  key: string,
): MatchState {
  const { status } = useAuth();
  const [matches, setMatches] = useState<ApiMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Latest-ref pattern: the effect keys off `key`, not the fresh closure.
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  });

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
        const result = await fetcherRef.current(session.token);
        if (!cancelled) setMatches(result);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof ApiError ? e.message : 'Could not load matches.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [status, key]);

  const reload = useCallback(async () => {
    const session = await readSession().catch(() => null);
    if (!session?.token) return;

    setLoading(true);
    setError(null);

    try {
      setMatches(await fetcherRef.current(session.token));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load matches.');
    } finally {
      setLoading(false);
    }
  }, []);

  if (status === 'signedOut') {
    return { matches: [], loading: false, error: null, reload };
  }

  return { matches, loading, error, reload };
}

/** Role-aware best matches for the signed-in user. */
export function useMatches(): MatchState {
  return useMatchesResource(async (token) => (await api.matches(token)).matches, 'overview');
}

/** Available trucks matched to one of the caller's cargo loads. */
export function useCargoMatches(cargoId: string): MatchState {
  return useMatchesResource(
    async (token) => (await api.matchesForCargo(token, cargoId)).matches,
    `cargo:${cargoId}`,
  );
}

/** Posted cargo matched to one of the caller's trucks. */
export function useTruckMatches(truckId: string): MatchState {
  return useMatchesResource(
    async (token) => (await api.matchesForTruck(token, truckId)).matches,
    `truck:${truckId}`,
  );
}

export type RequestBookingResult =
  | { ok: true; booking: ApiBooking; truck: ApiTruck; cargo: ApiCargo }
  | { ok: false; field: string; message: string };

/** Sends a booking request for a match. `submittingId` is the match in flight. */
export function useRequestBooking() {
  const [submittingId, setSubmittingId] = useState<string | null>(null);

  const requestBooking = useCallback(
    async (
      truckId: string,
      cargoId: string,
      extra?: { price?: number; message?: string },
    ): Promise<RequestBookingResult> => {
      setSubmittingId(`${truckId}:${cargoId}`);
      try {
        const session = await readSession().catch(() => null);
        if (!session?.token) {
          return { ok: false, field: 'session', message: 'Session expired. Sign in again.' };
        }

        const result = await api.requestBooking(session.token, {
          truckId,
          cargoId,
          ...extra,
        });
        return { ok: true, booking: result.booking, truck: result.truck, cargo: result.cargo };
      } catch (e) {
        if (e instanceof ApiError) return { ok: false, field: e.field, message: e.message };
        return { ok: false, field: 'form', message: 'Could not send the booking request.' };
      } finally {
        setSubmittingId(null);
      }
    },
    [],
  );

  return { requestBooking, submittingId };
}

/**
 * Wires the confirm → request → reload flow shared by the three match screens.
 * Returns an `onAccept` handler (label reads "Request" in the UI) plus the id
 * of the match currently in flight.
 */
export function useMatchBooking(onRequested: () => void) {
  const { requestBooking, submittingId } = useRequestBooking();

  const onRequestedRef = useRef(onRequested);
  useEffect(() => {
    onRequestedRef.current = onRequested;
  });

  const onAccept = useCallback(
    (match: ApiMatch) => {
      Alert.alert(
        'Send booking request?',
        `Ask the owner to reserve the ${match.truck.truckType} (${match.truck.registrationNumber}) for ${match.cargo.pickupLocation} → ${match.cargo.destination}. They can accept or decline.`,
        [
          { text: 'Not now', style: 'cancel' },
          {
            text: 'Send request',
            onPress: () => {
              void (async () => {
                const result = await requestBooking(match.truck.id, match.cargo.id);
                if (result.ok) {
                  Alert.alert(
                    'Request sent',
                    `Your request for ${match.cargo.reference} is pending the other party's response. Track it under Bookings.`,
                  );
                  onRequestedRef.current();
                } else {
                  Alert.alert('Could not request', result.message);
                }
              })();
            },
          },
        ],
      );
    },
    [requestBooking],
  );

  return { onAccept, submittingId };
}
