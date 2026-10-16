import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

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
  shipmentStatusLabel,
  SHIPMENT_STATUS_TONE,
} from '@/lib/shipments';

export default function ShipmentsScreen() {
  const theme = useTheme();
  const { shipments, loading, refreshing, error, reload } = useShipments();

  const count = shipments?.length ?? 0;
  const subtitle =
    count > 0 ? `${count} shipment${count === 1 ? '' : 's'} · newest first` : undefined;

  return (
    <Screen
      scroll
      tabBar
      refreshing={refreshing}
      onRefresh={() => void reload()}
      contentStyle={styles.content}>
      <Header title="Shipments" subtitle={subtitle} back={false} />

      <View style={styles.body}>
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
        ) : count === 0 ? (
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
                Create one from the dashboard and it will show up here, ready to track
                from pickup to delivery.
              </Text>
              <Button
                fullWidth={false}
                onPress={() => router.replace('/')}
                iconLeft={<Icon name="arrowRight" size={18} color={theme.onPrimary} />}>
                Back to dashboard
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

            {shipments?.map((shipment, index) => (
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
