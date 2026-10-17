/**
 * Freight-marketplace presentation helpers shared by the trucks, cargo and
 * matches screens. Type-only imports keep this module free of React Native
 * runtime code.
 */

import type { BadgeTone } from '@/components/ui/badge';
import type { ApiCargo, ApiTruck, BookingStatus, MatchCategory, UserRole } from '@/lib/api';

export type TruckStatus = ApiTruck['status'];
export type CargoStatus = ApiCargo['status'];

export const TRUCK_STATUS_TONE: Record<TruckStatus, BadgeTone> = {
  available: 'success',
  booked: 'info',
  in_transit: 'warning',
  maintenance: 'warning',
  inactive: 'neutral',
};

export const CARGO_STATUS_TONE: Record<CargoStatus, BadgeTone> = {
  posted: 'info',
  matched: 'primary',
  booked: 'primary',
  in_transit: 'warning',
  delivered: 'success',
  completed: 'success',
  cancelled: 'danger',
};

export const MATCH_CATEGORY_TONE: Record<MatchCategory, BadgeTone> = {
  excellent: 'success',
  good: 'info',
  possible: 'warning',
  poor: 'neutral',
};

export const BOOKING_STATUS_TONE: Record<BookingStatus, BadgeTone> = {
  pending: 'warning',
  accepted: 'success',
  rejected: 'neutral',
  cancelled: 'danger',
};

export const BOOKING_STATUSES: BookingStatus[] = [
  'pending',
  'accepted',
  'rejected',
  'cancelled',
];

export const TRUCK_STATUSES: TruckStatus[] = [
  'available',
  'booked',
  'in_transit',
  'maintenance',
  'inactive',
];

export const CARGO_STATUSES: CargoStatus[] = [
  'posted',
  'matched',
  'booked',
  'in_transit',
  'delivered',
  'completed',
  'cancelled',
];

/** The truck body types the SRS calls out most often. Free text is allowed. */
export const TRUCK_TYPES = [
  'Flatbed',
  'Box body',
  'Container',
  'Tanker',
  'Refrigerated',
  'Tipper',
  'Lowbed',
];

export const CARGO_TYPES = [
  'General cargo',
  'Agriculture',
  'Construction materials',
  'Containers',
  'Fuel',
  'Perishables',
  'Machinery',
];

/** Currencies the marketplace quotes prices in. Free text is allowed server-side. */
export const CURRENCIES = ['TZS', 'USD', 'KES', 'UGX', 'RWF'];

/** 'in_transit' → 'In transit' */
export function titleCaseStatus(status: string): string {
  const words = status.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function roleLabel(role: UserRole | null | undefined): string {
  switch (role) {
    case 'truck_owner':
      return 'Truck owner';
    case 'admin':
      return 'Administrator';
    case 'cargo_owner':
    default:
      return 'Cargo owner';
  }
}

/** 12 → '12 t', 12.5 → '12.5 t' */
export function formatTons(tons: number): string {
  const rounded = Math.round(tons * 10) / 10;
  return `${rounded} t`;
}

/**
 * Formats a money amount with its ISO code, e.g. 45000 + 'TZS' → 'TZS 45,000'.
 * Falls back to a plain number string for unknown currency codes.
 */
export function formatMoney(amount: number | null | undefined, currency = 'TZS'): string {
  if (amount === null || amount === undefined) return '';
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currency} ${Math.round(amount).toLocaleString()}`;
  }
}

/** Rate per ton → 'TZS 45,000 / t'. Empty when no rate is set. */
export function formatRate(rate: number | null | undefined, currency = 'TZS'): string {
  if (rate === null || rate === undefined) return '';
  return `${formatMoney(rate, currency)} / t`;
}

/**
 * Price for a haul: the truck rate × cargo weight when both are known, else
 * the load's own budget. Mirrors the backend's estimate so the request dialog
 * can pre-fill a sensible number.
 */
export function estimateCost(truck: ApiTruck, cargo: ApiCargo): number | null {
  if (truck.ratePerTon != null && cargo.weightTons > 0) {
    return Math.round(truck.ratePerTon * cargo.weightTons);
  }
  return cargo.budget ?? null;
}

/** The ISO code money for a truck↔cargo pair should be quoted in. */
export function pairCurrency(cargo: ApiCargo): string {
  return cargo.currency || 'TZS';
}

/** Epoch ms → '7 Oct 2026'. Returns '' when the value is missing. */
export function formatDate(timestamp: number | null): string {
  if (!timestamp) return '';
  return new Date(timestamp).toLocaleDateString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}
