import { router, type Href } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ListControls, matchesQuery } from '@/components/list-controls';
import {
  Badge,
  Button,
  Card,
  FadeInView,
  Header,
  Icon,
  Input,
  Screen,
  SkeletonList,
} from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useCreateTruck, useTrucks, useUpdateTruck } from '@/hooks/use-trucks';
import type { ApiTruck } from '@/lib/api';
import {
  formatDate,
  formatRate,
  formatTons,
  titleCaseStatus,
  TRUCK_STATUSES,
  TRUCK_STATUS_TONE,
  TRUCK_TYPES,
} from '@/lib/marketplace';

const STATUS_FILTERS = TRUCK_STATUSES.map((value) => ({
  value,
  label: titleCaseStatus(value),
}));

export default function TrucksScreen() {
  const theme = useTheme();
  const { trucks, loading, refreshing, error, reload } = useTrucks();
  const { updateTruck } = useUpdateTruck();
  const [composerOpen, setComposerOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<(typeof STATUS_FILTERS)[number]['value'] | 'all'>('all');

  const filtered = useMemo(
    () =>
      (trucks ?? []).filter(
        (truck) =>
          (status === 'all' || truck.status === status) &&
          matchesQuery(
            query,
            truck.registrationNumber,
            truck.truckType,
            truck.currentLocation,
            truck.matchedCargo?.reference,
          ),
      ),
    [trucks, query, status],
  );
  const filtering = query.trim() !== '' || status !== 'all';

  const totalCount = trucks?.length ?? 0;
  const count = filtered.length;
  const subtitle =
    totalCount > 0
      ? filtering
        ? `${count} of ${totalCount} truck${totalCount === 1 ? '' : 's'}`
        : `${totalCount} truck${totalCount === 1 ? '' : 's'} in your fleet`
      : undefined;

  const toggleAvailability = (truck: ApiTruck) => {
    const next = truck.status === 'available' ? 'inactive' : 'available';
    Alert.alert(
      next === 'inactive' ? 'Take truck off the market?' : 'Put truck back on the market?',
      next === 'inactive'
        ? `${truck.registrationNumber} will stop appearing in the marketplace and matching.`
        : `${truck.registrationNumber} will appear as available to cargo owners.`,
      [
        { text: 'Never mind', style: 'cancel' },
        {
          text: next === 'inactive' ? 'Set unavailable' : 'Set available',
          onPress: () => {
            void (async () => {
              setActionError(null);
              const result = await updateTruck(truck.id, { status: next });
              if (result.ok) {
                await reload();
              } else {
                setActionError(result.message);
              }
            })();
          },
        },
      ],
    );
  };

  return (
    <Screen
      scroll
      tabBar
      refreshing={refreshing}
      onRefresh={() => void reload()}
      contentStyle={styles.content}>
      <Header title="My trucks" subtitle={subtitle} back={false} />

      <View style={styles.body}>
        {actionError ? (
          <Text style={[theme.typography.caption, { color: theme.danger }]}>{actionError}</Text>
        ) : null}
        <Button
          onPress={() => setComposerOpen(true)}
          iconLeft={<Icon name="plus" size={18} color={theme.onPrimary} />}>
          Add a truck
        </Button>

        {!loading && totalCount > 0 ? (
          <ListControls
            query={query}
            onQueryChange={setQuery}
            placeholder="Search plate, type or location"
            options={STATUS_FILTERS}
            active={status}
            onActiveChange={setStatus}
            allLabel="All statuses"
          />
        ) : null}

        {error && !trucks ? (
          <Card>
            <View style={styles.emptyState}>
              <View style={[styles.emptyIcon, { backgroundColor: theme.dangerSubtle }]}>
                <Icon name="alert" size={26} color={theme.danger} />
              </View>
              <Text style={[theme.typography.subheading, { color: theme.text }]}>
                Couldn&apos;t load your trucks
              </Text>
              <Text style={[theme.typography.caption, styles.emptyText, { color: theme.textSecondary }]}>
                {error}
              </Text>
              <Button fullWidth={false} onPress={() => void reload()}>
                Try again
              </Button>
            </View>
          </Card>
        ) : loading && !trucks ? (
          <SkeletonList count={3} />
        ) : totalCount === 0 ? (
          <Card>
            <View style={styles.emptyState}>
              <View style={[styles.emptyIcon, { backgroundColor: theme.primarySubtle }]}>
                <Icon name="truck" size={26} color={theme.primary} />
              </View>
              <Text style={[theme.typography.subheading, { color: theme.text }]}>
                No trucks yet
              </Text>
              <Text style={[theme.typography.caption, styles.emptyText, { color: theme.textSecondary }]}>
                Register a truck to start matching it with loads heading back your way —
                fewer empty return trips.
              </Text>
              <Button
                fullWidth={false}
                onPress={() => setComposerOpen(true)}
                iconLeft={<Icon name="plus" size={18} color={theme.onPrimary} />}>
                Add your first truck
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
                No trucks match
              </Text>
              <Text style={[theme.typography.caption, styles.emptyText, { color: theme.textSecondary }]}>
                No truck in your fleet matches these filters.
              </Text>
              <Button
                fullWidth={false}
                variant="outline"
                onPress={() => {
                  setQuery('');
                  setStatus('all');
                }}>
                Clear filters
              </Button>
            </View>
          </Card>
        ) : (
          filtered.map((truck, index) => (
            <FadeInView key={truck.id} index={index}>
              <Card>
                <View style={styles.row}>
                  <View style={[styles.rowIcon, { backgroundColor: theme.primarySubtle }]}>
                    <Icon name="truck" size={18} color={theme.primary} />
                  </View>
                  <View style={styles.rowCopy}>
                    <Text style={[theme.typography.bodyMedium, { color: theme.text }]} numberOfLines={1}>
                      {truck.registrationNumber} · {truck.truckType}
                    </Text>
                    <Text style={[theme.typography.caption, { color: theme.textSecondary }]} numberOfLines={1}>
                      {truck.currentLocation} · {formatTons(truck.capacityTons)}
                      {formatDate(truck.availabilityDate)
                        ? ` · free ${formatDate(truck.availabilityDate)}`
                        : ''}
                    </Text>
                    {truck.driverName || truck.ratePerTon != null ? (
                      <Text style={[theme.typography.caption, { color: theme.textSecondary }]} numberOfLines={1}>
                        {truck.driverName ? truck.driverName : ''}
                        {truck.driverName && truck.ratePerTon != null ? ' · ' : ''}
                        {truck.ratePerTon != null ? formatRate(truck.ratePerTon, 'TZS') : ''}
                      </Text>
                    ) : null}
                    {truck.matchedCargo ? (
                      <Text style={[theme.typography.caption, { color: theme.primary }]} numberOfLines={1}>
                        Booked with {truck.matchedCargo.reference} · {truck.matchedCargo.pickupLocation} →{' '}
                        {truck.matchedCargo.destination}
                      </Text>
                    ) : null}
                  </View>
                  <Badge tone={TRUCK_STATUS_TONE[truck.status]}>
                    {titleCaseStatus(truck.status)}
                  </Badge>
                </View>

                <View style={styles.actions}>
                  <Button
                    variant="outline"
                    size="sm"
                    fullWidth={false}
                    onPress={() => router.push(`/matches/truck/${truck.id}` as Href)}
                    iconLeft={<Icon name="swap" size={16} color={theme.primary} />}>
                    Find loads
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    fullWidth={false}
                    onPress={() => toggleAvailability(truck)}
                    iconLeft={
                      <Icon
                        name={truck.status === 'available' ? 'hourglass' : 'check'}
                        size={16}
                        color={theme.primary}
                      />
                    }>
                    {truck.status === 'available' ? 'Set unavailable' : 'Set available'}
                  </Button>
                </View>
              </Card>
            </FadeInView>
          ))
        )}
      </View>

      <TruckComposer
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

function todayISODate(): string {
  const now = new Date();
  const month = `${now.getMonth() + 1}`.padStart(2, '0');
  const day = `${now.getDate()}`.padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

function TruckComposer({
  visible,
  onClose,
  onCreated,
}: {
  visible: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const theme = useTheme();
  const { createTruck, submitting } = useCreateTruck();

  const [registrationNumber, setRegistrationNumber] = useState('');
  const [truckType, setTruckType] = useState(TRUCK_TYPES[0]);
  const [capacity, setCapacity] = useState('');
  const [currentLocation, setCurrentLocation] = useState('');
  const [availabilityDate, setAvailabilityDate] = useState(todayISODate());
  const [driverName, setDriverName] = useState('');
  const [driverPhone, setDriverPhone] = useState('');
  const [ratePerTon, setRatePerTon] = useState('');
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});

  const clearError = (field: string) =>
    setErrors((current) => ({ ...current, [field]: undefined }));

  const submit = async () => {
    if (submitting) return;
    setErrors({});

    const parsedRate = Number.parseFloat(ratePerTon);
    const result = await createTruck({
      registrationNumber,
      truckType,
      capacityTons: Number.parseFloat(capacity) || 0,
      currentLocation,
      availabilityDate,
      driverName: driverName || undefined,
      driverPhone: driverPhone || undefined,
      ratePerTon: Number.isFinite(parsedRate) && parsedRate > 0 ? parsedRate : undefined,
    });

    if (!result.ok) {
      setErrors({ [result.field]: result.message });
      return;
    }

    setRegistrationNumber('');
    setTruckType(TRUCK_TYPES[0]);
    setCapacity('');
    setCurrentLocation('');
    setAvailabilityDate(todayISODate());
    setDriverName('');
    setDriverPhone('');
    setRatePerTon('');
    onCreated();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.modalBackdrop}>
        <View style={[styles.modalSheet, { backgroundColor: theme.backgroundElement }]}>
          <View style={styles.modalHeader}>
            <Text style={[theme.typography.heading, { color: theme.text }]}>Add a truck</Text>
            <Pressable onPress={onClose} hitSlop={Spacing.two} accessibilityRole="button" accessibilityLabel="Close">
              <Icon name="plus" size={22} color={theme.textSecondary} style={styles.modalCloseIcon} />
            </Pressable>
          </View>

          <ScrollView
            style={styles.modalScroll}
            contentContainerStyle={styles.modalFields}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}>
            <Input
              label="Registration number"
              placeholder="T 123 ABC"
              value={registrationNumber}
              onChangeText={(value) => {
                setRegistrationNumber(value);
                clearError('registrationNumber');
              }}
              error={errors.registrationNumber}
              autoCapitalize="characters"
              returnKeyType="next"
            />

            <View style={styles.field}>
              <Text style={[theme.typography.label, { color: theme.text }]}>Truck type</Text>
              <View style={styles.chips}>
                {TRUCK_TYPES.map((type) => {
                  const selected = type === truckType;
                  return (
                    <Pressable
                      key={type}
                      onPress={() => setTruckType(type)}
                      accessibilityRole="button"
                      style={[
                        styles.chip,
                        {
                          backgroundColor: selected ? theme.primary : theme.backgroundSelected,
                        },
                      ]}>
                      <Text
                        style={[
                          theme.typography.caption,
                          { color: selected ? theme.onPrimary : theme.text },
                        ]}>
                        {type}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <Input
              label="Capacity (tons)"
              placeholder="25"
              value={capacity}
              onChangeText={(value) => {
                setCapacity(value);
                clearError('capacityTons');
              }}
              error={errors.capacityTons}
              keyboardType="decimal-pad"
              returnKeyType="next"
            />

            <Input
              label="Current location"
              placeholder="Dar es Salaam"
              value={currentLocation}
              onChangeText={(value) => {
                setCurrentLocation(value);
                clearError('currentLocation');
              }}
              error={errors.currentLocation}
              autoCapitalize="words"
              returnKeyType="next"
            />

            <Input
              label="Available from (YYYY-MM-DD)"
              placeholder="2026-10-20"
              value={availabilityDate}
              onChangeText={(value) => {
                setAvailabilityDate(value);
                clearError('availabilityDate');
              }}
              error={errors.availabilityDate}
              autoCapitalize="none"
              returnKeyType="next"
            />

            <Input
              label="Driver name (optional)"
              placeholder="Juma Ally"
              value={driverName}
              onChangeText={setDriverName}
              error={errors.driverName}
              autoCapitalize="words"
              returnKeyType="next"
            />

            <Input
              label="Driver phone (optional)"
              placeholder="+255 712 000 000"
              value={driverPhone}
              onChangeText={setDriverPhone}
              error={errors.driverPhone}
              keyboardType="phone-pad"
              returnKeyType="next"
            />

            <Input
              label="Rate per ton (optional)"
              placeholder="45000"
              value={ratePerTon}
              onChangeText={setRatePerTon}
              error={errors.ratePerTon}
              keyboardType="number-pad"
              returnKeyType="done"
              onSubmitEditing={submit}
            />

            {errors.form ? (
              <Text style={[theme.typography.caption, { color: theme.danger }]}>{errors.form}</Text>
            ) : null}

            <Button size="lg" loading={submitting} onPress={submit}>
              Add truck
            </Button>
            <Button variant="ghost" onPress={onClose} disabled={submitting}>
              Cancel
            </Button>
          </ScrollView>
        </View>
      </View>
    </Modal>
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
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    marginTop: Spacing.three,
  },
  field: {
    gap: Spacing.one,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  chip: {
    borderRadius: 999,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
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
  modalScroll: {
    flexGrow: 0,
  },
  modalFields: {
    gap: Spacing.three,
    paddingBottom: Spacing.two,
  },
});
