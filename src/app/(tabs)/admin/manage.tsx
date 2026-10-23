import { useMemo, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Badge, Button, Card, FadeInView, Header, Icon, Input, Screen, SkeletonList } from '@/components/ui';
import { Radii, Spacing } from '@/constants/theme';
import { useAdminRecords, type AdminRecordTab } from '@/hooks/use-admin-records';
import { useAuth } from '@/hooks/use-auth';
import { useTheme } from '@/hooks/use-theme';
import type {
  AdminAccountStatus,
  AdminBookingRecord,
  AdminCargoRecord,
  AdminShipmentRecord,
  AdminTruckRecord,
  AdminUser,
} from '@/lib/api';
import type { UserRole } from '@/lib/auth-core';
import { formatDate, formatMoney, roleLabel, titleCaseStatus } from '@/lib/marketplace';

const TABS: { key: AdminRecordTab; label: string }[] = [
  { key: 'users', label: 'Users' },
  { key: 'cargo', label: 'Cargo' },
  { key: 'trucks', label: 'Trucks' },
  { key: 'bookings', label: 'Bookings' },
  { key: 'shipments', label: 'Shipments' },
];

const ROLE_OPTIONS: { value: UserRole; label: string }[] = [
  { value: 'cargo_owner', label: 'Cargo' },
  { value: 'truck_owner', label: 'Truck' },
  { value: 'admin', label: 'Admin' },
];

const ROLE_BADGE: Record<string, 'primary' | 'success' | 'warning'> = {
  admin: 'warning',
  cargo_owner: 'primary',
  truck_owner: 'success',
};

type RoleFilter = 'all' | UserRole;
type StatusFilter = 'all' | AdminAccountStatus;

const ROLE_FILTERS: { value: RoleFilter; label: string }[] = [
  { value: 'all', label: 'All roles' },
  { value: 'cargo_owner', label: 'Cargo' },
  { value: 'truck_owner', label: 'Truck' },
  { value: 'admin', label: 'Admin' },
];

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All status' },
  { value: 'active', label: 'Active' },
  { value: 'suspended', label: 'Suspended' },
];

const STATUS_BADGE = (status: string) => {
  const value = status.toLowerCase();
  if (value === 'active' || value === 'accepted' || value === 'delivered' || value === 'paid' || value === 'completed') {
    return 'success' as const;
  }
  if (value === 'pending' || value === 'requested' || value === 'booked' || value === 'in_transit') {
    return 'warning' as const;
  }
  if (value === 'suspended' || value === 'rejected' || value === 'cancelled' || value === 'expired') {
    return 'danger' as const;
  }
  return 'neutral' as const;
};

