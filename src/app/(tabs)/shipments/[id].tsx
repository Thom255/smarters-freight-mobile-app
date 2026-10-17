import { useLocalSearchParams } from 'expo-router';
import { type ComponentProps, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { ShipmentForm } from '@/components/shipment-form';
import { ShipmentTimeline } from '@/components/shipment-timeline';
import { Badge, Button, Card, FadeInView, Header, Icon, Screen } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useShipment, useUpdateShipment } from '@/hooks/use-shipments';
import { useTheme } from '@/hooks/use-theme';
import type { ApiShipment, ApiShipmentEvent, ShipmentStatusUpdate } from '@/lib/api';
import { shipmentFormToUpdateInput } from '@/lib/shipment-form';
import {
  formatShipmentDate,
  formatShipmentWeight,
  shipmentStatusLabel,
  SHIPMENT_STATUS_TONE,
} from '@/lib/shipments';

/** Epoch ms → '7 Oct 2026, 14:03' for timeline entries. */
function formatEventTime(timestamp: number | null): string {
  if (!timestamp) return '';
  return new Date(timestamp).toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function ShipmentDetailScreen() {
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { shipment, loading, error, reload } = useShipment(id);
  const { updateShipment, saving } = useUpdateShipment();
  const [editing, setEditing] = useState(false);

  const editable = shipment?.status === 'booked' || shipment?.status === 'in_transit';

  /** Confirm → PATCH → re-fetch so the recorded event shows up immediately. */
  const requestStatus = (
    next: ShipmentStatusUpdate,
    title: string,
    message: string,
    destructive = false,
  ) => {
    if (!shipment || saving) return;

    Alert.alert(title, message, [
      { text: 'Keep as is', style: 'cancel' },
      {
        text: destructive ? 'Cancel shipment' : 'Confirm',
        style: destructive ? 'destructive' : 'default',
        onPress: () => {
          void (async () => {
            const result = await updateShipment(shipment.id, { status: next });
            if (!result.ok) {
              Alert.alert('Could not update', result.message);
              return;
            }

            Alert.alert(
              'Shipment updated',
              `${shipment.reference} is now ${shipmentStatusLabel(next)}.`,
            );
            void reload();
          })();
        },
      },
    ]);
  };

  return (
    <Screen scroll contentStyle={styles.content}>
      <Header
        title="Shipment"
        subtitle={shipment?.reference}
        action={
          editable ? (
            <Button
              variant="outline"
              size="sm"
              fullWidth={false}
              onPress={() => setEditing(true)}
              iconLeft={<Icon name="edit" size={16} color={theme.primary} />}>
              Edit
            </Button>
          ) : null
        }
      />

      <View style={styles.body}>
        {error && !shipment ? (
          <Card>
            <View style={styles.emptyState}>
              <View style={[styles.emptyIcon, { backgroundColor: theme.dangerSubtle }]}>
                <Icon name="alert" size={26} color={theme.danger} />
              </View>
              <Text style={[theme.typography.subheading, { color: theme.text }]}>
                Couldn&apos;t load this shipment
              </Text>
              <Text
                style={[
                  theme.typography.caption,
                  styles.emptyText,
                  { color: theme.textSecondary },
                ]}>
                {error}
              </Text>
              <Button fullWidth={false} onPress={() => void reload()}>
                Try again
              </Button>
            </View>
          </Card>
        ) : loading && !shipment ? (
          <Card>
            <View style={styles.emptyState}>
              <ActivityIndicator color={theme.primary} />
            </View>
          </Card>
        ) : shipment ? (
          <>
            <FadeInView>
              <Card>
                <View style={styles.heroRow}>
                  <View
                    style={[styles.routeIcon, { backgroundColor: theme.primarySubtle }]}>
                    <Icon name="truck" size={24} color={theme.primary} />
                  </View>
                  <View style={styles.heroCopy}>
                    <Text
                      style={[theme.typography.subheading, { color: theme.text }]}
                      numberOfLines={1}>
                      {shipment.origin} → {shipment.destination}
                    </Text>
                    <Text
                      style={[theme.typography.caption, { color: theme.textSecondary }]}>
                      {shipment.reference}
                      {formatShipmentDate(shipment.createdAt)
                        ? ` · ${formatShipmentDate(shipment.createdAt)}`
                        : ''}
                    </Text>
                  </View>
                  <Badge tone={SHIPMENT_STATUS_TONE[shipment.status] ?? 'neutral'} dot>
                    {shipmentStatusLabel(shipment.status)}
                  </Badge>
                </View>
              </Card>
            </FadeInView>

            <FadeInView index={1}>
              <Card>
                <Text style={[theme.typography.overline, { color: theme.textSecondary }]}>
                  PROGRESS
                </Text>
                <View style={styles.timelineWrap}>
                  <ShipmentTimeline status={shipment.status} />
                </View>
                <Text
                  style={[theme.typography.caption, styles.trackingNote, { color: theme.textSecondary }]}>
                  Status-based tracking — updated by the people handling this shipment,
                  not live GPS.
                </Text>
              </Card>
            </FadeInView>

            <FadeInView index={2}>
              {shipment.status === 'booked' || shipment.status === 'in_transit' ? (
                <Card>
                  <Text style={[theme.typography.overline, { color: theme.textSecondary }]}>
                    NEXT STEP
                  </Text>
                  <View style={styles.actions}>
                    <Button
                      size="lg"
                      loading={saving}
                      onPress={() =>
                        requestStatus(
                          shipment.status === 'booked' ? 'in_transit' : 'delivered',
                          shipment.status === 'booked'
                            ? 'Mark as in transit?'
                            : 'Mark as delivered?',
                          shipment.status === 'booked'
                            ? `Confirm the load has left ${shipment.origin}.`
                            : `Confirm ${shipment.reference} arrived at ${shipment.destination}.`,
                        )
                      }
                      iconLeft={<Icon name="check" size={18} color={theme.onPrimary} />}>
                      {shipment.status === 'booked' ? 'Mark in transit' : 'Mark delivered'}
                    </Button>

                    <Button
                      variant="outline"
                      size="lg"
                      disabled={saving}
                      onPress={() => setEditing(true)}
                      iconLeft={<Icon name="edit" size={18} color={theme.primary} />}>
                      Edit details
                    </Button>

                    <Button
                      variant="outline"
                      size="lg"
                      disabled={saving}
                      onPress={() =>
                        requestStatus(
                          'cancelled',
                          'Cancel this shipment?',
                          `${shipment.reference} will be closed and cannot be resumed.`,
                          true,
                        )
                      }
                      iconLeft={<Icon name="error" size={18} color={theme.danger} />}>
                      Cancel shipment
                    </Button>
                  </View>
                </Card>
              ) : (
                <Card>
                  <View style={styles.closedRow}>
                    <Icon
                      name={shipment.status === 'delivered' ? 'checkSeal' : 'info'}
                      size={20}
                      color={theme.textSecondary}
                    />
                    <Text style={[theme.typography.caption, { color: theme.textSecondary }]}>
                      This shipment is {shipmentStatusLabel(shipment.status).toLowerCase()} — its
                      status can no longer change.
                    </Text>
                  </View>
                </Card>
              )}
            </FadeInView>

            <FadeInView index={3}>
              <Card>
                <Text style={[theme.typography.overline, { color: theme.textSecondary }]}>
                  CARGO
                </Text>
                <View style={styles.detailList}>
                  <InfoRow label="Type" value={shipment.cargoType} />
                  <InfoRow
                    label="Weight"
                    value={formatShipmentWeight(shipment.weightTons) || null}
                  />
                  <InfoRow label="Dimensions" value={shipment.dimensions} />
                  <InfoRow label="Description" value={shipment.cargoDescription} last />
                </View>
              </Card>
            </FadeInView>

            <FadeInView index={4}>
              <Card>
                <Text style={[theme.typography.overline, { color: theme.textSecondary }]}>
                  SCHEDULE
                </Text>
                <View style={styles.detailList}>
                  <InfoRow label="Pickup date" value={formatShipmentDate(shipment.pickupDate)} />
                  <InfoRow
                    label="Delivery deadline"
                    value={formatShipmentDate(shipment.deliveryDeadline)}
                  />
                  <InfoRow label="Booking reference" value={shipment.bookingReference} last />
                </View>
              </Card>
            </FadeInView>

            {shipment.assignedTruck ? (
              <FadeInView index={5}>
                <Card>
                  <Text style={[theme.typography.overline, { color: theme.textSecondary }]}>
                    ASSIGNED TRUCK
                  </Text>
                  <View style={styles.detailList}>
                    <InfoRow
                      label="Registration"
                      value={shipment.assignedTruck.registrationNumber}
                    />
                    <InfoRow label="Type" value={shipment.assignedTruck.truckType} />
                    <InfoRow
                      label="Location"
                      value={shipment.assignedTruck.currentLocation}
                      last
                    />
                  </View>
                </Card>
              </FadeInView>
            ) : null}

            <FadeInView index={6}>
              <Card>
                <Text style={[theme.typography.overline, { color: theme.textSecondary }]}>
                  HISTORY
                </Text>
                <View style={styles.timelineWrap}>
                  {(shipment.events ?? []).length === 0 ? (
                    <Text style={[theme.typography.caption, { color: theme.textSecondary }]}>
                      No status changes recorded yet.
                    </Text>
                  ) : (
                    (shipment.events ?? []).map((event, index, list) => (
                      <EventRow
                        key={event.id}
                        event={event}
                        last={index === list.length - 1}
                      />
                    ))
                  )}
                </View>
              </Card>
            </FadeInView>

            <FadeInView index={7}>
              <Card>
                <Text style={[theme.typography.overline, { color: theme.textSecondary }]}>
                  ROUTE
                </Text>
                <View style={styles.legRow}>
                  <View style={[styles.legDot, { backgroundColor: theme.primary }]} />
                  <View style={styles.legCopy}>
                    <Text style={[theme.typography.caption, { color: theme.textSecondary }]}>
                      Pickup
                    </Text>
                    <Text style={[theme.typography.bodyMedium, { color: theme.text }]}>
                      {shipment.origin}
                    </Text>
                  </View>
                </View>
                <View style={styles.legRow}>
                  <View
                    style={[styles.legDot, { backgroundColor: theme.accent, marginLeft: 5 }]}
                  />
                  <View style={styles.legCopy}>
                    <Text style={[theme.typography.caption, { color: theme.textSecondary }]}>
                      Destination
                    </Text>
                    <Text style={[theme.typography.bodyMedium, { color: theme.text }]}>
                      {shipment.destination}
                    </Text>
                  </View>
                </View>
              </Card>
            </FadeInView>

            <FadeInView index={8}>
              <Card>
                <Text style={[theme.typography.overline, { color: theme.textSecondary }]}>
                  NOTES
                </Text>
                <Text style={[theme.typography.body, { color: theme.text }]}>
                  {shipment.notes?.trim()
                    ? shipment.notes
                    : 'No notes were added to this shipment.'}
                </Text>
              </Card>
            </FadeInView>
          </>
        ) : null}
      </View>

      {shipment ? (
        <EditShipmentModal
          visible={editing}
          shipment={shipment}
          saving={saving}
          onClose={() => setEditing(false)}
          onSubmit={async (values) => {
            const result = await updateShipment(shipment.id, shipmentFormToUpdateInput(values));
            if (!result.ok) {
              return { ok: false, field: result.field, message: result.message };
            }

            setEditing(false);
            void reload();
            return { ok: true, shipment: result.shipment };
          }}
        />
      ) : null}
    </Screen>
  );
}

/** `label: value` pair used by the cargo / schedule / truck cards. */
function InfoRow({
  label,
  value,
  last = false,
}: {
  label: string;
  value: string | null | undefined;
  last?: boolean;
}) {
  const theme = useTheme();
  const display = value && value.trim() !== '' ? value : '—';

  return (
    <View
      style={[
        styles.infoRow,
        !last && { borderBottomColor: theme.divider, borderBottomWidth: StyleSheet.hairlineWidth },
      ]}>
      <Text style={[theme.typography.caption, { color: theme.textSecondary }]}>{label}</Text>
      <Text
        style={[
          theme.typography.bodyMedium,
          styles.infoValue,
          { color: display === '—' ? theme.textSecondary : theme.text },
        ]}
        numberOfLines={3}>
        {display}
      </Text>
    </View>
  );
}

/** Modal sheet wrapping the shared form for editing an active shipment. */
function EditShipmentModal({
  visible,
  shipment,
  saving,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  shipment: ApiShipment;
  saving: boolean;
  onClose: () => void;
  onSubmit: ComponentProps<typeof ShipmentForm>['onSubmit'];
}) {
  const theme = useTheme();

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.modalBackdrop}>
        <View style={[styles.modalSheet, { backgroundColor: theme.backgroundElement }]}>
          <View style={styles.modalHeader}>
            <Text style={[theme.typography.heading, { color: theme.text }]}>Edit shipment</Text>
            <Pressable
              onPress={onClose}
              hitSlop={Spacing.two}
              accessibilityRole="button"
              accessibilityLabel="Close">
              <Icon name="plus" size={22} color={theme.textSecondary} style={styles.modalCloseIcon} />
            </Pressable>
          </View>

          <ScrollView
            style={styles.modalScroll}
            contentContainerStyle={styles.modalFields}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}>
            <ShipmentForm
              key={`${shipment.id}-${visible ? 'open' : 'closed'}`}
              initial={shipment}
              submitLabel="Save changes"
              cancelLabel="Cancel"
              submitting={saving}
              onSubmit={onSubmit}
              onCancel={onClose}
            />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

