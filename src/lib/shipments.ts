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

/**
 * `booked` means the order was received and confirmed but not picked up yet,
 * so the UI shows it as "Confirmed". The API / database value stays `booked`
 * so the lifecycle stays: Confirmed → In transit → Delivered.
 */
export const SHIPMENT_STATUS_LABEL: Record<ShipmentStatus, string> = {
  booked: 'Confirmed',
  in_transit: 'In transit',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

/** 'in_transit' → 'In transit'; 'booked' → 'Confirmed'. */
export function shipmentStatusLabel(status: ShipmentStatus): string {
  return (
    SHIPMENT_STATUS_LABEL[status] ??
    status.replace(/_/g, ' ').replace(/^./, (letter) => letter.toUpperCase())
  );
}

/** Epoch ms → 'YYYY-MM-DD'. Returns '' when the backend has no date. */
export function isoDate(timestamp: number | null | undefined): string {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Epoch ms → '7 Oct 2026'. Returns '' when the backend has no timestamp. */
export function formatShipmentDate(timestamp: number | null | undefined): string {
  if (!timestamp) return '';
  return new Date(timestamp).toLocaleDateString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

/** 12 → '12 t'. Returns '' when the weight is missing. */
export function formatShipmentWeight(tons: number | null | undefined): string {
  if (tons === null || tons === undefined) return '';
  return `${Math.round(tons * 10) / 10} t`;
}
