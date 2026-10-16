/**
 * Matching data (SRS §18–§22). Matches are computed server-side on every
 * request, so these hooks just fetch the role-appropriate list.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';

import { useAuth } from '@/hooks/use-auth';
import { api, ApiError, type ApiCargo, type ApiMatch, type ApiTruck } from '@/lib/api';
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

export type AcceptMatchResult =
  | { ok: true; truck: ApiTruck; cargo: ApiCargo }
  | { ok: false; field: string; message: string };

/** Books a match. `submittingId` is the match id currently in flight. */
export function useAcceptMatch() {
  const [submittingId, setSubmittingId] = useState<string | null>(null);

  const acceptMatch = useCallback(
    async (truckId: string, cargoId: string): Promise<AcceptMatchResult> => {
      setSubmittingId(`${truckId}:${cargoId}`);
      try {
        const session = await readSession().catch(() => null);
        if (!session?.token) {
          return { ok: false, field: 'session', message: 'Session expired. Sign in again.' };
        }

        const result = await api.acceptMatch(session.token, { truckId, cargoId });
        return { ok: true, truck: result.truck, cargo: result.cargo };
      } catch (e) {
        if (e instanceof ApiError) return { ok: false, field: e.field, message: e.message };
        return { ok: false, field: 'form', message: 'Could not book this match.' };
      } finally {
        setSubmittingId(null);
      }
    },
    [],
  );

  return { acceptMatch, submittingId };
}

/**
 * Wires the confirm → accept → reload flow shared by the three match screens.
 * Returns an `onAccept` handler plus the id of the match being booked.
 */
export function useMatchBooking(onBooked: () => void) {
  const { acceptMatch, submittingId } = useAcceptMatch();

  const onBookedRef = useRef(onBooked);
  useEffect(() => {
    onBookedRef.current = onBooked;
  });

  const onAccept = useCallback(
    (match: ApiMatch) => {
      Alert.alert(
        'Book this match?',
        `Reserve the ${match.truck.truckType} (${match.truck.registrationNumber}) for ${match.cargo.pickupLocation} → ${match.cargo.destination}. This takes the truck off the market and marks the load booked.`,
        [
          { text: 'Not now', style: 'cancel' },
          {
            text: 'Book',
            onPress: () => {
              void (async () => {
                const result = await acceptMatch(match.truck.id, match.cargo.id);
                if (result.ok) {
                  Alert.alert(
                    'Booked',
                    `${match.cargo.reference} is now booked with ${match.truck.registrationNumber}.`,
                  );
                  onBookedRef.current();
                } else {
                  Alert.alert('Could not book', result.message);
                }
              })();
            },
          },
        ],
      );
    },
    [acceptMatch],
  );

  return { onAccept, submittingId };
}
