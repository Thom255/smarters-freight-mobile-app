import { useLocalSearchParams, router } from 'expo-router';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { Badge, Button, Card, Header, Icon, Screen, SkeletonList } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useCargo } from '@/hooks/use-cargo';
import { useMarketplaceTruck } from '@/hooks/use-marketplace';
import { useRequestBooking } from '@/hooks/use-matches';
import { useTheme } from '@/hooks/use-theme';
import type { ApiCargo } from '@/lib/api';
import {
  estimateCost,
  formatDate,
  formatMoney,
  formatRate,
  formatTons,
  TRUCK_STATUS_TONE,
  titleCaseStatus,
} from '@/lib/marketplace';

export default function MarketplaceTruckScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const { user } = useAuth();
  const { truck, loading, error } = useMarketplaceTruck(id);
  const { requestBooking, submittingId } = useRequestBooking();

  const canRequest = user?.role === 'cargo_owner' || user?.role === 'admin';
  const { cargo, loading: cargoLoading } = useCargo();
  const availableCargo = (cargo ?? []).filter((load) => load.status === 'posted');

  const sendRequest = (load: ApiCargo) => {
    if (!truck) return;
    Alert.alert(
      'Send booking request?',
      `Ask the owner to reserve ${truck.truckType} (${truck.registrationNumber}) for ${load.pickupLocation} → ${load.destination}.`,
      [
        { text: 'Not now', style: 'cancel' },
        {
          text: 'Send request',
          onPress: () => {
            void (async () => {
              const price = estimateCost(truck, load) ?? undefined;
              const result = await requestBooking(truck.id, load.id, { price });
              if (result.ok) {
                Alert.alert('Request sent', 'Track it under Bookings.', [
                  { text: 'OK', onPress: () => router.push('/bookings') },
                ]);
              } else {
                Alert.alert('Could not request', result.message);
              }
            })();
          },
        },
      ],
    );
  };

  return (
    <Screen scroll contentStyle={styles.content}>
      <Header title="Truck details" />

      {loading ? (
        <SkeletonList count={2} />
      ) : error || !truck ? (
        <Card>
          <Text style={[theme.typography.body, { color: theme.danger }]}>
            {error ?? 'This truck is no longer available.'}
          </Text>
        </Card>
      ) : (
        <>
          <Card>
            <View style={styles.head}>
              <View style={styles.headCopy}>
                <Text style={[theme.typography.heading, { color: theme.text }]}>
                  {truck.truckType}
                </Text>
                <Text style={[theme.typography.caption, { color: theme.textSecondary }]}>
                  {truck.registrationNumber}
                </Text>
              </View>
              <Badge tone={TRUCK_STATUS_TONE[truck.status]}>{titleCaseStatus(truck.status)}</Badge>
            </View>

            <View style={[styles.detailGrid, { borderTopColor: theme.divider }]}>
              <Detail icon="box" label="Capacity" value={formatTons(truck.capacityTons)} />
              <Detail icon="pin" label="Location" value={truck.currentLocation || '—'} />
              <Detail
                icon="clock"
                label="Available"
                value={formatDate(truck.availabilityDate) || 'Flexible'}
              />
              <Detail
                icon="card"
                label="Rate"
                value={formatRate(truck.ratePerTon, 'TZS') || 'On request'}
              />
            </View>
          </Card>

          {truck.driverName || truck.driverPhone ? (
            <Card>
              <Text style={[theme.typography.subheading, { color: theme.text }]}>Driver</Text>
              <View style={styles.driverRow}>
                <Icon name="person" size={18} color={theme.textSecondary} />
                <Text style={[theme.typography.body, { color: theme.text }]}>
                  {truck.driverName || 'Driver'}
                  {truck.driverPhone ? ` · ${truck.driverPhone}` : ''}
                </Text>
              </View>
            </Card>
          ) : null}

          {canRequest ? (
            <Card>
              <Text style={[theme.typography.subheading, { color: theme.text }]}>
                Request this truck
              </Text>
              <Text
                style={[theme.typography.caption, { color: theme.textSecondary, marginTop: Spacing.one }]}>
                Pick one of your posted loads to send a booking request.
              </Text>

              {cargoLoading ? (
                <Text style={[theme.typography.caption, { color: theme.textSecondary, marginTop: Spacing.two }]}>
                  Loading your loads…
                </Text>
              ) : availableCargo.length === 0 ? (
                <Text
                  style={[theme.typography.caption, { color: theme.textSecondary, marginTop: Spacing.two }]}>
                  You have no posted loads. Post a load first to request a truck.
                </Text>
              ) : (
                <View style={styles.loadList}>
                  {availableCargo.map((load) => {
                    const cost = estimateCost(truck, load);
                    return (
                      <View
                        key={load.id}
                        style={[styles.loadRow, { borderTopColor: theme.divider }]}>
                        <View style={styles.loadCopy}>
                          <Text
                            style={[theme.typography.bodyMedium, { color: theme.text }]}
                            numberOfLines={1}>
                            {load.pickupLocation} → {load.destination}
                          </Text>
                          <Text
                            style={[theme.typography.caption, { color: theme.textSecondary }]}
                            numberOfLines={1}>
                            {load.cargoType} · {formatTons(load.weightTons)}
                            {cost != null ? ` · ${formatMoney(cost, load.currency)}` : ''}
                          </Text>
                        </View>
                        <Button
                          size="sm"
                          fullWidth={false}
                          loading={submittingId === `${truck.id}:${load.id}`}
                          disabled={submittingId !== null}
                          onPress={() => sendRequest(load)}>
                          Request
                        </Button>
                      </View>
                    );
                  })}
                </View>
              )}
            </Card>
          ) : (
            <Card>
              <Text style={[theme.typography.caption, { color: theme.textSecondary }]}>
                Only cargo owners can request a truck. Manage this truck from your Fleet.
              </Text>
            </Card>
          )}
        </>
      )}
    </Screen>
  );
}

function Detail({ icon, label, value }: { icon: 'box' | 'pin' | 'clock' | 'card'; label: string; value: string }) {
  const theme = useTheme();
  return (
    <View style={styles.detailItem}>
      <Icon name={icon} size={16} color={theme.textSecondary} />
      <View style={styles.detailCopy}>
        <Text style={[theme.typography.label, { color: theme.textSecondary }]}>{label}</Text>
        <Text style={[theme.typography.body, { color: theme.text }]} numberOfLines={1}>
          {value}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.four,
    gap: Spacing.two,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
  },
  headCopy: {
    flex: 1,
    gap: Spacing.half,
  },
  detailGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.three,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: Spacing.three,
    marginTop: Spacing.three,
  },
  detailItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    flexGrow: 1,
    minWidth: '45%',
  },
  detailCopy: {
    gap: Spacing.half,
    flexShrink: 1,
  },
  driverRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  loadList: {
    marginTop: Spacing.two,
  },
  loadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  loadCopy: {
    flex: 1,
    gap: Spacing.half,
  },
});
