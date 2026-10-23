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
// Extension kept explicit so Node (scripts/*.test.mjs) can execute this
// module directly; Metro resolves it the same way (see shipment-form.ts).
import { normalizeRole, type UserRole } from './auth-core.ts';

const FALLBACK_BASE_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8001').replace(
  /\/+$/,
  '',
);

/**
 * Device-specific origin, set once at startup (src/app/_layout.tsx) when
 * EXPO_PUBLIC_API_URL is unset — it derives the right host for the current
 * runtime (10.0.2.2 from the Android emulator, the Metro host's LAN IP on a
 * physical phone, loopback on the same machine). When the env var IS set —
 * the normal case — the resolver returns null and this never kicks in.
 */
let runtimeOrigin: string | null = null;

/** Install the derived origin. Called once from the app root, before any request. */
export function configureApiOrigin(origin: string | null): void {
  if (origin) runtimeOrigin = origin.replace(/\/+$/, '');
}

function baseUrl(): string {
  return runtimeOrigin ?? FALLBACK_BASE_URL;
}

/** Error body the backend returns for any failure: { ok:false, field, message }. */
type ApiErrorShape = { ok?: false; field?: string; message?: string };

/**
 * What actually went wrong, so screens/devs can tell the three cases apart
 * without parsing message text:
 *   network — no HTTP response at all (unreachable host, refused, DNS)
 *   timeout — a request was sent but no response arrived in time
 *   http    — the server answered with a non-2xx status
 */
export type ApiErrorKind = 'network' | 'timeout' | 'http';

export class ApiError extends Error {
  /** HTTP status; 0 when no response was received (network/timeout). */
  readonly status: number;
  /** AuthField the error belongs to ('form' = not tied to one input). */
  readonly field: string;
  readonly kind: ApiErrorKind;

  constructor(message: string, status = 0, field = 'form', kind: ApiErrorKind = 'http') {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.field = field;
    this.kind = kind;
  }
}

const NETWORK_MESSAGE = 'Cannot reach the server. Check your connection and try again.';
const TIMEOUT_MESSAGE = 'The server took too long to respond. Please try again.';
const MALFORMED_MESSAGE = 'The server sent an unexpected response. Please try again.';

/**
 * Bounded backoff for transient *network* failures — connection refused,
 * DNS, unreachable host (typically the backend is still starting up or just
 * restarted). Deliberately NOT applied to timeouts (each attempt can already
 * hold for 20s, so retrying them would stall the screen for a minute) and
 * never to HTTP responses: a 401/403/404/5xx is answered by a live server
 * and repeating it would just multiply bad traffic — 401/403 must fail fast
 * so the session can be cleared.
 */
const TRANSIENT_RETRY_DELAYS_MS = [300, 900];

