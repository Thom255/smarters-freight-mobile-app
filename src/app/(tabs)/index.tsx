import { router, type Href } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  Badge,
  Button,
  Card,
  FadeInView,
  Icon,
  Input,
  Screen,
  type IconName,
} from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useDashboard } from '@/hooks/use-dashboard';
import { useCreateShipment } from '@/hooks/use-shipments';
import { useTheme } from '@/hooks/use-theme';
import { shipmentStatusLabel, SHIPMENT_STATUS_TONE } from '@/lib/shipments';
import { roleLabel } from '@/lib/marketplace';

export default function DashboardScreen() {
  const theme = useTheme();
  const { user } = useAuth();
  const { data, loading, error, reload } = useDashboard();
  const [composerOpen, setComposerOpen] = useState(false);

  const role = user?.role ?? 'cargo_owner';
  const isTruckOwner = role === 'truck_owner';
  const marketplace = data?.marketplace;

  const displayName = user?.name?.split(' ')[0] ?? 'SMARTERS FREIGHT';
  const subtitle = user?.name ? `${roleLabel(role)} · ${user.identifier}` : 'Signed in';

  const stats = isTruckOwner
    ? [
        { label: 'Trucks', value: marketplace?.trucks ?? 0, icon: 'truck' as IconName },
        { label: 'Available', value: marketplace?.availableTrucks ?? 0, icon: 'checkSeal' as IconName },
        { label: 'Matches', value: marketplace?.matches ?? 0, icon: 'swap' as IconName },
      ]
    : [
        { label: 'My loads', value: marketplace?.cargo ?? 0, icon: 'box' as IconName },
        { label: 'Posted', value: marketplace?.postedCargo ?? 0, icon: 'route' as IconName },
        { label: 'Matches', value: marketplace?.matches ?? 0, icon: 'swap' as IconName },
      ];

  const quickActions: { label: string; icon: IconName; route: string }[] = isTruckOwner
    ? [
        { label: 'Add truck', icon: 'truck', route: '/trucks' },
        { label: 'Find loads', icon: 'swap', route: '/matches' },
      ]
    : [
        { label: 'Post cargo', icon: 'box', route: '/cargo' },
        { label: 'Find trucks', icon: 'swap', route: '/matches' },
      ];

  const active = data?.activeShipment ?? null;
  const activity = data?.recentActivity ?? [];

  return (
    <Screen scroll tabBar>
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
            <View
              style={[styles.iconButton, { backgroundColor: theme.brandNavySurface }]}>
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

        <View style={styles.stats}>
          {stats.map((stat) => (
            <View
              key={stat.label}
              style={[styles.statTile, { backgroundColor: theme.brandNavySurface }]}>
              <Icon name={stat.icon} size={18} color={theme.accent} />
              <Text style={[theme.typography.title, { color: theme.onBrand }]}>
                {stat.value}
              </Text>
              <Text style={[theme.typography.caption, { color: theme.onBrandMuted }]}>
                {stat.label}
              </Text>
            </View>
          ))}
        </View>
      </View>

      <View style={styles.body}>
        {error ? (
          <Card>
            <View style={styles.emptyState}>
              <View style={[styles.emptyIcon, { backgroundColor: theme.primarySubtle }]}>
                <Icon name="alert" size={26} color={theme.danger} />
              </View>
              <Text style={[theme.typography.subheading, { color: theme.text }]}>
                Couldn&apos;t load your dashboard
              </Text>
              <Text
                style={[
                  theme.typography.caption,
                  styles.emptyText,
                  { color: theme.textSecondary },
                ]}>
                {error}
              </Text>
              <Button fullWidth={false} onPress={() => reload()}>
                Try again
              </Button>
            </View>
          </Card>
        ) : loading && !data ? (
          <Card>
            <View style={styles.emptyState}>
              <ActivityIndicator color={theme.primary} />
              <Text
                style={[
                  theme.typography.caption,
                  { color: theme.textSecondary },
                  styles.emptyText,
                ]}>
                Loading your shipments…
              </Text>
            </View>
          </Card>
        ) : (
          <>
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
                    <View style={[styles.activityIcon, { backgroundColor: theme.primarySubtle }]}>
                      <Icon name={action.icon} size={18} color={theme.primary} />
                    </View>
                    <Text style={[theme.typography.bodyMedium, { color: theme.text }]}>
                      {action.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </FadeInView>

            <SectionHeader
              title="Active shipment"
              action="See all"
              onAction={() => router.push('/shipments')}
            />

            <Card>
              {active ? (
                <Pressable
                  style={styles.activeRow}
                  accessibilityRole="button"
                  onPress={() =>
                    router.push({
                      pathname: '/shipments/[id]',
                      params: { id: active.id },
                    })
                  }>
                  <View
                    style={[styles.activityIcon, { backgroundColor: theme.primarySubtle }]}>
                    <Icon name="truck" size={18} color={theme.primary} />
                  </View>
                  <View style={styles.flex}>
                    <Text
                      style={[theme.typography.bodyMedium, { color: theme.text }]}
                      numberOfLines={1}>
                      {active.origin} → {active.destination}
                    </Text>
                    <Text
                      style={[theme.typography.caption, { color: theme.textSecondary }]}>
                      {active.reference}
                    </Text>
                  </View>
                  <Badge tone={SHIPMENT_STATUS_TONE[active.status] ?? 'neutral'}>
                    {shipmentStatusLabel(active.status)}
                  </Badge>
                </Pressable>
              ) : (
                <View style={styles.emptyState}>
                  <View
                    style={[styles.emptyIcon, { backgroundColor: theme.primarySubtle }]}>
                    <Icon name="truck" size={26} color={theme.primary} />
                  </View>
                  <Text style={[theme.typography.subheading, { color: theme.text }]}>
                    No active shipment
                  </Text>
                  <Text
                    style={[
                      theme.typography.caption,
                      styles.emptyText,
                      { color: theme.textSecondary },
                    ]}>
                    Create a shipment to start tracking it from pickup to delivery.
                  </Text>
                  <Button
                    fullWidth={false}
                    onPress={() => setComposerOpen(true)}
                    iconLeft={<Icon name="plus" size={18} color={theme.onPrimary} />}>
                    New shipment
                  </Button>
                </View>
              )}
            </Card>

            <SectionHeader title="Recent activity" />

            <Card>
              {activity.length > 0 ? (
                <View style={styles.activityList}>
                  {activity.map((item) => (
                    <View key={item.id} style={styles.activityRow}>
                      <View
                        style={[
                          styles.activityIcon,
                          { backgroundColor: theme.backgroundSelected },
                        ]}>
                        <Icon name="clock" size={18} color={theme.textSecondary} />
                      </View>
                      <View style={styles.flex}>
                        <Text
                          style={[theme.typography.bodyMedium, { color: theme.text }]}>
                          {item.title}
                        </Text>
                        <Text
                          style={[
                            theme.typography.caption,
                            { color: theme.textSecondary },
                          ]}
                          numberOfLines={1}>
                          {item.body ?? item.reference ?? ''}
                        </Text>
                      </View>
                    </View>
                  ))}
                </View>
              ) : (
                <View style={styles.activityRow}>
                  <View
                    style={[
                      styles.activityIcon,
                      { backgroundColor: theme.backgroundSelected },
                    ]}>
                    <Icon name="clock" size={18} color={theme.textSecondary} />
                  </View>
                  <View style={styles.flex}>
                    <Text style={[theme.typography.bodyMedium, { color: theme.text }]}>
                      Nothing here yet
                    </Text>
                    <Text
                      style={[theme.typography.caption, { color: theme.textSecondary }]}>
                      Updates about your deliveries will show up here.
                    </Text>
                  </View>
                  <Badge tone="neutral">Soon</Badge>
                </View>
              )}
            </Card>
          </>
        )}
      </View>

      <ShipmentComposer
        visible={composerOpen}
        onClose={() => setComposerOpen(false)}
        onCreated={() => {
          setComposerOpen(false);
          void reload();
        }}
      />
    </Screen>
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
        <Pressable
          onPress={onAction}
          disabled={!onAction}
          hitSlop={Spacing.two}
          accessibilityRole={onAction ? 'button' : undefined}>
          <Text style={[theme.typography.label, { color: theme.primary }]}>{action}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Modal form that POSTs a new shipment, then triggers a dashboard reload. */
function ShipmentComposer({
  visible,
  onClose,
  onCreated,
}: {
  visible: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const theme = useTheme();
  const { createShipment, submitting } = useCreateShipment();
  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});

  const clearError = (field: string) =>
    setErrors((current) => ({ ...current, [field]: undefined }));

  const submit = async () => {
    if (submitting) return;
    setErrors({});

    const result = await createShipment({ origin, destination, notes });
    if (!result.ok) {
      setErrors({ [result.field]: result.message });
      return;
    }

    setOrigin('');
    setDestination('');
    setNotes('');
    onCreated();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
      statusBarTranslucent>
      <View style={styles.modalBackdrop}>
        <View style={[styles.modalSheet, { backgroundColor: theme.backgroundElement }]}>
          <View style={styles.modalHeader}>
            <Text style={[theme.typography.heading, { color: theme.text }]}>
              New shipment
            </Text>
            <Pressable
              onPress={onClose}
              hitSlop={Spacing.two}
              accessibilityRole="button"
              accessibilityLabel="Close">
              <Icon name="plus" size={22} color={theme.textSecondary} style={styles.modalCloseIcon} />
            </Pressable>
          </View>

          <View style={styles.modalFields}>
            <Input
              label="Pickup location"
              placeholder="Dar es Salaam, TZ"
              value={origin}
              onChangeText={(value) => {
                setOrigin(value);
                clearError('origin');
              }}
              error={errors.origin}
              autoCapitalize="words"
              returnKeyType="next"
            />
            <Input
              label="Destination"
              placeholder="Nairobi, KE"
              value={destination}
              onChangeText={(value) => {
                setDestination(value);
                clearError('destination');
              }}
              error={errors.destination}
              autoCapitalize="words"
              returnKeyType="next"
            />
            <Input
              label="Notes (optional)"
              placeholder="Fragile, keep upright…"
              value={notes}
              onChangeText={(value) => {
                setNotes(value);
                clearError('notes');
              }}
              error={errors.notes}
              multiline
            />
            {errors.form ? (
              <Text style={[theme.typography.caption, { color: theme.danger }]}>
                {errors.form}
              </Text>
            ) : null}

            <Button size="lg" loading={submitting} onPress={submit}>
              Create shipment
            </Button>
            <Button variant="ghost" onPress={onClose} disabled={submitting}>
              Cancel
            </Button>
          </View>
        </View>
      </View>
    </Modal>
  );
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
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stats: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  statTile: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.two,
    alignItems: 'center',
    gap: Spacing.half,
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
    gap: Spacing.two,
  },
  quickAction: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: 1,
    borderRadius: 14,
    padding: Spacing.three,
  },
  heroActions: {
    flexDirection: 'row',
    gap: Spacing.two,
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
  emptyText: {
    textAlign: 'center',
    marginBottom: Spacing.two,
  },
  activityList: {
    gap: Spacing.three,
  },
  activityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  activityIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: Spacing.four,
    gap: Spacing.three,
    maxHeight: '90%',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  modalCloseIcon: {
    transform: [{ rotate: '45deg' }],
  },
  modalFields: {
    gap: Spacing.three,
  },
});
