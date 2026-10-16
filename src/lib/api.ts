/**
 * Backend REST client.
 *
 * Every service the app needs comes from the Laravel backend in backend/
 * (hosted remotely; Metro is configured to never bundle it). The base URL is
 * inlined at bundle time from EXPO_PUBLIC_API_URL — see .env.
 *
 * No React Native imports here on purpose: this module is plain `fetch`, so
 * scripts/auth-core.test.mjs can exercise it under Node with a mocked fetch.
 */

// Fallback only applies when EXPO_PUBLIC_API_URL is unset. It must point at
// backend/ (port 8001) — port 8000 runs the separate SRS API, whose contract
// this client does not speak.
import type { UserRole } from './auth-core';

const BASE_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8001').replace(
  /\/+$/,
  '',
);

/** Error body the backend returns for any failure: { ok:false, field, message }. */
type ApiErrorShape = { ok?: false; field?: string; message?: string };

export class ApiError extends Error {
  readonly status: number;
  /** AuthField the error belongs to ('form' = not tied to one input). */
  readonly field: string;

  constructor(message: string, status = 0, field = 'form') {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.field = field;
  }
}

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  token?: string | null;
};

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, token } = options;

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('Cannot reach the server. Check your connection and try again.', 0);
  }

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    // Empty or non-JSON body — handled below via status only.
  }

  if (!response.ok) {
    const shape = (payload ?? {}) as ApiErrorShape;
    const message =
      shape.message ??
      (response.status === 401
        ? 'Session expired. Please sign in again.'
        : `Request failed (${response.status})`);
    const field = shape.field ?? (response.status === 401 ? 'form' : 'form');
    throw new ApiError(message, response.status, field);
  }

  return payload as T;
}

// ---------------------------------------------------------------------------
// Payload types (mirror backend/app/Http/Controllers/Api responses)
// ---------------------------------------------------------------------------

export type { UserRole };

export type ApiUser = {
  id: string;
  identifier: string;
  name: string | null;
  role: UserRole;
  companyName: string | null;
  createdAt: number | null;
};

export type AuthPayload = { ok: true; user: ApiUser; token: string };

export type TruckStatus = 'available' | 'booked' | 'in_transit' | 'maintenance' | 'inactive';

/** Compact counterpart shown on a booked load/truck row. */
export type MatchedTruckSummary = {
  id: string;
  registrationNumber: string;
  truckType: string;
  currentLocation: string;
};

export type MatchedCargoSummary = {
  id: string;
  reference: string;
  cargoType: string;
  pickupLocation: string;
  destination: string;
};

export type ApiTruck = {
  id: string;
  registrationNumber: string;
  truckType: string;
  capacityTons: number;
  currentLocation: string;
  availabilityDate: number | null;
  status: TruckStatus;
  verificationStatus: 'pending' | 'verified' | 'rejected';
  /** Set while this truck is booked for a load. */
  matchedCargoId: string | null;
  matchedAt: number | null;
  matchedCargo?: MatchedCargoSummary | null;
  createdAt: number | null;
};

export type CargoStatus =
  | 'posted'
  | 'matched'
  | 'booked'
  | 'in_transit'
  | 'delivered'
  | 'completed'
  | 'cancelled';

export type ApiCargo = {
  id: string;
  reference: string;
  cargoType: string;
  description: string | null;
  weightTons: number;
  pickupLocation: string;
  destination: string;
  pickupDate: number | null;
  preferredTruckType: string | null;
  budget: number | null;
  specialRequirements: string | null;
  status: CargoStatus;
  /** Set while this load is booked with a truck. */
  matchedTruckId: string | null;
  matchedAt: number | null;
  matchedTruck?: MatchedTruckSummary | null;
  createdAt: number | null;
};

export type MatchCategory = 'excellent' | 'good' | 'possible' | 'poor';

export type ApiMatch = {
  id: string;
  score: number;
  category: MatchCategory;
  scores: {
    route: number;
    capacity: number;
    date: number;
    location: number;
    availability: number;
  };
  truck: ApiTruck;
  cargo: ApiCargo;
};

export type ApiShipment = {
  id: string;
  reference: string;
  origin: string;
  destination: string;
  status: 'booked' | 'in_transit' | 'delivered' | 'cancelled';
  notes: string | null;
  createdAt: number | null;
};

export type ApiActivity = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  createdAt: number | null;
  reference: string | null;
};