function isTransientNetworkFailure(error: unknown): error is ApiError {
  return error instanceof ApiError && error.kind === 'network';
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fallback text when the backend sent no usable `message`. The server's own
 * envelope message always wins when present — these only cover bare/proxy
 * responses so the user never sees a raw `Request failed (500)`.
 */
function defaultMessage(status: number): string {
  switch (status) {
    case 0:
      return NETWORK_MESSAGE;
    case 400:
    case 422:
      return 'Please check the details you entered and try again.';
    case 401:
      return 'Session expired. Please sign in again.';
    case 403:
      return 'You do not have permission to do that.';
    case 404:
      return 'We could not find that. It may have been removed — refresh and try again.';
    case 408:
      return TIMEOUT_MESSAGE;
    case 409:
      return 'This conflicts with the current state. Refresh and try again.';
    case 429:
      return 'Too many attempts. Wait a moment and try again.';
    default:
      return status >= 500
        ? 'Something went wrong on the server. Please try again shortly.'
        : `Request failed (${status})`;
  }
}

/**
 * Ceiling on a single request. The backend spends at most ~10s waiting on
 * Supabase, and PHP's own limit is 30s — without a client-side deadline a
 * stalled connection leaves the caller spinning forever with no error.
 */
const REQUEST_TIMEOUT_MS = 20_000;

/**
 * Central 401 handling.
 *
 * When a *token-bearing* request is rejected as unauthorized the saved session
 * is no longer usable (expired, revoked, or the account is gone). Rather than
 * make every data hook aware of auth state, the request layer notifies
 * subscribers — the AuthProvider clears the session and flips the app to
 * signed-out, which unmounts the protected routes. Login/register/forgot/
 * reset never carry a token, so a wrong-password 401 there does not fire it.
 */
type UnauthorizedHandler = () => void;
const unauthorizedHandlers = new Set<UnauthorizedHandler>();

/** Subscribe to "an authenticated request was rejected". Returns an unsubscribe. */
export function onUnauthorized(handler: UnauthorizedHandler): () => void {
  unauthorizedHandlers.add(handler);
  return () => unauthorizedHandlers.delete(handler);
}

function notifyUnauthorized(): void {
  unauthorizedHandlers.forEach((handler) => {
    try {
      handler();
    } catch {
      // A subscriber must never break the request that triggered it.
    }
  });
}

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  token?: string | null;
  /** Extra attempts after the first, only for transient network failures. */
  retries?: number;
};

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const retries = options.retries ?? 0;

  for (let attempt = 0; ; attempt++) {
    try {
      return await attemptRequest<T>(path, options);
    } catch (error) {
      if (!isTransientNetworkFailure(error) || attempt >= retries) {
        throw error;
      }
      await delay(TRANSIENT_RETRY_DELAYS_MS[Math.min(attempt, TRANSIENT_RETRY_DELAYS_MS.length - 1)]);
    }
  }
}