/** One recorded status change: dot + title + who/when. */
function EventRow({ event, last }: { event: ApiShipmentEvent; last: boolean }) {
  const theme = useTheme();
  const meta = [event.actor, formatEventTime(event.createdAt)].filter(Boolean).join(' · ');

  return (
    <View style={styles.eventRow}>
      <View style={styles.eventRail}>
        <View style={[styles.eventDot, { backgroundColor: theme.primary }]} />
        {!last ? <View style={[styles.eventLine, { backgroundColor: theme.border }]} /> : null}
      </View>

      <View style={styles.eventCopy}>
        <Text style={[theme.typography.bodyMedium, { color: theme.text }]}>{event.title}</Text>
        {event.body ? (
          <Text style={[theme.typography.caption, { color: theme.textSecondary }]}>
            {event.body}
          </Text>
        ) : null}
        {meta ? (
          <Text style={[theme.typography.caption, { color: theme.textSecondary }]}>{meta}</Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: Spacing.four,
  },
  actions: {
    marginTop: Spacing.two,
    gap: Spacing.two,
  },
  closedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  detailList: {
    marginTop: Spacing.two,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: Spacing.three,
    paddingVertical: Spacing.two,
  },
  infoValue: {
    flex: 1,
    textAlign: 'right',
  },
  trackingNote: {
    marginTop: Spacing.two,
  },
  eventRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  eventRail: {
    width: 12,
    alignItems: 'center',
  },
  eventDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginTop: 5,
  },
  eventLine: {
    width: 2,
    flex: 1,
    minHeight: 20,
    marginVertical: 2,
    borderRadius: 1,
  },
  eventCopy: {
    flex: 1,
    gap: 2,
    paddingBottom: Spacing.three,
  },
  body: {
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
  },
  emptyState: {
    alignItems: 'center',
    gap: Spacing.two,
  },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.one,
  },
  emptyText: {
    textAlign: 'center',
    marginBottom: Spacing.two,
  },
  timelineWrap: {
    marginTop: Spacing.two,
  },
  heroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  routeIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroCopy: {
    flex: 1,
    gap: Spacing.half,
  },
  legRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    marginTop: Spacing.two,
  },
  legDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  legCopy: {
    flex: 1,
    gap: Spacing.half,
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  modalSheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '92%',
    paddingBottom: Spacing.four,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.two,
  },
  modalCloseIcon: {
    transform: [{ rotate: '45deg' }],
  },
  modalScroll: {
    paddingHorizontal: Spacing.three,
  },
  modalFields: {
    gap: Spacing.two,
    paddingBottom: Spacing.three,
  },
});
