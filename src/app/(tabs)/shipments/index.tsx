import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ListControls, matchesQuery } from '@/components/list-controls';
import {
  Badge,
  Button,
  Card,
  FadeInView,
  Header,
  Icon,
  Screen,
  SkeletonList,
} from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useShipments } from '@/hooks/use-shipments';
import { useTheme } from '@/hooks/use-theme';
import {
  formatShipmentDate,
  formatShipmentWeight,
  shipmentStatusLabel,
  SHIPMENT_STATUS_TONE,
  type ShipmentStatus,
} from '@/lib/shipments';

const STATUS_FILTERS = (
  ['booked', 'in_transit', 'delivered', 'cancelled'] as ShipmentStatus[]
).map((value) => ({ value, label: shipmentStatusLabel(value) }));

const PAGE_SIZE = 8;

type SortOrder = 'newest' | 'oldest';

const SORTS: { value: SortOrder; label: string }[] = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
];

export default function ShipmentsScreen() {
  const theme = useTheme();
  const { shipments, loading, refreshing, error, reload } = useShipments();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<ShipmentStatus | 'all'>('all');
  const [sort, setSort] = useState<SortOrder>('newest');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // Any change to the search/filter/sort starts the list from the top again.
  const changeQuery = (value: string) => {
    setQuery(value);
    setVisibleCount(PAGE_SIZE);
  };
  const changeStatus = (value: ShipmentStatus | 'all') => {
    setStatus(value);
    setVisibleCount(PAGE_SIZE);
  };
  const changeSort = (value: SortOrder) => {
    setSort(value);
    setVisibleCount(PAGE_SIZE);
  };

  const filtered = useMemo(
    () =>
      (shipments ?? []).filter(
        (shipment) =>
          (status === 'all' || shipment.status === status) &&
          matchesQuery(
            query,
            shipment.reference,
            shipment.origin,
            shipment.destination,
            shipment.cargoType,
            shipment.bookingReference,
          ),
      ),
    [shipments, query, status],
  );

  const sorted = useMemo(() => {
    const list = [...filtered];
    list.sort((a, b) => {
      const left = a.createdAt ?? 0;
      const right = b.createdAt ?? 0;
      return sort === 'oldest' ? left - right : right - left;
    });
    return list;
  }, [filtered, sort]);

  const shown = useMemo(() => sorted.slice(0, visibleCount), [sorted, visibleCount]);
  const hasMore = sorted.length > shown.length;

  const filtering = query.trim() !== '' || status !== 'all';
  const count = filtered.length;
  const totalCount = shipments?.length ?? 0;
  const subtitle =
    totalCount > 0
      ? filtering
        ? `${count} of ${totalCount} shipment${totalCount === 1 ? '' : 's'}`
        : `${totalCount} shipment${totalCount === 1 ? '' : 's'} · ${SORTS.find((s) => s.value === sort)?.label.toLowerCase()}`
      : undefined;

  return (
    <Screen
      scroll
      tabBar
      refreshing={refreshing}
      onRefresh={() => void reload()}
      contentStyle={styles.content}>
      <Header title="Shipments" subtitle={subtitle} back={false} />

      <View style={styles.body}>
        <Button
          size="lg"
          onPress={() => router.push('/shipments/new')}
          iconLeft={<Icon name="plus" size={18} color={theme.onPrimary} />}>
          New shipment
        </Button>

        {!loading && totalCount > 0 ? (
          <>
            <ListControls
              query={query}
              onQueryChange={changeQuery}
              placeholder="Search reference, route or cargo"
              options={STATUS_FILTERS}
              active={status}
              onActiveChange={changeStatus}
              allLabel="All statuses"
            />

            <View style={styles.sortRow}>
              <Text style={[theme.typography.caption, { color: theme.textSecondary }]}>Sort</Text>
              {SORTS.map((option) => {
                const selected = option.value === sort;
                return (
                  <Pressable
                    key={option.value}
                    onPress={() => changeSort(option.value)}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    style={[
                      styles.sortChip,
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
          </>
        ) : null}

        {error && !shipments ? (
          <Card>
            <View style={styles.emptyState}>
              <View style={[styles.emptyIcon, { backgroundColor: theme.dangerSubtle }]}>
                <Icon name="alert" size={26} color={theme.danger} />
              </View>
              <Text style={[theme.typography.subheading, { color: theme.text }]}>
                Couldn&apos;t load your shipments
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
        ) : loading && !shipments ? (
          <SkeletonList count={4} />
        ) : totalCount === 0 ? (
          <Card>
            <View style={styles.emptyState}>
              <View style={[styles.emptyIcon, { backgroundColor: theme.primarySubtle }]}>
                <Icon name="box" size={26} color={theme.primary} />
              </View>
              <Text style={[theme.typography.subheading, { color: theme.text }]}>
                No shipments yet
              </Text>
              <Text
                style={[
                  theme.typography.caption,
                  styles.emptyText,
                  { color: theme.textSecondary },
                ]}>
                Book your first load and track it from pickup all the way to delivery.
              </Text>
              <Button
                fullWidth={false}
                onPress={() => router.push('/shipments/new')}
                iconLeft={<Icon name="plus" size={18} color={theme.onPrimary} />}>
                Create a shipment
              </Button>
            </View>
          </Card>
        ) : count === 0 ? (
          <Card>
            <View style={styles.emptyState}>
              <View style={[styles.emptyIcon, { backgroundColor: theme.backgroundSelected }]}>
                <Icon name="search" size={26} color={theme.textSecondary} />
              </View>
              <Text style={[theme.typography.subheading, { color: theme.text }]}>
                No shipments match
              </Text>
              <Text
                style={[theme.typography.caption, styles.emptyText, { color: theme.textSecondary }]}>
                Nothing here matches “{query.trim() || shipmentStatusLabel(status as ShipmentStatus)}”.
                Try a different search or clear the filters.
              </Text>
              <Button
                fullWidth={false}
                variant="outline"
                onPress={() => {
                  changeQuery('');
                  changeStatus('all');
                }}>
                Clear filters
              </Button>
            </View>
          </Card>
        ) : (
          <>
            {error ? (
              <Text style={[theme.typography.caption, { color: theme.danger }]}>
                {error} Pull down to retry.
              </Text>
            ) : null}

            {shown.map((shipment, index) => (
              <FadeInView key={shipment.id} index={index}>
                <Card
                  onPress={() =>
                    router.push({ pathname: '/shipments/[id]', params: { id: shipment.id } })
                  }>
                  <View style={styles.row}>
                    <View
                      style={[styles.rowIcon, { backgroundColor: theme.primarySubtle }]}>
                      <Icon name="truck" size={18} color={theme.primary} />
                    </View>

                    <View style={styles.rowCopy}>
                      <Text
                        style={[theme.typography.bodyMedium, { color: theme.text }]}
                        numberOfLines={1}>
                        {shipment.origin} → {shipment.destination}
                      </Text>
                      <Text
                        style={[theme.typography.caption, { color: theme.textSecondary }]}
                        numberOfLines={1}>
                        {shipment.reference}
                        {shipment.cargoType ? ` · ${shipment.cargoType}` : ''}
                        {formatShipmentWeight(shipment.weightTons)
                          ? ` · ${formatShipmentWeight(shipment.weightTons)}`
                          : ''}
                        {formatShipmentDate(shipment.createdAt)
                          ? ` · ${formatShipmentDate(shipment.createdAt)}`
                          : ''}
                      </Text>
                    </View>

                    <View style={styles.rowMeta}>
                      <Badge tone={SHIPMENT_STATUS_TONE[shipment.status] ?? 'neutral'}>
                        {shipmentStatusLabel(shipment.status)}
                      </Badge>
                      <Icon name="chevronRight" size={16} color={theme.textSecondary} />
                    </View>
                  </View>
                </Card>
              </FadeInView>
            ))}

            <Text style={[theme.typography.caption, styles.showing, { color: theme.textSecondary }]}>
              Showing {shown.length} of {count}
            </Text>

            {hasMore ? (
              <Button
                variant="outline"
                onPress={() => setVisibleCount((current) => current + PAGE_SIZE)}>
                Load more
              </Button>
            ) : null}
          </>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: Spacing.four,
  },
  body: {
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
  },
  sortRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: Spacing.one,
  },
  sortChip: {
    borderRadius: 999,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  showing: {
    textAlign: 'center',
    marginTop: Spacing.one,
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowCopy: {
    flex: 1,
    gap: Spacing.half,
  },
  rowMeta: {
    alignItems: 'flex-end',
    gap: Spacing.half,
  },
});
