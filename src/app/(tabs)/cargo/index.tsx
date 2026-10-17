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
import { useCargo, useCreateCargo, useUpdateCargo } from '@/hooks/use-cargo';
import type { ApiCargo } from '@/lib/api';
import {
  CARGO_STATUSES,
  CARGO_STATUS_TONE,
  CARGO_TYPES,
  CURRENCIES,
  formatDate,
  formatMoney,
  formatTons,
  titleCaseStatus,
} from '@/lib/marketplace';

const STATUS_FILTERS = CARGO_STATUSES.map((value) => ({
  value,
  label: titleCaseStatus(value),
}));

export default function CargoScreen() {
  const theme = useTheme();
  const { cargo, loading, refreshing, error, reload } = useCargo();
  const { updateCargo } = useUpdateCargo();
  const [composerOpen, setComposerOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<(typeof STATUS_FILTERS)[number]['value'] | 'all'>('all');

  const filtered = useMemo(
    () =>
      (cargo ?? []).filter(
        (load) =>
          (status === 'all' || load.status === status) &&
          matchesQuery(
            query,
            load.reference,
            load.cargoType,
            load.pickupLocation,
            load.destination,
            load.matchedTruck?.registrationNumber,
          ),
      ),
    [cargo, query, status],
  );
  const filtering = query.trim() !== '' || status !== 'all';

  const totalCount = cargo?.length ?? 0;
  const count = filtered.length;
  const subtitle =
    totalCount > 0
      ? filtering
        ? `${count} of ${totalCount} load${totalCount === 1 ? '' : 's'}`
        : `${totalCount} load${totalCount === 1 ? '' : 's'} posted`
      : undefined;

  const cancel = (load: ApiCargo) => {
    Alert.alert(
      'Cancel this load?',
      `${load.reference} will be marked cancelled and stop being matched to trucks.`,
      [
        { text: 'Keep it', style: 'cancel' },
        {
          text: 'Cancel load',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setActionError(null);
              const result = await updateCargo(load.id, { status: 'cancelled' });
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
      <Header title="My cargo" subtitle={subtitle} back={false} />

      <View style={styles.body}>
        {actionError ? (
          <Text style={[theme.typography.caption, { color: theme.danger }]}>{actionError}</Text>
        ) : null}
        <Button
          onPress={() => setComposerOpen(true)}
          iconLeft={<Icon name="plus" size={18} color={theme.onPrimary} />}>
          Post cargo
        </Button>

        {!loading && totalCount > 0 ? (
          <ListControls
            query={query}
            onQueryChange={setQuery}
            placeholder="Search reference, type or route"
            options={STATUS_FILTERS}
            active={status}
            onActiveChange={setStatus}
            allLabel="All statuses"
          />
        ) : null}

        {error && !cargo ? (
          <Card>
            <View style={styles.emptyState}>
              <View style={[styles.emptyIcon, { backgroundColor: theme.dangerSubtle }]}>
                <Icon name="alert" size={26} color={theme.danger} />
              </View>
              <Text style={[theme.typography.subheading, { color: theme.text }]}>
                Couldn&apos;t load your cargo
              </Text>
              <Text style={[theme.typography.caption, styles.emptyText, { color: theme.textSecondary }]}>
                {error}
              </Text>
              <Button fullWidth={false} onPress={() => void reload()}>
                Try again
              </Button>
            </View>
          </Card>
        ) : loading && !cargo ? (
          <SkeletonList count={3} />
        ) : totalCount === 0 ? (
          <Card>
            <View style={styles.emptyState}>
              <View style={[styles.emptyIcon, { backgroundColor: theme.primarySubtle }]}>
                <Icon name="box" size={26} color={theme.primary} />
              </View>
              <Text style={[theme.typography.subheading, { color: theme.text }]}>
                No cargo posted
              </Text>
              <Text style={[theme.typography.caption, styles.emptyText, { color: theme.textSecondary }]}>
                Post a load with its route, weight and dates — we&apos;ll match it to trucks
                already near your pickup point.
              </Text>
              <Button
                fullWidth={false}
                onPress={() => setComposerOpen(true)}
                iconLeft={<Icon name="plus" size={18} color={theme.onPrimary} />}>
                Post your first load
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
                No loads match
              </Text>
              <Text style={[theme.typography.caption, styles.emptyText, { color: theme.textSecondary }]}>
                Nothing here matches your search or status filter.
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
          filtered.map((load, index) => (
            <FadeInView key={load.id} index={index}>
              <Card>
                <View style={styles.row}>
                  <View style={[styles.rowIcon, { backgroundColor: theme.primarySubtle }]}>
                    <Icon name="box" size={18} color={theme.primary} />
                  </View>
                  <View style={styles.rowCopy}>
                    <Text style={[theme.typography.bodyMedium, { color: theme.text }]} numberOfLines={1}>
                      {load.pickupLocation} → {load.destination}
                    </Text>
                    <Text style={[theme.typography.caption, { color: theme.textSecondary }]} numberOfLines={1}>
                      {load.reference} · {load.cargoType} · {formatTons(load.weightTons)}
                      {formatDate(load.pickupDate) ? ` · ${formatDate(load.pickupDate)}` : ''}
                    </Text>
                    {load.budget != null ? (
                      <Text style={[theme.typography.caption, { color: theme.textSecondary }]} numberOfLines={1}>
                        Budget {formatMoney(load.budget, load.currency)}
                      </Text>
                    ) : null}
                    {load.matchedTruck ? (
                      <Text style={[theme.typography.caption, { color: theme.primary }]} numberOfLines={1}>
                        Booked with {load.matchedTruck.truckType} · {load.matchedTruck.registrationNumber}
                      </Text>
                    ) : null}
                  </View>
                  <Badge tone={CARGO_STATUS_TONE[load.status]}>
                    {titleCaseStatus(load.status)}
                  </Badge>
                </View>

                <View style={styles.actions}>
                  <Button
                    variant="outline"
                    size="sm"
                    fullWidth={false}
                    onPress={() => router.push(`/matches/cargo/${load.id}` as Href)}
                    iconLeft={<Icon name="swap" size={16} color={theme.primary} />}>
                    Find trucks
                  </Button>
                  {load.status !== 'cancelled' && load.status !== 'completed' ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      fullWidth={false}
                      onPress={() => cancel(load)}
                      iconLeft={<Icon name="error" size={16} color={theme.danger} />}>
                      Cancel
                    </Button>
                  ) : null}
                </View>
              </Card>
            </FadeInView>
          ))
        )}
      </View>

      <CargoComposer
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

function CargoComposer({
  visible,
  onClose,
  onCreated,
}: {
  visible: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const theme = useTheme();
  const { createCargo, submitting } = useCreateCargo();

  const [cargoType, setCargoType] = useState(CARGO_TYPES[0]);
  const [weight, setWeight] = useState('');
  const [pickupLocation, setPickupLocation] = useState('');
  const [destination, setDestination] = useState('');
  const [pickupDate, setPickupDate] = useState(todayISODate());
  const [budget, setBudget] = useState('');
  const [currency, setCurrency] = useState(CURRENCIES[0]);
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});

  const clearError = (field: string) =>
    setErrors((current) => ({ ...current, [field]: undefined }));

  const submit = async () => {
    if (submitting) return;
    setErrors({});

    const parsedBudget = Number.parseFloat(budget);
    const result = await createCargo({
      cargoType,
      weightTons: Number.parseFloat(weight) || 0,
      pickupLocation,
      destination,
      pickupDate,
      budget: Number.isFinite(parsedBudget) ? parsedBudget : undefined,
      currency,
      specialRequirements: notes,
    });

    if (!result.ok) {
      setErrors({ [result.field]: result.message });
      return;
    }

    setCargoType(CARGO_TYPES[0]);
    setWeight('');
    setPickupLocation('');
    setDestination('');
    setPickupDate(todayISODate());
    setBudget('');
    setCurrency(CURRENCIES[0]);
    setNotes('');
    onCreated();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.modalBackdrop}>
        <View style={[styles.modalSheet, { backgroundColor: theme.backgroundElement }]}>
          <View style={styles.modalHeader}>
            <Text style={[theme.typography.heading, { color: theme.text }]}>Post cargo</Text>
            <Pressable onPress={onClose} hitSlop={Spacing.two} accessibilityRole="button" accessibilityLabel="Close">
              <Icon name="plus" size={22} color={theme.textSecondary} style={styles.modalCloseIcon} />
            </Pressable>
          </View>

          <ScrollView
            style={styles.modalScroll}
            contentContainerStyle={styles.modalFields}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}>
            <View style={styles.field}>
              <Text style={[theme.typography.label, { color: theme.text }]}>Cargo type</Text>
              <View style={styles.chips}>
                {CARGO_TYPES.map((type) => {
                  const selected = type === cargoType;
                  return (
                    <Pressable
                      key={type}
                      onPress={() => setCargoType(type)}
                      accessibilityRole="button"
                      style={[
                        styles.chip,
                        { backgroundColor: selected ? theme.primary : theme.backgroundSelected },
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
              label="Weight (tons)"
              placeholder="12"
              value={weight}
              onChangeText={(value) => {
                setWeight(value);
                clearError('weightTons');
              }}
              error={errors.weightTons}
              keyboardType="decimal-pad"
              returnKeyType="next"
            />

            <Input
              label="Pickup location"
              placeholder="Dar es Salaam"
              value={pickupLocation}
              onChangeText={(value) => {
                setPickupLocation(value);
                clearError('pickupLocation');
              }}
              error={errors.pickupLocation}
              autoCapitalize="words"
              returnKeyType="next"
            />

            <Input
              label="Destination"
              placeholder="Mwanza"
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
              label="Pickup date (YYYY-MM-DD)"
              placeholder="2026-10-20"
              value={pickupDate}
              onChangeText={(value) => {
                setPickupDate(value);
                clearError('pickupDate');
              }}
              error={errors.pickupDate}
              autoCapitalize="none"
              returnKeyType="next"
            />

            <Input
              label="Budget (optional)"
              placeholder="1200000"
              value={budget}
              onChangeText={setBudget}
              error={errors.budget}
              keyboardType="number-pad"
              returnKeyType="next"
            />

            <View style={styles.field}>
              <Text style={[theme.typography.label, { color: theme.text }]}>Currency</Text>
              <View style={styles.chips}>
                {CURRENCIES.map((code) => {
                  const selected = code === currency;
                  return (
                    <Pressable
                      key={code}
                      onPress={() => setCurrency(code)}
                      accessibilityRole="button"
                      style={[
                        styles.chip,
                        { backgroundColor: selected ? theme.primary : theme.backgroundSelected },
                      ]}>
                      <Text
                        style={[
                          theme.typography.caption,
                          { color: selected ? theme.onPrimary : theme.text },
                        ]}>
                        {code}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <Input
              label="Special requirements (optional)"
              placeholder="Fragile, keep upright…"
              value={notes}
              onChangeText={setNotes}
              error={errors.specialRequirements}
              multiline
            />

            {errors.form ? (
              <Text style={[theme.typography.caption, { color: theme.danger }]}>{errors.form}</Text>
            ) : null}

            <Button size="lg" loading={submitting} onPress={submit}>
              Post cargo
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
