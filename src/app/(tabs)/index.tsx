import { router, type Href } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  Badge,
  Button,
  Card,
  FadeInView,
  Icon,
  Screen,
  SkeletonList,
  type IconName,
} from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useDashboard } from '@/hooks/use-dashboard';
import { useTheme } from '@/hooks/use-theme';
import type { DashboardAlertTone, DashboardPayload } from '@/lib/api';
import { shipmentStatusLabel, SHIPMENT_STATUS_TONE } from '@/lib/shipments';
import { roleLabel } from '@/lib/marketplace';

type Metric = {
  key: string;
  label: string;
  value: number;
  icon: IconName;
};

export default function DashboardScreen() {
  const theme = useTheme();
  const { user } = useAuth();
  const { data, loading, refreshing, error, reload } = useDashboard();

  const role = user?.role ?? 'cargo_owner';
  const isTruckOwner = role === 'truck_owner';

  const displayName = user?.name?.split(' ')[0] ?? 'SMARTERS FREIGHT';
  const subtitle = user?.name ? `${roleLabel(role)} · ${user.identifier}` : 'Signed in';

  const roleActions: { label: string; icon: IconName; route: string }[] = isTruckOwner
    ? [
        { label: 'Add truck', icon: 'truck', route: '/trucks' },
        { label: 'Find loads', icon: 'swap', route: '/matches' },
      ]
    : [
        { label: 'Post cargo', icon: 'box', route: '/cargo' },
        { label: 'Find trucks', icon: 'swap', route: '/matches' },
      ];

  const quickActions: { label: string; icon: IconName; route: string }[] = [
    { label: 'New shipment', icon: 'plus', route: '/shipments/new' },
    ...roleActions,
  ];

  const metrics = data ? buildMetrics(data, isTruckOwner) : [];
  const alerts = data?.alerts ?? [];
  const upcoming = data?.upcomingDeliveries ?? [];
  const activity = data?.recentActivity ?? [];

  const hasNoData =
    !!data &&
    data.stats.shipments === 0 &&
    data.loads.total === 0 &&
    data.fleet.total === 0 &&
    upcoming.length === 0 &&
    activity.length === 0;

  return (
    <Screen
      scroll
      tabBar
      refreshing={refreshing}
      onRefresh={() => void reload()}>
      {/* Hero */}
      <View style={[styles.hero, { backgroundColor: theme.brandNavy }]}>
        <View style={styles.heroTop}>
          <View style={styles.heroCopy}>
            <Text style={[theme.typography.caption, { color: theme.onBrandMuted }]}>
              Welcome back 👋
            </Text>
            <Text style={[theme.typography.title, { color: theme.onBrand }]}>
              {displayName}
            </Text>
            <Text style={[theme.typography.caption, { color: theme.onBrandMuted }]}>
              {subtitle}
            </Text>
          </View>

          <View style={styles.heroActions}>
            <View style={[styles.iconButton, { backgroundColor: theme.brandNavySurface }]}>
              <Icon name="bell" size={20} color={theme.accent} />
            </View>

            <Pressable
              onPress={() => router.push('/profile')}
              accessibilityRole="button"
              accessibilityLabel="Profile"
              style={({ pressed }) => [
                styles.iconButton,
                { backgroundColor: theme.brandNavySurface },
                pressed && styles.pressed,
              ]}>
              <Icon name="person" size={20} color={theme.accent} />
            </Pressable>
          </View>
        </View>
      </View>

      <View style={styles.body}>
        {error && !data ? (
          <Card>
            <View style={styles.emptyState}>
              <View style={[styles.emptyIcon, { backgroundColor: theme.dangerSubtle }]}>
                <Icon name="alert" size={26} color={theme.danger} />
              </View>
              <Text style={[theme.typography.subheading, { color: theme.text }]}>
                Couldn&apos;t load your dashboard
              </Text>
              <Text
                style={[
                  theme.typography.caption,
                  styles.centerText,
                  { color: theme.textSecondary },
                ]}>
                {error}
              </Text>
              <Button fullWidth={false} onPress={() => void reload()}>
                Try again
              </Button>
            </View>
          </Card>
        ) : loading && !data ? (
          <SkeletonList count={4} />
        ) : (
          <>
            {error ? (
              <FadeInView index={0}>
                <Card>
                  <View style={styles.row}>
                    <View style={[styles.roundIcon, { backgroundColor: theme.dangerSubtle }]}>
                      <Icon name="alert" size={18} color={theme.danger} />
                    </View>
                    <View style={styles.flex}>
                      <Text style={[theme.typography.bodyMedium, { color: theme.text }]}>
                        Couldn&apos;t refresh
                      </Text>
                      <Text style={[theme.typography.caption, { color: theme.textSecondary }]}>
                        {error}
                      </Text>
                    </View>
                    <Pressable
                      onPress={() => void reload()}
                      hitSlop={Spacing.two}
                      accessibilityRole="button">
                      <Text style={[theme.typography.label, { color: theme.primary }]}>
                        Retry
                      </Text>
                    </Pressable>
                  </View>
                </Card>
              </FadeInView>
            ) : null}

            <FadeInView index={0}>
              <View style={styles.quickActions}>
                {quickActions.map((action) => (
                  <Pressable
                    key={action.label}
                    onPress={() => router.push(action.route as Href)}
                    accessibilityRole="button"
                    style={({ pressed }) => [
                      styles.quickAction,
                      {
                        backgroundColor: theme.backgroundElement,
                        borderColor: theme.border,
                      },
                      pressed && styles.pressed,
                    ]}>
                    <View style={[styles.roundIcon, { backgroundColor: theme.primarySubtle }]}>
                      <Icon name={action.icon} size={18} color={theme.primary} />
                    </View>
                    <Text style={[theme.typography.bodyMedium, { color: theme.text }]}>
                      {action.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </FadeInView>

            {hasNoData ? (
              <FadeInView index={1}>
                <Card>
                  <View style={styles.emptyState}>
                    <View style={[styles.emptyIcon, { backgroundColor: theme.primarySubtle }]}>
                      <Icon name="grid" size={26} color={theme.primary} />
                    </View>
                    <Text style={[theme.typography.subheading, { color: theme.text }]}>
                      Your dashboard is ready
                    </Text>
                    <Text
                      style={[
                        theme.typography.caption,
                        styles.centerText,
                        { color: theme.textSecondary },
                      ]}>
                      {isTruckOwner
                        ? 'Add a truck to start matching with posted loads.'
                        : 'Create your first shipment to see live metrics here.'}
                    </Text>
                  </View>
                </Card>
              </FadeInView>
            ) : null}

            <SectionHeader title="Overview" />
            <FadeInView index={2}>
              <View style={styles.grid}>
                {metrics.map((metric) => (
                  <MetricTile key={metric.key} metric={metric} />
                ))}
              </View>
            </FadeInView>

            <SectionHeader
              title="Alerts"
              action={alerts.length > 0 ? `${alerts.length}` : undefined}
            />
            <FadeInView index={3}>
              <Card>
                {alerts.length > 0 ? (
                  <View style={styles.list}>
                    {alerts.map((alert) => (
                      <View key={alert.id} style={styles.row}>
                        <View
                          style={[
                            styles.roundIcon,
                            { backgroundColor: alertSurface(theme, alert.tone) },
                          ]}>
                          <Icon
                            name={alertIcon(alert.tone)}
                            size={18}
                            color={alertColor(theme, alert.tone)}
                          />
                        </View>
                        <View style={styles.flex}>
                          <Text style={[theme.typography.bodyMedium, { color: theme.text }]}>
                            {alert.title}
                          </Text>
                          {alert.body ? (
                            <Text
                              style={[theme.typography.caption, { color: theme.textSecondary }]}>
                              {alert.body}
                            </Text>
                          ) : null}
                        </View>
                      </View>
                    ))}
                  </View>
                ) : (
                  <EmptyRow
                    icon="check"
                    title="No alerts"
                    body="Nothing needs your attention right now."
                  />
                )}
              </Card>
            </FadeInView>

            <SectionHeader
              title="Upcoming deliveries"
              action="See all"
              onAction={() => router.push('/shipments')}
            />
            <FadeInView index={4}>
              <Card>
                {upcoming.length > 0 ? (
                  <View style={styles.list}>
                    {upcoming.map((delivery) => (
                      <Pressable
                        key={delivery.id}
                        style={styles.row}
                        accessibilityRole="button"
                        onPress={() =>
                          router.push({
                            pathname: '/shipments/[id]',
                            params: { id: delivery.id },
                          })
                        }>
                        <View
                          style={[styles.roundIcon, { backgroundColor: theme.primarySubtle }]}>
                          <Icon name="truck" size={18} color={theme.primary} />
                        </View>
                        <View style={styles.flex}>
                          <Text
                            style={[theme.typography.bodyMedium, { color: theme.text }]}
                            numberOfLines={1}>
                            {delivery.origin} → {delivery.destination}
                          </Text>
                          <Text
                            style={[theme.typography.caption, { color: theme.textSecondary }]}
                            numberOfLines={1}>
                            {delivery.reference ?? 'Shipment'}
                          </Text>
                        </View>
                        <Badge tone={SHIPMENT_STATUS_TONE[delivery.status] ?? 'neutral'}>
                          {shipmentStatusLabel(delivery.status)}
                        </Badge>
                      </Pressable>
                    ))}
                  </View>
                ) : (
                  <EmptyRow
                    icon="truck"
                    title="No upcoming deliveries"
                    body="Confirmed and in-transit shipments will appear here."
                  />
                )}
              </Card>
            </FadeInView>

            <SectionHeader
              title="Recent activity"
              action="See all"
              onAction={() => router.push('/shipments')}
            />
            <FadeInView index={5}>
              <Card>
                {activity.length > 0 ? (
                  <View style={styles.list}>
                    {activity.map((item) => (
                      <View key={item.id} style={styles.row}>
                        <View
                          style={[styles.roundIcon, { backgroundColor: theme.backgroundSelected }]}>
                          <Icon name="clock" size={18} color={theme.textSecondary} />
                        </View>
                        <View style={styles.flex}>
                          <Text style={[theme.typography.bodyMedium, { color: theme.text }]}>
                            {item.title}
                          </Text>
                          <Text
                            style={[theme.typography.caption, { color: theme.textSecondary }]}
                            numberOfLines={1}>
                            {item.body ?? item.reference ?? ''}
                          </Text>
                        </View>
                      </View>
                    ))}
                  </View>
                ) : (
                  <EmptyRow
                    icon="clock"
                    title="Nothing here yet"
                    body="Updates about your deliveries will show up here."
                  />
                )}
              </Card>
            </FadeInView>
          </>
        )}
      </View>
    </Screen>
  );
}

/** Role-aware metric tiles — every value comes straight from the backend. */
function buildMetrics(data: DashboardPayload, isTruckOwner: boolean): Metric[] {
  const shared: Metric[] = [
    { key: 'shipments', label: 'Total shipments', value: data.stats.shipments, icon: 'box' },
    { key: 'booked', label: 'Confirmed', value: data.stats.booked, icon: 'hourglass' },
    { key: 'inTransit', label: 'In transit', value: data.stats.inTransit, icon: 'truck' },
    { key: 'delivered', label: 'Delivered', value: data.stats.delivered, icon: 'checkSeal' },
  ];

  const specific: Metric[] = isTruckOwner
    ? [
        { key: 'fleet', label: 'Fleet size', value: data.fleet.total, icon: 'grid' },
        { key: 'availableTrucks', label: 'Available trucks', value: data.fleet.available, icon: 'truck' },
        { key: 'openLoads', label: 'Open loads', value: data.marketplace.postedCargo, icon: 'route' },
        { key: 'bookings', label: 'Active bookings', value: data.bookings.active, icon: 'swap' },
      ]
    : [
        { key: 'pendingLoads', label: 'Pending loads', value: data.loads.pending, icon: 'hourglass' },
        { key: 'confirmedLoads', label: 'Confirmed loads', value: data.loads.confirmed, icon: 'check' },
        { key: 'availableTrucks', label: 'Available trucks', value: data.marketplace.availableTrucks, icon: 'truck' },
        { key: 'bookings', label: 'Active bookings', value: data.bookings.active, icon: 'swap' },
      ];

  return [...shared, ...specific];
}

function MetricTile({ metric }: { metric: Metric }) {
  const theme = useTheme();

  return (
    <View
      style={[
        styles.metricTile,
        { backgroundColor: theme.backgroundElement, borderColor: theme.border },
      ]}>
      <View style={[styles.roundIcon, { backgroundColor: theme.primarySubtle }]}>
        <Icon name={metric.icon} size={18} color={theme.primary} />
      </View>
      <Text style={[theme.typography.title, { color: theme.text }]}>{metric.value}</Text>
      <Text style={[theme.typography.caption, { color: theme.textSecondary }]} numberOfLines={1}>
        {metric.label}
      </Text>
    </View>
  );
}

function SectionHeader({
  title,
  action,
  onAction,
}: {
  title: string;
  action?: string;
  onAction?: () => void;
}) {
  const theme = useTheme();

  return (
    <View style={styles.sectionHeader}>
      <Text style={[theme.typography.subheading, { color: theme.text }]}>{title}</Text>
      {action ? (
        onAction ? (
          <Pressable
            onPress={onAction}
            hitSlop={Spacing.two}
            accessibilityRole="button">
            <Text style={[theme.typography.label, { color: theme.primary }]}>{action}</Text>
          </Pressable>
        ) : (
          <Badge tone="neutral">{action}</Badge>
        )
      ) : null}
    </View>
  );
}

function EmptyRow({ icon, title, body }: { icon: IconName; title: string; body: string }) {
  const theme = useTheme();

  return (
    <View style={styles.row}>
      <View style={[styles.roundIcon, { backgroundColor: theme.backgroundSelected }]}>
        <Icon name={icon} size={18} color={theme.textSecondary} />
      </View>
      <View style={styles.flex}>
        <Text style={[theme.typography.bodyMedium, { color: theme.text }]}>{title}</Text>
        <Text style={[theme.typography.caption, { color: theme.textSecondary }]}>{body}</Text>
      </View>
    </View>
  );
}

function alertIcon(tone: DashboardAlertTone): IconName {
  switch (tone) {
    case 'warning':
    case 'danger':
      return 'alert';
    case 'success':
      return 'check';
    default:
      return 'info';
  }
}

function alertSurface(
  theme: ReturnType<typeof useTheme>,
  tone: DashboardAlertTone,
): string {
  switch (tone) {
    case 'warning':
    case 'danger':
      return theme.warningSubtle;
    case 'success':
      return theme.successSubtle;
    default:
      return theme.infoSubtle;
  }
}

function alertColor(
  theme: ReturnType<typeof useTheme>,
  tone: DashboardAlertTone,
): string {
  switch (tone) {
    case 'warning':
    case 'danger':
      return theme.warning;
    case 'success':
      return theme.success;
    default:
      return theme.info;
  }
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  hero: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.four,
    paddingBottom: Spacing.four,
    gap: Spacing.four,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
  },
  heroTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
  },
  heroCopy: {
    flex: 1,
    gap: Spacing.half,
  },
  heroActions: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    padding: Spacing.three,
    gap: Spacing.two,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing.three,
    marginBottom: Spacing.one,
  },
  quickActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  quickAction: {
    flexGrow: 1,
    flexBasis: '30%',
    minWidth: 104,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: 1,
    borderRadius: 14,
    padding: Spacing.three,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  metricTile: {
    width: '48%',
    flexGrow: 1,
    flexBasis: '48%',
    borderWidth: 1,
    borderRadius: 14,
    padding: Spacing.three,
    gap: Spacing.one,
  },
  pressed: {
    opacity: 0.75,
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
  centerText: {
    textAlign: 'center',
    marginBottom: Spacing.two,
  },
  list: {
    gap: Spacing.three,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  roundIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
