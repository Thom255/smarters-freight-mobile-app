/**
 * Shared shipment presentation helpers used by the dashboard, list and
 * detail screens so status colours and labels never drift apart.
 *
 * Type-only imports keep this module free of React Native runtime code.
 */

import type { BadgeTone } from '@/components/ui/badge';
import type { ApiShipment } from '@/lib/api';

export type ShipmentStatus = ApiShipment['status'];

export const SHIPMENT_STATUS_TONE: Record<ShipmentStatus, BadgeTone> = {
  booked: 'info',
  in_transit: 'warning',
  delivered: 'success',
  cancelled: 'danger',
};

/** 'in_transit' → 'In transit' */
export function shipmentStatusLabel(status: ShipmentStatus): string {
  const words = status.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Epoch ms → '7 Oct 2026'. Returns '' when the backend has no timestamp. */
export function formatShipmentDate(timestamp: number | null): string {
  if (!timestamp) return '';
  return new Date(timestamp).toLocaleDateString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}