async function attemptRequest<T>(path: string, options: RequestOptions): Promise<T> {
  const { method = 'GET', body, token } = options;

  let response: Response;
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    response = await fetch(`${baseUrl()}${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch {
    // No response arrived: either our own deadline fired (aborted) or the
    // connection failed outright. Reported as two distinct, actionable cases
    // instead of one ambiguous "connection error".
    if (controller.signal.aborted) {
      throw new ApiError(TIMEOUT_MESSAGE, 0, 'form', 'timeout');
    }
    throw new ApiError(NETWORK_MESSAGE, 0, 'form', 'network');
  } finally {
    clearTimeout(deadline);
  }

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    // Empty or non-JSON body — handled below via status only.
  }

  if (!response.ok) {
    const shape = (payload ?? {}) as ApiErrorShape;
    // Server-provided message/field first (the { ok:false, field, message }
    // contract), status-specific wording only when the body is unusable.
    const message = shape.message ?? defaultMessage(response.status);
    const field = shape.field ?? 'form';

    // A rejected authenticated call means the stored session is dead — tell
    // the AuthProvider so it can clear it and return to the sign-in screen.
    if (response.status === 401 && token) {
      notifyUnauthorized();
    }

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
  /** Optional driver details the owner may add. */
  driverName: string | null;
  driverPhone: string | null;
  /** Quoting basis — price per ton carried. */
  ratePerTon: number | null;
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
  /** ISO-4217 code the budget/price is quoted in, e.g. 'TZS'. */
  currency: string;
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
  /** Estimated cost for the haul (rate × weight, else the load budget). */
  estimatedCost: number | null;
};

export type BookingStatus = 'pending' | 'accepted' | 'rejected' | 'cancelled';

/** The other side of a booking, resolved enough to display and call. */
export type ApiParty = {
  id: string;
  name: string | null;
  companyName: string | null;
};

export type ApiBooking = {
  id: string;
  status: BookingStatus;
  /** 'incoming' when the caller owns the truck, 'outgoing' when they own the load. */
  direction: 'incoming' | 'outgoing';
  price: number | null;
  currency: string;
  message: string | null;
  requestedAt: number | null;
  decidedAt: number | null;
  cargo: ApiCargo;
  truck: ApiTruck;
  requester: ApiParty;
  responder: ApiParty;
};

export type ApiShipmentEvent = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  createdAt: number | null;
  /** Display name of the user who made the change, when known. */
  actor: string | null;
};

export type ApiShipment = {
  id: string;
  reference: string;
  origin: string;
  destination: string;
  status: 'booked' | 'in_transit' | 'delivered' | 'cancelled';
  notes: string | null;
  createdAt: number | null;
  updatedAt?: number | null;
  /** Cargo + planning detail (present since the shipment-details migration). */
  cargoType?: string | null;
  cargoDescription?: string | null;
  /** Tons; null when not yet recorded. */
  weightTons?: number | null;
  /** Free text, e.g. "12 x 2.4 x 2.6 m". */
  dimensions?: string | null;
  /** Epoch ms of the planned pickup day. */
  pickupDate?: number | null;
  /** Epoch ms of the day the load is due. */
  deliveryDeadline?: number | null;
  bookingReference?: string | null;
  assignedTruckId?: string | null;
  /** Resolved truck summary — only on detail / create / update responses. */
  assignedTruck?: MatchedTruckSummary | null;
  /** Status history — populated by GET /api/shipments/{id}. */
  events?: ApiShipmentEvent[];
};

export type ShipmentStatusUpdate = 'in_transit' | 'delivered' | 'cancelled';

/** Body for POST /api/shipments. */
export type ShipmentCreateInput = {
  origin: string;
  destination: string;
  notes?: string;
  cargoType?: string;
  cargoDescription?: string;
  weightTons?: number;
  dimensions?: string;
  /** 'YYYY-MM-DD' */
  pickupDate?: string;
  /** 'YYYY-MM-DD' */
  deliveryDeadline?: string;
  bookingReference?: string;
  assignedTruckId?: string;
};

/**
 * Body for PATCH /api/shipments/{id}. `status` performs a lifecycle
 * transition; the remaining fields edit details (only while active).
 * Send `null` to clear an optional field.
 */
export type ShipmentUpdateInput = {
  status?: ShipmentStatusUpdate;
  notes?: string | null;
  origin?: string;
  destination?: string;
  cargoType?: string | null;
  cargoDescription?: string | null;
  weightTons?: number | null;
  dimensions?: string | null;
  pickupDate?: string | null;
  deliveryDeadline?: string | null;
  bookingReference?: string | null;
  assignedTruckId?: string | null;
};

export type ApiActivity = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  createdAt: number | null;
  reference: string | null;
};

/** Lifecycle breakdown of the caller's own shipments. */
export type DashboardShipmentStats = {
  shipments: number;
  booked: number;
  inTransit: number;
  delivered: number;
  cancelled: number;
  /** Legacy alias for `booked`. */
  orders: number;
};

/** The caller's own fleet, by status. All zero for cargo owners. */
export type DashboardFleet = {
  total: number;
  available: number;
  booked: number;
  inTransit: number;
  maintenance: number;
  inactive: number;
};

/** The caller's own loads, grouped. All zero for truck owners. */
export type DashboardLoads = {
  total: number;
  pending: number;
  confirmed: number;
  inTransit: number;
  completed: number;
  cancelled: number;
};

/** Alert tone — mirrors BadgeTone without importing the UI layer. */
export type DashboardAlertTone =
  | 'neutral'
  | 'primary'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info';

export type DashboardAlert = {
  id: string;
  tone: DashboardAlertTone;
  title: string;
  body: string | null;
};

export type DashboardDelivery = {
  id: string;
  reference: string | null;
  origin: string;
  destination: string;
  status: ApiShipment['status'];
  createdAt: number | null;
};

export type DashboardPayload = {
  ok: true;
  role: UserRole;
  stats: DashboardShipmentStats;
  marketplace: {
    trucks: number;
    availableTrucks: number;
    cargo: number;
    postedCargo: number;
    matches: number;
  };
  fleet: DashboardFleet;
  loads: DashboardLoads;
  bookings: { active: number };
  activeShipment: Omit<ApiShipment, 'notes'> | null;
  upcomingDeliveries: DashboardDelivery[];
  recentActivity: ApiActivity[];
  alerts: DashboardAlert[];
};

function asObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * Validates and degrades a GET /api/dashboard body into a renderable payload.
 *
 * A 2xx that is not this endpoint's `{ ok:true, ... }` envelope is a REAL
 * error (proxy page, HTML, truncated body) and is thrown as such — never
 * silently rendered as an empty dashboard. But when the envelope is correct
 * and individual sections are missing/unshaped (partial response, older
 * backend), only those sections fall back to zeroed/empty values so one bad
 * group cannot blank the whole screen.
 */
export function normalizeDashboardPayload(raw: unknown): DashboardPayload {
  const root = asObject(raw);

  if (root.ok !== true) {
    throw new ApiError(MALFORMED_MESSAGE, 200, 'form', 'http');
  }

  const statsRaw = asObject(root.stats);
  const booked = asNumber(statsRaw.booked);
  const marketplaceRaw = asObject(root.marketplace);
  const fleetRaw = asObject(root.fleet);
  const loadsRaw = asObject(root.loads);
  const bookingsRaw = asObject(root.bookings);
  const activeShipment = root.activeShipment;

  return {
    ok: true,
    role: typeof root.role === 'string' ? normalizeRole(root.role) : 'cargo_owner',
    stats: {
      shipments: asNumber(statsRaw.shipments),
      booked,
      inTransit: asNumber(statsRaw.inTransit),
      delivered: asNumber(statsRaw.delivered),
      cancelled: asNumber(statsRaw.cancelled),
      orders: 'orders' in statsRaw ? asNumber(statsRaw.orders) : booked,
    },
    marketplace: {
      trucks: asNumber(marketplaceRaw.trucks),
      availableTrucks: asNumber(marketplaceRaw.availableTrucks),
      cargo: asNumber(marketplaceRaw.cargo),
      postedCargo: asNumber(marketplaceRaw.postedCargo),
      matches: asNumber(marketplaceRaw.matches),
    },
    fleet: {
      total: asNumber(fleetRaw.total),
      available: asNumber(fleetRaw.available),
      booked: asNumber(fleetRaw.booked),
      inTransit: asNumber(fleetRaw.inTransit),
      maintenance: asNumber(fleetRaw.maintenance),
      inactive: asNumber(fleetRaw.inactive),
    },
    loads: {
      total: asNumber(loadsRaw.total),
      pending: asNumber(loadsRaw.pending),
      confirmed: asNumber(loadsRaw.confirmed),
      inTransit: asNumber(loadsRaw.inTransit),
      completed: asNumber(loadsRaw.completed),
      cancelled: asNumber(loadsRaw.cancelled),
    },
    bookings: { active: asNumber(bookingsRaw.active) },
    activeShipment:
      activeShipment !== null &&
      typeof activeShipment === 'object' &&
      !Array.isArray(activeShipment)
        ? (activeShipment as DashboardPayload['activeShipment'])
        : null,
    upcomingDeliveries: asArray(root.upcomingDeliveries) as DashboardPayload['upcomingDeliveries'],
    recentActivity: asArray(root.recentActivity) as DashboardPayload['recentActivity'],
    alerts: asArray(root.alerts) as DashboardPayload['alerts'],
  };
}

/** Commission ledger statuses (backend `commissions.status`). */
export type CommissionStatus =
  | 'pending'
  | 'earned'
  | 'paid'
  | 'cancelled'
  | 'refunded';

/** The load a commission belongs to (traceability on the admin screen). */
export type ApiCommissionCargo = {
  id: string;
  reference: string;
  cargoType: string;
  status: ApiCargo['status'];
  pickupLocation: string;
  destination: string;
};

/** One row of the 8% platform commission ledger. */
export type ApiCommission = {
  id: string;
  cargoId: string;
  bookingId: string | null;
  /** Agreed transportation price the split is derived from. */
  cargoPrice: number;
  commissionRate: number;
  commissionAmount: number;
  providerNetAmount: number;
  currency: string;
  status: CommissionStatus;
  /** Settlement evidence — never set by the app, only read from the server. */
  paymentReference: string | null;
  refundReason: string | null;
  earnedAt: number | null;
  paidAt: number | null;
  cancelledAt: number | null;
  refundedAt: number | null;
  createdAt: number | null;
  cargo: ApiCommissionCargo | null;
  booking: { id: string; status: BookingStatus; price: number | null; currency: string } | null;
};

/**
 * GET /api/admin/revenue — admin only. Every total is computed server-side
 * from ledger rows whose statuses are mutually exclusive, so no amount is
 * ever counted twice; `paidCommission` moves only when settlement evidence is
 * recorded against it.
 */
export type RevenuePayload = {
  ok: true;
  commissionRate: number;
  currency: string;
  totals: {
    /** Agreed prices of loads with a live commission (not cancelled/refunded). */
    cargoValue: number;
    pendingCommission: number;
    earnedCommission: number;
    paidCommission: number;
    cancelledCommission: number;
    refundedCommission: number;
    /** pending + earned + paid — what the platform still holds. */
    liveCommission: number;
    completedShipments: number;
  };
  counts: Record<CommissionStatus | 'total', number>;
  commissions: ApiCommission[];
};

export type AdminAccountStatus = 'active' | 'suspended';

export type AdminOwner = { id: string; name: string | null; companyName: string | null };

export type AdminUser = {
  id: string;
  identifier: string;
  name: string | null;
  role: UserRole;
  companyName: string | null;
  status: AdminAccountStatus;
  createdAt: number | null;
};

export type AdminOverviewCounts = { total: number; byStatus: Record<string, number> };

export type AdminOverviewPayload = {
  ok: true;
  users: {
    total: number;
    admins: number;
    cargoOwners: number;
    truckOwners: number;
    active: number;
    suspended: number;
  };
  cargo: AdminOverviewCounts;
  trucks: AdminOverviewCounts;
  bookings: AdminOverviewCounts;
  shipments: AdminOverviewCounts;
  revenue: {
    liveCommission: number;
    paidCommission: number;
    totalRecords: number;
  };
};

export type AdminUserListPayload = { ok: true; users: AdminUser[] };

export type AdminCargoRecord = ApiCargo & { owner: AdminOwner | null };

export type AdminTruckRecord = ApiTruck & { owner: AdminOwner | null };

export type AdminBookingRecord = ApiBooking;

export type AdminShipmentRecord = {
  id: string;
  reference: string;
  origin: string;
  destination: string;
  status: ApiShipment['status'];
  notes: string | null;
  cargoType: string | null;
  weightTons: number | null;
  pickupDate: number | null;
  createdAt: number | null;
  owner: AdminOwner | null;
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

  /** Starts the reset flow. Always resolves with a neutral confirmation. */
  forgotPassword(input: { identifier: string }): Promise<{ ok: true; message: string }> {
    return request('/api/auth/forgot-password', { method: 'POST', body: input });
  },

  /** Completes the reset flow with the one-time token from the email link. */
  resetPassword(input: {
    identifier: string;
    token: string;
    password: string;
    confirm?: string;
  }): Promise<{ ok: true; message: string }> {
    return request('/api/auth/reset-password', { method: 'POST', body: input });
  },

  logout(token: string): Promise<{ ok: true }> {
    return request('/api/auth/logout', { method: 'POST', token });
  },

  me(token: string): Promise<{ ok: true; user: ApiUser }> {
    return request('/api/auth/me', { token });
  },

  dashboard(token: string): Promise<DashboardPayload> {
    // Two bounded retries cover the backend-not-yet-listening window; every
    // payload goes through normalizeDashboardPayload so a partial body
    // degrades per section instead of blanking the screen.
    return request('/api/dashboard', { token, retries: 2 }).then(
      normalizeDashboardPayload,
    );
  },

  /** Admin only — 8% commission totals, counts and ledger records. */
  adminRevenue(token: string): Promise<RevenuePayload> {
    return request('/api/admin/revenue', { token, retries: 2 });
  },

  // --- Admin console (SRS §2/§9) -------------------------------------------
  adminOverview(token: string): Promise<AdminOverviewPayload> {
    return request('/api/admin/overview', { token, retries: 2 });
  },

  adminUsers(token: string): Promise<AdminUserListPayload> {
    return request('/api/admin/users', { token });
  },

  updateAdminUser(
    token: string,
    id: string,
    input: { role?: UserRole; status?: AdminAccountStatus },
  ): Promise<{ ok: true; user: AdminUser }> {
    return request(`/api/admin/users/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: input,
      token,
    });
  },

  adminCargoList(token: string): Promise<{ ok: true; cargo: AdminCargoRecord[] }> {
    return request('/api/admin/cargo', { token });
  },

  adminTrucksList(token: string): Promise<{ ok: true; trucks: AdminTruckRecord[] }> {
    return request('/api/admin/trucks', { token });
  },

  adminBookingsList(token: string): Promise<{ ok: true; bookings: AdminBookingRecord[] }> {
    return request('/api/admin/bookings', { token });
  },

  adminShipmentsList(token: string): Promise<{ ok: true; shipments: AdminShipmentRecord[] }> {
    return request('/api/admin/shipments', { token });
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
    input: ShipmentCreateInput,
  ): Promise<{ ok: true; shipment: ApiShipment }> {
    return request('/api/shipments', { method: 'POST', body: input, token });
  },

  /**
   * Move a shipment along its lifecycle (booked → in transit → delivered), or
   * edit its details while it is still active.
   */
  updateShipment(
    token: string,
    id: string,
    input: ShipmentUpdateInput,
  ): Promise<{ ok: true; shipment: ApiShipment; event?: ApiShipmentEvent }> {
    return request(`/api/shipments/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: input,
      token,
    });
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
      driverName?: string;
      driverPhone?: string;
      ratePerTon?: number;
    },
  ): Promise<{ ok: true; truck: ApiTruck }> {
    return request('/api/trucks', { method: 'POST', body: input, token });
  },

  updateTruck(
    token: string,
    id: string,
    input: {
      status?: TruckStatus;
      currentLocation?: string;
      availabilityDate?: string;
      driverName?: string | null;
      driverPhone?: string | null;
      ratePerTon?: number | null;
    },
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
      currency?: string;
      specialRequirements?: string;
    },
  ): Promise<{ ok: true; cargo: ApiCargo }> {
    return request('/api/cargo', { method: 'POST', body: input, token });
  },

  updateCargo(
    token: string,
    id: string,
    input: { status?: CargoStatus; pickupDate?: string; budget?: number | null; currency?: string },
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

  // --- Marketplace: open browse (SRS §18–§22) ----------------------------
  /** Every truck currently listed as available, across all owners. */
  marketplaceTrucks(token: string): Promise<{ ok: true; trucks: ApiTruck[] }> {
    return request('/api/marketplace/trucks', { token });
  },

  marketplaceTruck(token: string, id: string): Promise<{ ok: true; truck: ApiTruck }> {
    return request(`/api/marketplace/trucks/${encodeURIComponent(id)}`, { token });
  },

  /** Every load currently posted, across all owners. */
  marketplaceCargo(token: string): Promise<{ ok: true; cargo: ApiCargo[] }> {
    return request('/api/marketplace/cargo', { token });
  },

  marketplaceCargoItem(token: string, id: string): Promise<{ ok: true; cargo: ApiCargo }> {
    return request(`/api/marketplace/cargo/${encodeURIComponent(id)}`, { token });
  },

  // --- Bookings (SRS §18–§22) --------------------------------------------
  bookings(token: string): Promise<{ ok: true; bookings: ApiBooking[] }> {
    return request('/api/bookings', { token });
  },

  /** Ask the other party to reserve their truck/load for you. */
  requestBooking(
    token: string,
    input: { truckId: string; cargoId: string; price?: number; message?: string },
  ): Promise<{ ok: true; booking: ApiBooking; truck: ApiTruck; cargo: ApiCargo }> {
    return request('/api/bookings', { method: 'POST', body: input, token });
  },

  acceptBooking(
    token: string,
    id: string,
  ): Promise<{ ok: true; booking: ApiBooking; truck: ApiTruck; cargo: ApiCargo }> {
    return request(`/api/bookings/${encodeURIComponent(id)}/accept`, { method: 'POST', token });
  },

  rejectBooking(
    token: string,
    id: string,
  ): Promise<{ ok: true; booking: ApiBooking }> {
    return request(`/api/bookings/${encodeURIComponent(id)}/reject`, { method: 'POST', token });
  },

  cancelBooking(
    token: string,
    id: string,
  ): Promise<{ ok: true; booking: ApiBooking; truck: ApiTruck; cargo: ApiCargo }> {
    return request(`/api/bookings/${encodeURIComponent(id)}/cancel`, { method: 'POST', token });
  },
};
