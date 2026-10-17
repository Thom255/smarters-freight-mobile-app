import { useLocalSearchParams, router } from 'expo-router';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { Badge, Button, Card, Header, Icon, Screen, SkeletonList } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useMarketplaceCargoItem } from '@/hooks/use-marketplace';
import { useRequestBooking } from '@/hooks/use-matches';
import { useTheme } from '@/hooks/use-theme';
import { useTrucks } from '@/hooks/use-trucks';
import type { ApiTruck } from '@/lib/api';
import {
  CARGO_STATUS_TONE,
  estimateCost,
  formatDate,
  formatMoney,
  formatRate,
  formatTons,
  titleCaseStatus,
} from '@/lib/marketplace';

export default function MarketplaceCargoScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const { user } = useAuth();
  const { cargo, loading, error } = useMarketplaceCargoItem(id);
  const { requestBooking, submittingId } = useRequestBooking();

  const canRequest = user?.role === 'truck_owner';
  const { trucks, loading: trucksLoading } = useTrucks();
  const availableTrucks = (trucks ?? []).filter((truck) => truck.status === 'available');

  const sendRequest = (truck: ApiTruck) => {
    if (!cargo) return;
    Alert.alert(
      'Send booking request?',
      `Ask the owner to book ${cargo.pickupLocation} → ${cargo.destination} with ${truck.truckType} (${truck.registrationNumber}).`,
      [
        { text: 'Not now', style: 'cancel' },
        {
          text: 'Send request',
          onPress: () => {
            void (async () => {
              const price = estimateCost(truck, cargo) ?? undefined;
              const result = await requestBooking(truck.id, cargo.id, { price });
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
      <Header title="Load details" />

      {loading ? (
        <SkeletonList count={2} />
      ) : error || !cargo ? (
        <Card>
          <Text style={[theme.typography.body, { color: theme.danger }]}>
            {error ?? 'This load is no longer available.'}
          </Text>
        </Card>
      ) : (
        <>
          <Card>
            <View style={styles.head}>
              <View style={styles.headCopy}>
                <Text style={[theme.typography.heading, { color: theme.text }]} numberOfLines={1}>
                  {cargo.pickupLocation} → {cargo.destination}
                </Text>
                <Text style={[theme.typography.caption, { color: theme.textSecondary }]}>
                  {cargo.reference || cargo.cargoType}
                </Text>
              </View>
              <Badge tone={CARGO_STATUS_TONE[cargo.status]}>{titleCaseStatus(cargo.status)}</Badge>
            </View>

            <View style={[styles.detailGrid, { borderTopColor: theme.divider }]}>
              <Detail icon="box" label="Cargo" value={`${cargo.cargoType} · ${formatTons(cargo.weightTons)}`} />
              <Detail icon="clock" label="Pickup" value={formatDate(cargo.pickupDate) || 'Flexible'} />
              <Detail
                icon="card"
                label="Budget"
                value={formatMoney(cargo.budget, cargo.currency) || 'Open'}
              />
              <Detail
                icon="truck"
                label="Truck"
                value={cargo.preferredTruckType || 'Any'}
              />
            </View>

            {cargo.specialRequirements ? (
              <Text
                style={[theme.typography.caption, { color: theme.textSecondary, marginTop: Spacing.three }]}>
                {cargo.specialRequirements}
              </Text>
            ) : null}
          </Card>

          {canRequest ? (
            <Card>
              <Text style={[theme.typography.subheading, { color: theme.text }]}>
                Offer one of your trucks
              </Text>
              <Text
                style={[theme.typography.caption, { color: theme.textSecondary, marginTop: Spacing.one }]}>
                Pick an available truck to send a booking request.
              </Text>

              {trucksLoading ? (
                <Text style={[theme.typography.caption, { color: theme.textSecondary, marginTop: Spacing.two }]}>
                  Loading your trucks…
                </Text>
              ) : availableTrucks.length === 0 ? (
                <Text
                  style={[theme.typography.caption, { color: theme.textSecondary, marginTop: Spacing.two }]}>
                  You have no available trucks. Add one from your Fleet first.
                </Text>
              ) : (
                <View style={styles.loadList}>
                  {availableTrucks.map((truck) => {
                    const cost = estimateCost(truck, cargo);
                    return (
                      <View
                        key={truck.id}
                        style={[styles.loadRow, { borderTopColor: theme.divider }]}>
                        <View style={styles.loadCopy}>
                          <Text
                            style={[theme.typography.bodyMedium, { color: theme.text }]}
                            numberOfLines={1}>
                            {truck.truckType} · {truck.registrationNumber}
                          </Text>
                          <Text
                            style={[theme.typography.caption, { color: theme.textSecondary }]}
                            numberOfLines={1}>
                            {formatTons(truck.capacityTons)}
                            {formatRate(truck.ratePerTon, cargo.currency)
                              ? ` · ${formatRate(truck.ratePerTon, cargo.currency)}`
                              : ''}
                            {cost != null ? ` · ${formatMoney(cost, cargo.currency)}` : ''}
                          </Text>
                        </View>
                        <Button
                          size="sm"
                          fullWidth={false}
                          loading={submittingId === `${truck.id}:${cargo.id}`}
                          disabled={submittingId !== null}
                          onPress={() => sendRequest(truck)}>
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
                Only truck owners can request a load. Manage your loads from Cargo.
              </Text>
            </Card>
          )}
        </>
      )}
    </Screen>
  );
}

function Detail({ icon, label, value }: { icon: 'box' | 'clock' | 'card' | 'truck'; label: string; value: string }) {
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
