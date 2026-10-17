import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Button, Input } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { ApiShipment, ApiTruck } from '@/lib/api';
import { CARGO_TYPES } from '@/lib/marketplace';
import {
  EMPTY_SHIPMENT_FORM,
  hasShipmentFormErrors,
  shipmentFormFrom,
  validateShipmentForm,
  type ShipmentFormErrors,
  type ShipmentFormValues,
} from '@/lib/shipment-form';

export type ShipmentFormResult =
  | { ok: true; shipment?: ApiShipment }
  | { ok: false; field: string; message: string };

type ShipmentFormProps = {
  /**
   * Prefill from an existing shipment (edit mode). Remount the form with a
   * `key` when switching shipments so the fields reset.
   */
  initial?: ApiShipment;
  submitLabel: string;
  cancelLabel?: string;
  submitting?: boolean;
  /** The caller's own trucks — powers the optional "assigned truck" picker. */
  trucks?: ApiTruck[] | null;
  onSubmit: (values: ShipmentFormValues) => Promise<ShipmentFormResult>;
  onCancel?: () => void;
};

const FORM_FIELDS = new Set(Object.keys(EMPTY_SHIPMENT_FORM));

/**
 * Shared create/edit form for shipments. Owns field state and validation so
 * the new-shipment screen and the detail screen's edit sheet behave the same.
 */
export function ShipmentForm({
  initial,
  submitLabel,
  cancelLabel = 'Cancel',
  submitting = false,
  trucks,
  onSubmit,
  onCancel,
}: ShipmentFormProps) {
  const theme = useTheme();
  const [values, setValues] = useState<ShipmentFormValues>(() =>
    initial ? shipmentFormFrom(initial) : EMPTY_SHIPMENT_FORM,
  );
  const [errors, setErrors] = useState<ShipmentFormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);

  const setField = <K extends keyof ShipmentFormValues>(field: K, value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  };

  const submit = async () => {
    if (submitting) return;

    const found = validateShipmentForm(values);
    setErrors(found);
    setFormError(null);
    if (hasShipmentFormErrors(found)) return;

    const result = await onSubmit(values);
    if (!result.ok) {
      if (FORM_FIELDS.has(result.field)) {
        setErrors({ [result.field]: result.message });
      } else {
        setFormError(result.message);
      }
    }
  };

  const truckOptions = trucks ?? [];

  return (
    <View style={styles.form}>
      <Input
        label="Pickup location"
        placeholder="Dar es Salaam, TZ"
        value={values.origin}
        onChangeText={(value) => setField('origin', value)}
        error={errors.origin}
        autoCapitalize="words"
        returnKeyType="next"
      />
      <Input
        label="Destination"
        placeholder="Nairobi, KE"
        value={values.destination}
        onChangeText={(value) => setField('destination', value)}
        error={errors.destination}
        autoCapitalize="words"
        returnKeyType="next"
      />

      <Input
        label="Pickup date (YYYY-MM-DD)"
        placeholder="2026-10-20"
        value={values.pickupDate}
        onChangeText={(value) => setField('pickupDate', value)}
        error={errors.pickupDate}
        autoCapitalize="none"
        returnKeyType="next"
      />
      <Input
        label="Delivery deadline (YYYY-MM-DD)"
        placeholder="2026-10-27"
        value={values.deliveryDeadline}
        onChangeText={(value) => setField('deliveryDeadline', value)}
        error={errors.deliveryDeadline}
        autoCapitalize="none"
        returnKeyType="next"
      />

      <View style={styles.field}>
        <Text style={[theme.typography.label, { color: theme.text }]}>Cargo type</Text>
        <View style={styles.chips}>
          {[{ value: '', label: 'Not set' }, ...CARGO_TYPES.map((type) => ({ value: type, label: type }))].map(
            (option) => {
              const selected = option.value === values.cargoType;
              return (
                <Pressable
                  key={option.value || 'none'}
                  onPress={() => setField('cargoType', option.value)}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  style={[
                    styles.chip,
                    { backgroundColor: selected ? theme.primary : theme.backgroundSelected },
                  ]}>
                  <Text
                    style={[
                      theme.typography.caption,
                      { color: selected ? theme.onPrimary : theme.text },
                    ]}>
                    {option.label}
                  </Text>
                </Pressable>
              );
            },
          )}
        </View>
      </View>

      <Input
        label="Weight (tons)"
        placeholder="12"
        value={values.weightTons}
        onChangeText={(value) => setField('weightTons', value)}
        error={errors.weightTons}
        keyboardType="decimal-pad"
        returnKeyType="next"
      />
      <Input
        label="Dimensions (optional)"
        placeholder="12 x 2.4 x 2.6 m"
        value={values.dimensions}
        onChangeText={(value) => setField('dimensions', value)}
        error={errors.dimensions}
        autoCapitalize="none"
        returnKeyType="next"
      />
      <Input
        label="Cargo description (optional)"
        placeholder="Cement bags on pallets…"
        value={values.cargoDescription}
        onChangeText={(value) => setField('cargoDescription', value)}
        error={errors.cargoDescription}
        multiline
      />

      <Input
        label="Booking reference (optional)"
        placeholder="BK-7781"
        value={values.bookingReference}
        onChangeText={(value) => setField('bookingReference', value)}
        error={errors.bookingReference}
        autoCapitalize="characters"
        returnKeyType="next"
      />

      {truckOptions.length > 0 ? (
        <View style={styles.field}>
          <Text style={[theme.typography.label, { color: theme.text }]}>Assigned truck</Text>
          <View style={styles.chips}>
            {[{ value: '', label: 'No truck' }, ...truckOptions.map((truck) => ({
              value: truck.id,
              label: `${truck.registrationNumber} · ${truck.truckType}`,
            }))].map((option) => {
              const selected = option.value === values.assignedTruckId;
              return (
                <Pressable
                  key={option.value || 'none'}
                  onPress={() => setField('assignedTruckId', option.value)}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  style={[
                    styles.chip,
                    { backgroundColor: selected ? theme.primary : theme.backgroundSelected },
                  ]}>
                  <Text
                    style={[
                      theme.typography.caption,
                      { color: selected ? theme.onPrimary : theme.text },
                    ]}>
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}

      <Input
        label="Notes (optional)"
        placeholder="Fragile, keep upright…"
        value={values.notes}
        onChangeText={(value) => setField('notes', value)}
        error={errors.notes}
        multiline
      />

      {formError ? (
        <Text style={[theme.typography.caption, { color: theme.danger }]}>{formError}</Text>
      ) : null}

      <View style={styles.actions}>
        <Button size="lg" loading={submitting} onPress={submit}>
          {submitLabel}
        </Button>
        {onCancel ? (
          <Button variant="ghost" onPress={onCancel} disabled={submitting}>
            {cancelLabel}
          </Button>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  form: {
    gap: Spacing.two,
  },
  field: {
    gap: Spacing.one,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.one,
  },
  chip: {
    borderRadius: 999,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  actions: {
    gap: Spacing.two,
    marginTop: Spacing.one,
  },
});