export default function AdminManageScreen() {
  const theme = useTheme();
  const { user } = useAuth();
  const [tab, setTab] = useState<AdminRecordTab>('users');
  const { lists, loading, refreshing, error, updatingId, reload, updateUser } =
    useAdminRecords(tab);

  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  // Client-side search + filters over the already-fetched full user list —
  // no extra round trip when typing or toggling.
  const [userQuery, setUserQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const filteredUsers = useMemo(() => {
    const query = userQuery.trim().toLowerCase();

    return (lists.users ?? []).filter((account) => {
      if (roleFilter !== 'all' && account.role !== roleFilter) return false;
      if (statusFilter !== 'all' && account.status !== statusFilter) return false;
      if (query === '') return true;

      return (
        account.identifier.toLowerCase().includes(query) ||
        (account.name ?? '').toLowerCase().includes(query) ||
        (account.companyName ?? '').toLowerCase().includes(query)
      );
    });
  }, [lists.users, userQuery, roleFilter, statusFilter]);

  const userFiltersActive =
    userQuery.trim() !== '' || roleFilter !== 'all' || statusFilter !== 'all';

  const runAction = async (id: string, action: () => Promise<void>) => {
    setActionError(null);
    setPendingId(id);

    try {
      await action();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Could not update the account.');
    } finally {
      setPendingId(null);
    }
  };

  let content;

  // Error with NO rows for this tab → the first load failed: full error card.
  // Error WITH rows already on screen (a failed refresh) → keep the rows and
  // show the banner below instead of blanking the list.
  const tabHasRows = lists[tab] !== undefined;

  if (loading) {
    content = <SkeletonList count={4} />;
  } else if (error && !tabHasRows) {
    content = (
      <Card>
        <View style={styles.empty}>
          <View style={[styles.emptyIcon, { backgroundColor: theme.dangerSubtle }]}>
            <Icon name="alert" size={26} color={theme.danger} />
          </View>
          <Text style={[theme.typography.subheading, { color: theme.text }]}>
            Couldn&apos;t load records
          </Text>
          <Text style={[theme.typography.caption, styles.centerText, { color: theme.textSecondary }]}>
            {error}
          </Text>
          <Button fullWidth={false} onPress={() => void reload()}>
            Try again
          </Button>
        </View>
      </Card>
    );
  } else if (tab === 'users') {
    content = filteredUsers.length ? (
      <>
        <View style={styles.filters}>
          <Input
            label="Search users"
            placeholder="Name, email or company"
            value={userQuery}
            onChangeText={setUserQuery}
            autoCapitalize="none"
            autoComplete="off"
            accessibilityLabel="Search users by name, email or company"
          />
          <FilterChips
            options={ROLE_FILTERS}
            active={roleFilter}
            onSelect={setRoleFilter}
            label="Filter by role"
          />
          <FilterChips
            options={STATUS_FILTERS}
            active={statusFilter}
            onSelect={setStatusFilter}
            label="Filter by status"
          />
        </View>

        {userFiltersActive ? (
          <Text style={[theme.typography.caption, styles.filterCount, { color: theme.textSecondary }]}>
            {filteredUsers.length} of {(lists.users ?? []).length} accounts
          </Text>
        ) : null}

        {filteredUsers.map((account, index) => (
          <FadeInView key={account.id} index={index}>
            <UserCard
              account={account}
              isSelf={account.id === user?.id}
              busy={updatingId === account.id || pendingId === account.id}
              onChangeRole={(role) =>
                void runAction(account.id, () => updateUser(account.id, { role }))
              }
              onToggleStatus={() =>
                void runAction(account.id, () =>
                  updateUser(account.id, {
                    status: account.status === 'suspended' ? 'active' : 'suspended',
                  }),
                )
              }
            />
          </FadeInView>
        ))}
      </>
    ) : userFiltersActive ? (
      <Empty
        label="No matching users"
        body="Adjust the search or clear the filters to see every account."
        action={
          <Button
            size="sm"
            variant="outline"
            fullWidth={false}
            onPress={() => {
              setUserQuery('');
              setRoleFilter('all');
              setStatusFilter('all');
            }}>
            Clear filters
          </Button>
        }
      />
    ) : (
      <Empty label="No users" />
    );
  } else if (tab === 'cargo') {
    const rows: AdminCargoRecord[] = lists.cargo ?? [];

    content = rows.length ? (
      rows.map((load, index) => (
        <FadeInView key={load.id} index={index}>
          <Card>
            <View style={styles.row}>
              <View style={styles.flex}>
                <Text style={[theme.typography.bodyMedium, { color: theme.text }]}>
                  {load.reference || load.id}
                </Text>
                <Text style={[theme.typography.caption, { color: theme.textSecondary }]}>
                  {load.pickupLocation} → {load.destination} · {load.cargoType}
                </Text>
              </View>
              <Badge tone={STATUS_BADGE(load.status)}>{titleCaseStatus(load.status)}</Badge>
            </View>
            {load.owner ? (
              <Text style={[theme.typography.caption, styles.meta, { color: theme.textSecondary }]}>
                Owner: {load.owner.name || load.owner.companyName || load.owner.id}
              </Text>
            ) : null}
            {load.budget ? (
              <Text style={[theme.typography.caption, styles.meta, { color: theme.textSecondary }]}>
                Budget: {formatMoney(load.budget, load.currency || 'TZS')}
              </Text>
            ) : null}
          </Card>
        </FadeInView>
      ))
    ) : (
      <Empty label="No cargo" />
    );
  } else if (tab === 'trucks') {
    const rows: AdminTruckRecord[] = lists.trucks ?? [];

    content = rows.length ? (
      rows.map((truck, index) => (
        <FadeInView key={truck.id} index={index}>
          <Card>
            <View style={styles.row}>
              <View style={styles.flex}>
                <Text style={[theme.typography.bodyMedium, { color: theme.text }]}>
                  {truck.registrationNumber}
                </Text>
                <Text style={[theme.typography.caption, { color: theme.textSecondary }]}>
                  {truck.truckType} · {truck.currentLocation || '—'}
                </Text>
              </View>
              <Badge tone={STATUS_BADGE(truck.status)}>{titleCaseStatus(truck.status)}</Badge>
            </View>
            {truck.owner ? (
              <Text style={[theme.typography.caption, styles.meta, { color: theme.textSecondary }]}>
                Owner: {truck.owner.name || truck.owner.companyName || truck.owner.id}
              </Text>
            ) : null}
            {truck.capacityTons ? (
              <Text style={[theme.typography.caption, styles.meta, { color: theme.textSecondary }]}>
                Capacity: {truck.capacityTons} t
              </Text>
            ) : null}
          </Card>
        </FadeInView>
      ))
    ) : (
      <Empty label="No trucks" />
    );
  } else if (tab === 'bookings') {
    const rows: AdminBookingRecord[] = lists.bookings ?? [];

    content = rows.length ? (
      rows.map((booking, index) => (
        <FadeInView key={booking.id} index={index}>
          <Card>
            <View style={styles.row}>
              <View style={styles.flex}>
                <Text style={[theme.typography.bodyMedium, { color: theme.text }]}>
                  {booking.cargo?.reference || 'Booking'}
                </Text>
                <Text style={[theme.typography.caption, { color: theme.textSecondary }]}>
                  {booking.cargo?.pickupLocation} → {booking.cargo?.destination} ·{' '}
                  {booking.truck?.registrationNumber}
                </Text>
              </View>
              <Badge tone={STATUS_BADGE(booking.status)}>{titleCaseStatus(booking.status)}</Badge>
            </View>
            {booking.requester || booking.responder ? (
              <Text style={[theme.typography.caption, styles.meta, { color: theme.textSecondary }]}>
                Parties: {booking.requester?.name || '—'} ↔ {booking.responder?.name || '—'}
              </Text>
            ) : null}
            {booking.price ? (
              <Text style={[theme.typography.caption, styles.meta, { color: theme.textSecondary }]}>
                Price: {formatMoney(booking.price, booking.currency || 'TZS')}
              </Text>
            ) : null}
          </Card>
        </FadeInView>
      ))
    ) : (
      <Empty label="No bookings" />
    );
  } else {
    const rows: AdminShipmentRecord[] = lists.shipments ?? [];

    content = rows.length ? (
      rows.map((shipment, index) => (
        <FadeInView key={shipment.id} index={index}>
          <Card>
            <View style={styles.row}>
              <View style={styles.flex}>
                <Text style={[theme.typography.bodyMedium, { color: theme.text }]}>
                  {shipment.reference || shipment.id}
                </Text>
                <Text style={[theme.typography.caption, { color: theme.textSecondary }]}>
                  {shipment.origin} → {shipment.destination}
                </Text>
              </View>
              <Badge tone={STATUS_BADGE(shipment.status)}>{titleCaseStatus(shipment.status)}</Badge>
            </View>
            {shipment.owner ? (
              <Text style={[theme.typography.caption, styles.meta, { color: theme.textSecondary }]}>
                Owner: {shipment.owner.name || shipment.owner.companyName || shipment.owner.id}
              </Text>
            ) : null}
            {shipment.pickupDate ? (
              <Text style={[theme.typography.caption, styles.meta, { color: theme.textSecondary }]}>
                Pickup: {formatDate(shipment.pickupDate)}
              </Text>
            ) : null}
          </Card>
        </FadeInView>
      ))
    ) : (
      <Empty label="No shipments" />
    );
  }

  return (
    <Screen scroll tabBar refreshing={refreshing} onRefresh={() => void reload()} contentStyle={styles.content}>
      <Header title="System records" back subtitle="Users, cargo, trucks, bookings, shipments" />

      <View style={styles.tabs}>
        {TABS.map((entry) => {
          const active = tab === entry.key;

          return (
            <Pressable
              key={entry.key}
              onPress={() => setTab(entry.key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              style={({ pressed }) => [
                styles.tab,
                active && { backgroundColor: theme.primarySubtle },
                pressed && styles.pressed,
              ]}>
              <Text
                style={[
                  theme.typography.label,
                  { color: active ? theme.primary : theme.textSecondary },
                ]}>
                {entry.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {actionError ? (
        <Text style={[theme.typography.caption, { color: theme.danger }]}>{actionError}</Text>
      ) : null}

      {error && tabHasRows ? (
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
            <Button size="sm" variant="ghost" fullWidth={false} onPress={() => void reload()}>
              Retry
            </Button>
          </View>
        </Card>
      ) : null}

      {content}
    </Screen>
  );
}

function UserCard({
  account,
  isSelf,
  busy,
  onChangeRole,
  onToggleStatus,
}: {
  account: AdminUser;
  isSelf: boolean;
  busy: boolean;
  onChangeRole: (role: UserRole) => void;
  onToggleStatus: () => void;
}) {
  const theme = useTheme();
  const suspended = account.status === 'suspended';
  // Suspension is a consequential account action — it always goes through an
  // explicit confirmation step before the PATCH is fired.
  const [confirming, setConfirming] = useState<null | 'suspend' | 'reactivate'>(null);

  return (
    <Card>
      <View style={styles.row}>
        <View style={styles.flex}>
          <Text style={[theme.typography.bodyMedium, { color: theme.text }]}>
            {account.name || account.identifier}
          </Text>
          <Text style={[theme.typography.caption, { color: theme.textSecondary }]}>
            {account.identifier}
            {account.companyName ? ` · ${account.companyName}` : ''}
          </Text>
        </View>
        <Badge tone={ROLE_BADGE[account.role] ?? 'neutral'}>{roleLabel(account.role)}</Badge>
        <Badge tone={STATUS_BADGE(account.status)} dot>
          {titleCaseStatus(account.status)}
        </Badge>
      </View>

      {account.createdAt ? (
        <Text style={[theme.typography.caption, styles.meta, { color: theme.textSecondary }]}>
          Joined {formatDate(account.createdAt)}
        </Text>
      ) : null}

      <View style={styles.actions}>
        <View style={styles.chips}>
          {ROLE_OPTIONS.map((option) => {
            const active = account.role === option.value;

            return (
              <Pressable
                key={option.value}
                onPress={() => onChangeRole(option.value)}
                disabled={busy || isSelf || active}
                accessibilityRole="button"
                accessibilityState={{ selected: active, disabled: busy || isSelf }}
                style={({ pressed }) => [
                  styles.chip,
                  active && { backgroundColor: theme.primary, borderColor: theme.primary },
                  pressed && styles.pressed,
                ]}>
                <Text
                  style={[
                    theme.typography.overline,
                    { color: active ? theme.onPrimary : theme.textSecondary },
                  ]}>
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {confirming ? (
          <View style={styles.confirmActions}>
            <Button size="sm" variant="ghost" disabled={busy} onPress={() => setConfirming(null)}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant={confirming === 'suspend' ? 'danger' : 'primary'}
              disabled={busy}
              onPress={() => {
                setConfirming(null);
                onToggleStatus();
              }}>
              {confirming === 'suspend' ? 'Yes, suspend' : 'Yes, reactivate'}
            </Button>
          </View>
        ) : (
          <Button
            size="sm"
            variant={suspended ? 'outline' : 'danger'}
            disabled={busy || isSelf}
            onPress={() => setConfirming(suspended ? 'reactivate' : 'suspend')}>
            {suspended ? 'Reactivate' : 'Suspend'}
          </Button>
        )}
      </View>

      {confirming ? (
        <Text style={[theme.typography.caption, styles.meta, { color: theme.textSecondary }]}>
          {confirming === 'suspend'
            ? `Suspend ${account.name || account.identifier}? Existing sessions are rejected and they cannot sign in until reactivated.`
            : `Reactivate ${account.name || account.identifier}? They will be able to sign in again.`}
        </Text>
      ) : null}

      {isSelf ? (
        <Text style={[theme.typography.caption, styles.meta, { color: theme.textSecondary }]}>
          This is your own account — it cannot be changed here.
        </Text>
      ) : null}
    </Card>
  );
}

function Empty({
  label,
  body = 'Nothing to show',
  action,
}: {
  label: string;
  body?: string;
  action?: ReactNode;
}) {
  const theme = useTheme();

  return (
    <Card>
      <View style={styles.empty}>
        <Text style={[theme.typography.subheading, { color: theme.text }]}>{label}</Text>
        <Text style={[theme.typography.caption, { color: theme.textSecondary }]}>{body}</Text>
        {action}
      </View>
    </Card>
  );
}

/** One-tap segmented filter (role / status) over the already-loaded list. */
function FilterChips<T extends string>({
  options,
  active,
  onSelect,
  label,
}: {
  options: { value: T; label: string }[];
  active: T;
  onSelect: (value: T) => void;
  label: string;
}) {
  const theme = useTheme();

  return (
    <View style={styles.chips} accessibilityRole="tab" accessibilityLabel={label}>
      {options.map((option) => {
        const selected = option.value === active;

        return (
          <Pressable
            key={option.value}
            onPress={() => onSelect(option.value)}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            style={({ pressed }) => [
              styles.chip,
              selected && { backgroundColor: theme.primarySubtle, borderColor: theme.primary },
              pressed && styles.pressed,
            ]}>
            <Text
              style={[
                theme.typography.overline,
                { color: selected ? theme.primary : theme.textSecondary },
              ]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.four, gap: Spacing.two },
  filters: { gap: Spacing.two, marginTop: Spacing.one },
  filterCount: { marginTop: Spacing.one },
  confirmActions: { flexDirection: 'row', gap: Spacing.one, flexShrink: 1 },
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one },
  tab: {
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.two,
    borderRadius: Radii.pill,
  },
  pressed: { opacity: 0.7 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  roundIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  flex: { flex: 1 },
  meta: { marginTop: Spacing.one },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  chips: { flexDirection: 'row', gap: Spacing.one, flexShrink: 1 },
  chip: {
    paddingVertical: Spacing.half,
    paddingHorizontal: Spacing.two,
    borderRadius: Radii.pill,
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.12)',
  },
  empty: { alignItems: 'center', gap: Spacing.one, padding: Spacing.two },
  emptyIcon: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  centerText: { textAlign: 'center' },
});
