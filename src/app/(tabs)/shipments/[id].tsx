import { useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { ShipmentTimeline } from '@/components/shipment-timeline';
import { Badge, Button, Card, FadeInView, Header, Icon, Screen } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useShipment } from '@/hooks/use-shipments';
import { useTheme } from '@/hooks/use-theme';
import {
  formatShipmentDate,
  shipmentStatusLabel,
  SHIPMENT_STATUS_TONE,
} from '@/lib/shipments';

export default function ShipmentDetailScreen() {
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { shipment, loading, error, reload } = useShipment(id);

  return (
    <Screen scroll contentStyle={styles.content}>
      <Header title="Shipment" subtitle={shipment?.reference} />

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
              </Card>
            </FadeInView>

            <FadeInView index={2}>
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

            <FadeInView index={3}>
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
});
