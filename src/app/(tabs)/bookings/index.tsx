import { useCallback, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { Badge, Button, Card, FadeInView, Header, Icon, Screen, SkeletonList } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useBookingActions, useBookings } from '@/hooks/use-bookings';
import { useTheme } from '@/hooks/use-theme';
import type { ApiBooking } from '@/lib/api';
import {
  BOOKING_STATUS_TONE,
  formatDate,
  formatMoney,
  formatTons,
  titleCaseStatus,
} from '@/lib/marketplace';

export default function BookingsScreen() {
  const { bookings, loading, refreshing, error, reload } = useBookings();
  const { decide, submittingId } = useBookingActions();
  const theme = useTheme();
  const [actionError, setActionError] = useState<string | null>(null);

  const onDecide = useCallback(
    (booking: ApiBooking, action: 'accept' | 'reject' | 'cancel') => {
      const title =
        action === 'accept'
          ? 'Accept this booking?'
          : action === 'reject'
            ? 'Decline this request?'
            : 'Cancel this booking?';

      Alert.alert(title, undefined, [
        { text: 'No', style: 'cancel' },
        {
          text: action === 'accept' ? 'Accept' : action === 'reject' ? 'Decline' : 'Cancel booking',
          style: action === 'cancel' ? 'destructive' : 'default',
          onPress: () => {
            void (async () => {
              setActionError(null);
              const result = await decide(booking.id, action);
              if (result.ok) {
                await reload();
              } else {
                setActionError(result.message);
              }
            })();
          },
        },
      ]);
    },
    [decide, reload],
  );

  const list = bookings ?? [];

  return (
    <Screen
      scroll
      tabBar
      refreshing={refreshing}
      onRefresh={() => void reload()}
      contentStyle={styles.content}>
      <Header title="Bookings" back={false} subtitle={bookings ? `${list.length} total` : undefined} />

      {actionError ? (
        <Text style={[theme.typography.caption, styles.actionError, { color: theme.danger }]}>
          {actionError}
        </Text>
      ) : null}

      {loading && list.length === 0 ? (
        <SkeletonList count={3} />
      ) : error && list.length === 0 ? (
        <EmptyState
          icon="alert"
          title="Couldn't load bookings"
          body={error}
          actionLabel="Try again"
          onAction={() => void reload()}
        />
      ) : list.length === 0 ? (
        <EmptyState
          icon="swap"
          title="No bookings yet"
          body="Request a truck from the marketplace or accept a request to see it here."
        />
      ) : (
        list.map((booking, index) => (
          <FadeInView key={booking.id} index={index}>
            <BookingCard
              booking={booking}
              submitting={submittingId === booking.id}
              onDecide={onDecide}
            />
          </FadeInView>
        ))
      )}
    </Screen>
  );
}

function BookingCard({
  booking,
  submitting,
  onDecide,
}: {
  booking: ApiBooking;
  submitting: boolean;
  onDecide: (booking: ApiBooking, action: 'accept' | 'reject' | 'cancel') => void;
}) {
  const theme = useTheme();
  const incoming = booking.direction === 'incoming';
  const counterpart = incoming ? booking.requester : booking.responder;
  const counterpartName = counterpart.companyName || counterpart.name || 'Unknown party';
  const price = formatMoney(booking.price, booking.currency);
  const active = booking.status === 'pending' || booking.status === 'accepted';

  return (
    <Card>
      <View style={styles.topRow}>
        <View style={styles.routeCopy}>
          <Text style={[theme.typography.bodyMedium, { color: theme.text }]} numberOfLines={1}>
            {booking.cargo.pickupLocation} → {booking.cargo.destination}
          </Text>
          <Text
            style={[theme.typography.caption, { color: theme.textSecondary }]}
            numberOfLines={1}>
            {booking.truck.truckType} · {booking.truck.registrationNumber}
          </Text>
        </View>

        <View style={styles.badges}>
          <Badge tone={incoming ? 'primary' : 'info'}>{incoming ? 'Incoming' : 'Outgoing'}</Badge>
          <Badge tone={BOOKING_STATUS_TONE[booking.status]}>{titleCaseStatus(booking.status)}</Badge>
        </View>
      </View>

      <View style={[styles.metaRow, { borderTopColor: theme.divider }]}>
        <Meta icon="person" text={`${incoming ? 'From' : 'To'} ${counterpartName}`} />
        <Meta icon="box" text={`${booking.cargo.cargoType} · ${formatTons(booking.cargo.weightTons)}`} />
        <Meta icon="clock" text={formatDate(booking.requestedAt) || 'Just now'} />
        {price ? <Meta icon="card" text={price} /> : null}
      </View>

      {booking.message ? (
        <Text style={[theme.typography.caption, { color: theme.textSecondary, marginTop: Spacing.two }]}>
          “{booking.message}”
        </Text>
      ) : null}

      {active ? (
        <View style={styles.actions}>
          {incoming && booking.status === 'pending' ? (
            <>
              <Button
                size="sm"
                fullWidth={false}
                loading={submitting}
                disabled={submitting}
                onPress={() => onDecide(booking, 'accept')}
                iconLeft={<Icon name="check" size={16} color={theme.onPrimary} />}>
                Accept
              </Button>
              <Button
                size="sm"
                variant="outline"
                fullWidth={false}
                disabled={submitting}
                onPress={() => onDecide(booking, 'reject')}>
                Decline
              </Button>
            </>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            fullWidth={false}
            disabled={submitting}
            onPress={() => onDecide(booking, 'cancel')}>
            Cancel
          </Button>
        </View>
      ) : null}
    </Card>
  );
}

function Meta({ icon, text }: { icon: 'person' | 'box' | 'clock' | 'card'; text: string }) {
  const theme = useTheme();
  return (
    <View style={styles.metaItem}>
      <Icon name={icon} size={15} color={theme.textSecondary} />
      <Text style={[theme.typography.caption, { color: theme.textSecondary }]} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

function EmptyState({
  icon,
  title,
  body,
  actionLabel,
  onAction,
}: {
  icon: 'alert' | 'swap';
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const theme = useTheme();
  return (
    <Card>
      <View style={styles.empty}>
        <View style={[styles.emptyIcon, { backgroundColor: theme.primarySubtle }]}>
          <Icon name={icon} size={26} color={theme.primary} />
        </View>
        <Text style={[theme.typography.subheading, { color: theme.text }]}>{title}</Text>
        <Text style={[theme.typography.caption, styles.emptyText, { color: theme.textSecondary }]}>
          {body}
        </Text>
        {actionLabel && onAction ? (
          <Button fullWidth={false} onPress={onAction}>
            {actionLabel}
          </Button>
        ) : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.four,
    gap: Spacing.two,
  },
  actionError: {
    marginBottom: Spacing.two,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.three,
    marginBottom: Spacing.two,
  },
  routeCopy: {
    flex: 1,
    gap: Spacing.half,
  },
  badges: {
    alignItems: 'flex-end',
    gap: Spacing.one,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.three,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: Spacing.two,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    flexShrink: 1,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    marginTop: Spacing.three,
  },
  empty: {
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
});
