/**
 * Pure form helpers for the shared shipment create/edit form.
 *
 * Kept free of React Native imports so Node can run them in
 * scripts/auth-core.test.mjs alongside the other pure modules.
 */

import type { ApiShipment, ShipmentCreateInput, ShipmentUpdateInput } from '@/lib/api';
import { isoDate } from './shipments.ts';

export type ShipmentFormValues = {
  origin: string;
  destination: string;
  notes: string;
  /** '' means "not set" (the chips include a leading "Not set" option). */
  cargoType: string;
  cargoDescription: string;
  /** Raw text so the field stays controlled; '' means "not recorded". */
  weightTons: string;
  dimensions: string;
  /** 'YYYY-MM-DD' or ''. */
  pickupDate: string;
  /** 'YYYY-MM-DD' or ''. */
  deliveryDeadline: string;
  bookingReference: string;
  /** Truck id, or '' when nothing is assigned. */
  assignedTruckId: string;
};

export type ShipmentFormErrors = Partial<Record<keyof ShipmentFormValues, string>>;

export const EMPTY_SHIPMENT_FORM: ShipmentFormValues = {
  origin: '',
  destination: '',
  notes: '',
  cargoType: '',
  cargoDescription: '',
  weightTons: '',
  dimensions: '',
  pickupDate: '',
  deliveryDeadline: '',
  bookingReference: '',
  assignedTruckId: '',
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Prefills the edit form from a shipment the API just returned. */
export function shipmentFormFrom(shipment: ApiShipment): ShipmentFormValues {
  return {
    origin: shipment.origin ?? '',
    destination: shipment.destination ?? '',
    notes: shipment.notes ?? '',
    cargoType: shipment.cargoType ?? '',
    cargoDescription: shipment.cargoDescription ?? '',
    weightTons:
      shipment.weightTons === null || shipment.weightTons === undefined
        ? ''
        : String(shipment.weightTons),
    dimensions: shipment.dimensions ?? '',
    pickupDate: isoDate(shipment.pickupDate),
    deliveryDeadline: isoDate(shipment.deliveryDeadline),
    bookingReference: shipment.bookingReference ?? '',
    assignedTruckId: shipment.assignedTruckId ?? '',
  };
}

/**
 * Mirrors the backend's rules so the form can flag problems before the round
 * trip. Blank optional fields are simply skipped.
 */
export function validateShipmentForm(values: ShipmentFormValues): ShipmentFormErrors {
  const errors: ShipmentFormErrors = {};

  if (values.origin.trim().length < 2) {
    errors.origin = 'Enter the pickup location';
  }
  if (values.destination.trim().length < 2) {
    errors.destination = 'Enter the destination';
  }

  const weight = values.weightTons.trim();
  if (weight !== '') {
    const parsed = Number.parseFloat(weight);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      errors.weightTons = 'Enter a weight greater than zero';
    }
  }

  const pickup = values.pickupDate.trim();
  const deadline = values.deliveryDeadline.trim();

  if (pickup !== '' && !DATE_PATTERN.test(pickup)) {
    errors.pickupDate = 'Use the format YYYY-MM-DD';
  }
  if (deadline !== '' && !DATE_PATTERN.test(deadline)) {
    errors.deliveryDeadline = 'Use the format YYYY-MM-DD';
  }
  // 'YYYY-MM-DD' compares correctly as a plain string.
  if (!errors.pickupDate && !errors.deliveryDeadline && pickup && deadline && deadline < pickup) {
    errors.deliveryDeadline = 'Deadline must be on or after the pickup date';
  }

  return errors;
}

export function shipmentFormToCreateInput(values: ShipmentFormValues): ShipmentCreateInput {
  const weight = values.weightTons.trim();

  return {
    origin: values.origin.trim(),
    destination: values.destination.trim(),
    notes: values.notes.trim() || undefined,
    cargoType: values.cargoType.trim() || undefined,
    cargoDescription: values.cargoDescription.trim() || undefined,
    weightTons: weight === '' ? undefined : Number.parseFloat(weight),
    dimensions: values.dimensions.trim() || undefined,
    pickupDate: values.pickupDate.trim() || undefined,
    deliveryDeadline: values.deliveryDeadline.trim() || undefined,
    bookingReference: values.bookingReference.trim() || undefined,
    assignedTruckId: values.assignedTruckId.trim() || undefined,
  };
}

/**
 * Edits send the whole detail block, using null for "clear it", so the form
 * can be emptied as well as filled.
 */
export function shipmentFormToUpdateInput(values: ShipmentFormValues): ShipmentUpdateInput {
  const weight = values.weightTons.trim();

  return {
    origin: values.origin.trim(),
    destination: values.destination.trim(),
    notes: values.notes.trim() || null,
    cargoType: values.cargoType.trim() || null,
    cargoDescription: values.cargoDescription.trim() || null,
    weightTons: weight === '' ? null : Number.parseFloat(weight),
    dimensions: values.dimensions.trim() || null,
    pickupDate: values.pickupDate.trim() || null,
    deliveryDeadline: values.deliveryDeadline.trim() || null,
    bookingReference: values.bookingReference.trim() || null,
    assignedTruckId: values.assignedTruckId.trim() || null,
  };
}

export function hasShipmentFormErrors(errors: ShipmentFormErrors): boolean {
  return Object.keys(errors).length > 0;
}
