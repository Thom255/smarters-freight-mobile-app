/**
 * Freight-marketplace presentation helpers shared by the trucks, cargo and
 * matches screens. Type-only imports keep this module free of React Native
 * runtime code.
 */

import type { BadgeTone } from '@/components/ui/badge';
import type { ApiCargo, ApiTruck, MatchCategory, UserRole } from '@/lib/api';

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

export const TRUCK_STATUSES: TruckStatus[] = [
  'available',
  'booked',
  'in_transit',
  'maintenance',
  'inactive',
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

/** Epoch ms → '7 Oct 2026'. Returns '' when the value is missing. */
export function formatDate(timestamp: number | null): string {
  if (!timestamp) return '';
  return new Date(timestamp).toLocaleDateString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}