export type DashboardPayload = {
  ok: true;
  role: UserRole;
  stats: { shipments: number; inTransit: number; orders: number };
  marketplace: {
    trucks: number;
    availableTrucks: number;
    cargo: number;
    postedCargo: number;
    matches: number;
  };
  activeShipment: Omit<ApiShipment, 'notes'> | null;
  recentActivity: ApiActivity[];
};

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

export const api = {
  register(input: {
    name: string;
    identifier: string;
    password: string;
    confirm?: string;
    role?: UserRole;
    companyName?: string;
  }): Promise<AuthPayload> {
    return request('/api/auth/register', { method: 'POST', body: input });
  },

  login(input: { identifier: string; password: string }): Promise<AuthPayload> {
    return request('/api/auth/login', { method: 'POST', body: input });
  },

  logout(token: string): Promise<{ ok: true }> {
    return request('/api/auth/logout', { method: 'POST', token });
  },

  me(token: string): Promise<{ ok: true; user: ApiUser }> {
    return request('/api/auth/me', { token });
  },

  dashboard(token: string): Promise<DashboardPayload> {
    return request('/api/dashboard', { token });
  },

  shipments(token: string): Promise<{ ok: true; shipments: ApiShipment[] }> {
    return request('/api/shipments', { token });
  },

  shipment(
    token: string,
    id: string,
  ): Promise<{ ok: true; shipment: ApiShipment }> {
    return request(`/api/shipments/${encodeURIComponent(id)}`, { token });
  },

  createShipment(
    token: string,
    input: { origin: string; destination: string; notes?: string },
  ): Promise<{ ok: true; shipment: ApiShipment }> {
    return request('/api/shipments', { method: 'POST', body: input, token });
  },

  // --- Marketplace: trucks (SRS §14) -------------------------------------
  trucks(token: string): Promise<{ ok: true; trucks: ApiTruck[] }> {
    return request('/api/trucks', { token });
  },

  createTruck(
    token: string,
    input: {
      registrationNumber: string;
      truckType: string;
      capacityTons: number;
      currentLocation: string;
      availabilityDate: string;
    },
  ): Promise<{ ok: true; truck: ApiTruck }> {
    return request('/api/trucks', { method: 'POST', body: input, token });
  },

  updateTruck(
    token: string,
    id: string,
    input: { status?: TruckStatus; currentLocation?: string; availabilityDate?: string },
  ): Promise<{ ok: true; truck: ApiTruck }> {
    return request(`/api/trucks/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: input,
      token,
    });
  },

  // --- Marketplace: cargo (SRS §16–§17) ----------------------------------
  cargo(token: string): Promise<{ ok: true; cargo: ApiCargo[] }> {
    return request('/api/cargo', { token });
  },

  createCargo(
    token: string,
    input: {
      cargoType: string;
      description?: string;
      weightTons: number;
      pickupLocation: string;
      destination: string;
      pickupDate: string;
      preferredTruckType?: string;
      budget?: number;
      specialRequirements?: string;
    },
  ): Promise<{ ok: true; cargo: ApiCargo }> {
    return request('/api/cargo', { method: 'POST', body: input, token });
  },

  updateCargo(
    token: string,
    id: string,
    input: { status?: CargoStatus; pickupDate?: string; budget?: number | null },
  ): Promise<{ ok: true; cargo: ApiCargo }> {
    return request(`/api/cargo/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: input,
      token,
    });
  },

  // --- Marketplace: matching (SRS §18–§22) -------------------------------
  matches(token: string): Promise<{ ok: true; role: UserRole; matches: ApiMatch[] }> {
    return request('/api/matches', { token });
  },

  matchesForCargo(
    token: string,
    id: string,
  ): Promise<{ ok: true; cargo: ApiCargo; matches: ApiMatch[] }> {
    return request(`/api/matches/cargo/${encodeURIComponent(id)}`, { token });
  },

  matchesForTruck(
    token: string,
    id: string,
  ): Promise<{ ok: true; truck: ApiTruck; matches: ApiMatch[] }> {
    return request(`/api/matches/truck/${encodeURIComponent(id)}`, { token });
  },

  /** Reserve a truck for a load (or a load for a truck). */
  acceptMatch(
    token: string,
    input: { truckId: string; cargoId: string },
  ): Promise<{ ok: true; truck: ApiTruck; cargo: ApiCargo }> {
    return request('/api/matches/accept', { method: 'POST', body: input, token });
  },
};
