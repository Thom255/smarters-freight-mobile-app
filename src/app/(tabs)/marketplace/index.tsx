import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Badge, Card, FadeInView, Header, Icon, Screen, SkeletonList } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useMarketplaceCargo, useMarketplaceTrucks } from '@/hooks/use-marketplace';
import { useTheme } from '@/hooks/use-theme';
import { formatDate, formatMoney, formatRate, formatTons, titleCaseStatus } from '@/lib/marketplace';

type Segment = 'trucks' | 'loads';

export default function MarketplaceScreen() {
  const theme = useTheme();
  const [segment, setSegment] = useState<Segment>('trucks');

  const {
    trucks,
    loading: trucksLoading,
    refreshing: trucksRefreshing,
    error: trucksError,
    reload: reloadTrucks,
  } = useMarketplaceTrucks();

  const {
    cargo,
    loading: cargoLoading,
    refreshing: cargoRefreshing,
    error: cargoError,
    reload: reloadCargo,
  } = useMarketplaceCargo();

  const showingTrucks = segment === 'trucks';
  const loading = showingTrucks ? trucksLoading : cargoLoading;
  const refreshing = showingTrucks ? trucksRefreshing : cargoRefreshing;
  const error = showingTrucks ? trucksError : cargoError;
  const count = showingTrucks ? (trucks?.length ?? 0) : (cargo?.length ?? 0);

  const onRefresh = () => void (showingTrucks ? reloadTrucks() : reloadCargo());

  return (
    <Screen scroll tabBar refreshing={refreshing} onRefresh={onRefresh} contentStyle={styles.content}>
      <Header title="Marketplace" back={false} subtitle={count > 0 ? `${count} listed` : undefined} />

      <View style={[styles.segment, { backgroundColor: theme.backgroundSelected }]}>
        <SegmentButton
          label="Trucks"
          active={showingTrucks}
          onPress={() => setSegment('trucks')}
        />
        <SegmentButton
          label="Loads"
          active={!showingTrucks}
          onPress={() => setSegment('loads')}
        />
      </View>

      {loading && count === 0 ? (
        <SkeletonList count={3} />
      ) : error && count === 0 ? (
        <Card>
          <View style={styles.empty}>
            <View style={[styles.emptyIcon, { backgroundColor: theme.dangerSubtle }]}>
              <Icon name="alert" size={26} color={theme.danger} />
            </View>
            <Text style={[theme.typography.subheading, { color: theme.text }]}>
              Couldn&apos;t load the market
            </Text>
            <Text style={[theme.typography.caption, styles.emptyText, { color: theme.textSecondary }]}>
              {error}
            </Text>
          </View>
        </Card>
      ) : count === 0 ? (
        <Card>
          <View style={styles.empty}>
            <View style={[styles.emptyIcon, { backgroundColor: theme.primarySubtle }]}>
              <Icon name={showingTrucks ? 'truck' : 'box'} size={26} color={theme.primary} />
            </View>
            <Text style={[theme.typography.subheading, { color: theme.text }]}>
              {showingTrucks ? 'No trucks available' : 'No loads posted'}
            </Text>
            <Text style={[theme.typography.caption, styles.emptyText, { color: theme.textSecondary }]}>
              {showingTrucks
                ? 'Available trucks will appear here as owners list them.'
                : 'Posted loads will appear here as owners list them.'}
            </Text>
          </View>
        </Card>
      ) : showingTrucks ? (
        (trucks ?? []).map((truck, index) => (
          <FadeInView key={truck.id} index={index}>
            <Card onPress={() => router.push(`/marketplace/truck/${truck.id}`)}>
              <View style={styles.row}>
                <View style={styles.copy}>
                  <Text style={[theme.typography.bodyMedium, { color: theme.text }]} numberOfLines={1}>
                    {truck.truckType} · {truck.registrationNumber}
                  </Text>
                  <Text
                    style={[theme.typography.caption, { color: theme.textSecondary }]}
                    numberOfLines={1}>
                    {truck.currentLocation} · {formatTons(truck.capacityTons)}
                  </Text>
                </View>
                <View style={styles.side}>
                  {truck.ratePerTon != null ? (
                    <Text style={[theme.typography.label, { color: theme.primary }]}>
                      {formatRate(truck.ratePerTon, 'TZS')}
                    </Text>
                  ) : (
                    <Badge tone="success">Available</Badge>
                  )}
                  {truck.driverName ? (
                    <Text
                      style={[theme.typography.caption, { color: theme.textSecondary }]}
                      numberOfLines={1}>
                      {truck.driverName}
                    </Text>
                  ) : null}
                </View>
                <Icon name="chevronRight" size={20} color={theme.textSecondary} />
              </View>
            </Card>
          </FadeInView>
        ))
      ) : (
        (cargo ?? []).map((load, index) => (
          <FadeInView key={load.id} index={index}>
            <Card onPress={() => router.push(`/marketplace/cargo/${load.id}`)}>
              <View style={styles.row}>
                <View style={styles.copy}>
                  <Text style={[theme.typography.bodyMedium, { color: theme.text }]} numberOfLines={1}>
                    {load.pickupLocation} → {load.destination}
                  </Text>
                  <Text
                    style={[theme.typography.caption, { color: theme.textSecondary }]}
                    numberOfLines={1}>
                    {load.cargoType} · {formatTons(load.weightTons)} ·{' '}
                    {formatDate(load.pickupDate) || 'Flexible'}
                  </Text>
                </View>
                <View style={styles.side}>
                  {load.budget != null ? (
                    <Text style={[theme.typography.label, { color: theme.primary }]}>
                      {formatMoney(load.budget, load.currency)}
                    </Text>
                  ) : (
                    <Badge tone="info">{titleCaseStatus(load.status)}</Badge>
                  )}
                </View>
                <Icon name="chevronRight" size={20} color={theme.textSecondary} />
              </View>
            </Card>
          </FadeInView>
        ))
      )}
    </Screen>
  );
}

function SegmentButton({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      style={[
        styles.segmentButton,
        active && { backgroundColor: theme.backgroundElement },
      ]}>
      <Text
        style={[
          theme.typography.bodyMedium,
          { color: active ? theme.text : theme.textSecondary },
        ]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.four,
    gap: Spacing.two,
  },
  segment: {
    flexDirection: 'row',
    borderRadius: 12,
    padding: Spacing.half,
    gap: Spacing.half,
  },
  segmentButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.two,
    borderRadius: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  copy: {
    flex: 1,
    gap: Spacing.half,
  },
  side: {
    alignItems: 'flex-end',
    gap: Spacing.one,
    maxWidth: 120,
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
  },
});
