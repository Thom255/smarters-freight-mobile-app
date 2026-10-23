import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  Badge,
  Button,
  Card,
  FadeInView,
  Header,
  Icon,
  Screen,
  SkeletonList,
  type BadgeTone,
  type IconName,
} from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useAdminOverview } from '@/hooks/use-admin-overview';
import { useAuth } from '@/hooks/use-auth';
import { useRevenue } from '@/hooks/use-revenue';
import { useTheme } from '@/hooks/use-theme';
import type { AdminOverviewPayload, ApiCommission, CommissionStatus, RevenuePayload } from '@/lib/api';
import { formatDate, formatMoney, titleCaseStatus } from '@/lib/marketplace';

const COMMISSION_STATUS_TONE: Record<CommissionStatus, BadgeTone> = {
  pending: 'warning',
  earned: 'primary',
  paid: 'success',
  cancelled: 'neutral',
  refunded: 'danger',
};

/**
 * Admin system dashboard — GET /api/admin/overview and GET /api/admin/revenue.
 *
 * Every figure comes from server-computed totals: users by role/status,
 * cargo/trucks/bookings/shipments by status, and the platform's 8% commission
 * ledger (pending/earned/paid/cancelled/refunded). A role guard and the
 * backend `auth.role:admin` middleware ensure only admins reach this screen;
 * non-admin accounts are redirected by the admin layout and tabs.
 */
export default function RevenueScreen() {
  const theme = useTheme();
  const { user, status: authStatus } = useAuth();
  const { data, loading, refreshing, error, reload } = useRevenue();
  const overview = useAdminOverview();

  const hydrating = authStatus === 'loading';
  const isAdmin = user?.role === 'admin';

  const subtitle = data
    ? `${data.commissionRate}% commission · ${data.totals.completedShipments} shipments completed`
    : overview.data
      ? `${overview.data.users.total} users · ${overview.data.cargo.total} cargo · ${overview.data.trucks.total} trucks`
      : 'System overview';

  let body: ReactNode;

  if (hydrating) {
    body = <SkeletonList count={4} />;
  } else if (!isAdmin) {
    body = (
      <Card>
        <View style={styles.empty}>
          <View style={[styles.emptyIcon, { backgroundColor: theme.infoSubtle }]}>
            <Icon name="info" size={26} color={theme.info} />
          </View>
          <Text style={[theme.typography.subheading, { color: theme.text }]}>
            Administrators only
          </Text>
          <Text style={[theme.typography.caption, styles.centerText, { color: theme.textSecondary }]}>
            Platform revenue and commission settlement are limited to administrator accounts.
          </Text>
          <Button fullWidth={false} onPress={() => router.push('/')}>
            Go to home
          </Button>
        </View>
      </Card>
    );
  } else if (error && !data) {
    body = (
      <Card>
        <View style={styles.empty}>
          <View style={[styles.emptyIcon, { backgroundColor: theme.dangerSubtle }]}>
            <Icon name="alert" size={26} color={theme.danger} />
          </View>
          <Text style={[theme.typography.subheading, { color: theme.text }]}>
            Couldn&apos;t load revenue
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
  } else if (!data || loading) {
    body = <SkeletonList count={4} />;
  } else {
    body = (
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
                <Button
                  variant="ghost"
                  size="sm"
                  fullWidth={false}
                  onPress={() => void reload()}>
                  Retry
                </Button>
              </View>
            </Card>
          </FadeInView>
        ) : null}

        <RevenueBody data={data} />
      </>
    );
  }

  const isRefreshing = refreshing || overview.refreshing;

  return (
    <Screen
      scroll
      tabBar
      refreshing={isRefreshing}
      onRefresh={() => {
        if (!isAdmin) return;
        void reload();
        void overview.reload();
      }}
      contentStyle={styles.content}>
      <Header title="Admin dashboard" back={false} subtitle={subtitle} />
      {isAdmin ? (
        <>
          <OverviewSection state={overview} />
          <ManageCard />
        </>
      ) : null}
      {body}
    </Screen>
  );
}

function RevenueBody({ data }: { data: RevenuePayload }) {
  const theme = useTheme();
  const counts = data.counts;
  const records = data.commissions;
  const currency = data.currency || 'TZS';

  const tiles: { key: string; label: string; value: string; icon: IconName }[] = [
    { key: 'cargoValue', label: 'Cargo value', value: formatMoney(data.totals.cargoValue, currency), icon: 'box' },
    { key: 'live', label: 'Live commission', value: formatMoney(data.totals.liveCommission, currency), icon: 'card' },
    { key: 'pending', label: 'Pending', value: formatMoney(data.totals.pendingCommission, currency), icon: 'hourglass' },
    { key: 'earned', label: 'Earned', value: formatMoney(data.totals.earnedCommission, currency), icon: 'checkSeal' },
    { key: 'paid', label: 'Paid / settled', value: formatMoney(data.totals.paidCommission, currency), icon: 'check' },
    { key: 'shipments', label: 'Completed shipments', value: String(data.totals.completedShipments), icon: 'truck' },
  ];

  return (
    <>
      <SectionHeader title="Totals" />
      <FadeInView index={0}>
        <View style={styles.grid}>
          {tiles.map((tile) => (
            <StatTile
              key={tile.key}
              icon={tile.icon}
              label={tile.label}
              value={tile.value}
            />
          ))}
        </View>
      </FadeInView>

      <FadeInView index={1}>
        <Card>
          <Text style={[theme.typography.subheading, { color: theme.text, marginBottom: Spacing.one }]}>
            How this is counted
          </Text>
          <Text style={[theme.typography.caption, { color: theme.textSecondary }]}>
            Smarters Freight earns {data.commissionRate}% of every agreed transportation price. The
            split is calculated by the backend the moment a booking is accepted, becomes earned when
            the load is delivered, and is only reported as paid once a settlement reference has been
            recorded against it.
          </Text>
          <View style={styles.countBadges}>
            <Badge tone="warning">{counts.pending} pending</Badge>
            <Badge tone="primary">{counts.earned} earned</Badge>
            <Badge tone="success">{counts.paid} paid</Badge>
            <Badge tone="neutral">{counts.cancelled} cancelled</Badge>
            <Badge tone="danger">{counts.refunded} refunded</Badge>
          </View>
          <Text style={[theme.typography.caption, { color: theme.textSecondary }]}>
            Cancelled and refunded records stay here for the audit trail and never count towards
            revenue. {counts.total} record{counts.total === 1 ? '' : 's'} in total.
          </Text>
        </Card>
      </FadeInView>

      <SectionHeader title="Commission records" action={String(records.length)} />

      {records.length === 0 ? (
        <FadeInView index={2}>
          <Card>
            <View style={styles.empty}>
              <View style={[styles.emptyIcon, { backgroundColor: theme.primarySubtle }]}>
                <Icon name="card" size={26} color={theme.primary} />
              </View>
              <Text style={[theme.typography.subheading, { color: theme.text }]}>
                No commission records yet
              </Text>
              <Text style={[theme.typography.caption, styles.centerText, { color: theme.textSecondary }]}>
                Once a booking with an agreed price is accepted, its {data.commissionRate}% split is
                recorded here automatically.
              </Text>
            </View>
          </Card>
        </FadeInView>
      ) : (
        records.map((commission, index) => (
          <FadeInView key={commission.id} index={index + 2}>
            <CommissionCard commission={commission} />
          </FadeInView>
        ))
      )}
    </>
  );
}

function OverviewSection({
  state,
}: {
  state: {
    data: AdminOverviewPayload | null;
    loading: boolean;
    error: string | null;
    reload: () => Promise<void>;
  };
}) {
  const theme = useTheme();
  const { data, loading, error, reload } = state;

  if (loading && !data) {
    return <SkeletonList count={1} />;
  }

  if (error && !data) {
    return (
      <Card>
        <View style={styles.row}>
          <View style={[styles.roundIcon, { backgroundColor: theme.dangerSubtle }]}>
            <Icon name="alert" size={18} color={theme.danger} />
          </View>
          <View style={styles.flex}>
            <Text style={[theme.typography.bodyMedium, { color: theme.text }]}>
              Couldn&apos;t load overview
            </Text>
            <Text style={[theme.typography.caption, { color: theme.textSecondary }]}>{error}</Text>
          </View>
        </View>
      </Card>
    );
  }

  if (!data) return null;

  const u = data.users;
  const tiles = [
    { key: 'users', label: 'Users', value: String(u.total), icon: 'person' as const },
    { key: 'cargo', label: 'Cargo owners', value: String(u.cargoOwners), icon: 'box' as const },
    { key: 'truck', label: 'Truck owners', value: String(u.truckOwners), icon: 'truck' as const },
    { key: 'admins', label: 'Admins', value: String(u.admins), icon: 'flag' as const },
    { key: 'loads', label: 'Cargo listings', value: String(data.cargo.total), icon: 'warehouse' as const },
    { key: 'trucks', label: 'Trucks', value: String(data.trucks.total), icon: 'truck' as const },
    { key: 'bookings', label: 'Bookings', value: String(data.bookings.total), icon: 'checkSeal' as const },
    { key: 'shipments', label: 'Shipments', value: String(data.shipments.total), icon: 'route' as const },
  ];

  return (
    <>
      {/* A failed refresh keeps the last good counts on screen; only this
          compact warning + Retry appear above them. */}
      {error ? (
        <Card>
          <View style={styles.row}>
            <View style={[styles.roundIcon, { backgroundColor: theme.dangerSubtle }]}>
              <Icon name="alert" size={18} color={theme.danger} />
            </View>
            <View style={styles.flex}>
              <Text style={[theme.typography.bodyMedium, { color: theme.text }]}>
                Couldn&apos;t refresh overview
              </Text>
              <Text style={[theme.typography.caption, { color: theme.textSecondary }]}>{error}</Text>
            </View>
            <Button size="sm" variant="ghost" fullWidth={false} onPress={() => void reload()}>
              Retry
            </Button>
          </View>
        </Card>
      ) : null}

      <SectionHeader title="System overview" action={`${u.active} active · ${u.suspended} suspended`} />
      <FadeInView index={0}>
        <View style={styles.grid}>
          {tiles.map((tile) => (
            <StatTile key={tile.key} icon={tile.icon} label={tile.label} value={tile.value} />
          ))}
        </View>
      </FadeInView>
    </>
  );
}

function ManageCard() {
  const theme = useTheme();

  return (
    <FadeInView index={0}>
      <Pressable onPress={() => router.push('/admin/manage')} style={({ pressed }) => [styles.manageCard, pressed && styles.pressed]}>
        <View style={[styles.roundIcon, { backgroundColor: theme.primarySubtle }]}>
          <Icon name="grid" size={18} color={theme.primary} />
        </View>
        <View style={styles.flex}>
          <Text style={[theme.typography.bodyMedium, { color: theme.text }]}>System records</Text>
          <Text style={[theme.typography.caption, { color: theme.textSecondary }]}>
            Browse every user, load, truck, booking and shipment — and manage account roles
          </Text>
        </View>
        <Icon name="chevronRight" size={18} color={theme.textSecondary} />
      </Pressable>
    </FadeInView>
  );
}

function CommissionCard({ commission }: { commission: ApiCommission }) {
  const theme = useTheme();
  const cargo = commission.cargo;
  const currency = commission.currency || 'TZS';
  const paid = commission.status === 'paid';

  const milestone = paid
    ? commission.paidAt
    : commission.status === 'earned'
      ? commission.earnedAt
      : commission.status === 'cancelled'
        ? commission.cancelledAt
        : commission.status === 'refunded'
          ? commission.refundedAt
          : commission.createdAt;

  const settledOn = formatDate(milestone);

  return (
    <Card>
      <View style={styles.cardTop}>
        <View style={styles.routeCopy}>
          <Text style={[theme.typography.bodyMedium, { color: theme.text }]} numberOfLines={1}>
            {cargo?.reference ?? 'Load'}
          </Text>
          <Text style={[theme.typography.caption, { color: theme.textSecondary }]} numberOfLines={1}>
            {cargo ? `${cargo.pickupLocation} → ${cargo.destination}` : 'Load no longer available'}
            {cargo ? ` · ${cargo.cargoType}` : ''}
          </Text>
        </View>
        <Badge tone={COMMISSION_STATUS_TONE[commission.status]}>
          {titleCaseStatus(commission.status)}
        </Badge>
      </View>

      <View style={[styles.amounts, { borderTopColor: theme.divider }]}>
        <AmountRow label="Agreed price" value={formatMoney(commission.cargoPrice, currency)} />
        <AmountRow
          label={`Platform commission (${commission.commissionRate}%)`}
          value={formatMoney(commission.commissionAmount, currency)}
          highlight
        />
        <AmountRow label="Provider net" value={formatMoney(commission.providerNetAmount, currency)} />
      </View>

      <View style={styles.metaRow}>
        <Meta
          icon={paid ? 'check' : 'clock'}
          text={
            paid
              ? `Settled ${settledOn}`
              : commission.status === 'earned'
                ? `Earned ${settledOn}`
                : settledOn
                  ? `Recorded ${settledOn}`
                  : 'Recorded'
          }
        />
        {commission.paymentReference ? (
          <Meta icon="card" text={commission.paymentReference} />
        ) : null}
      </View>

      {commission.status === 'refunded' && commission.refundReason ? (
        <Text style={[theme.typography.caption, { color: theme.danger, marginTop: Spacing.two }]}>
          Refunded: {commission.refundReason}
        </Text>
      ) : null}
    </Card>
  );
}

function AmountRow({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  const theme = useTheme();

  return (
    <View style={styles.amountRow}>
      <Text style={[theme.typography.caption, { color: theme.textSecondary }]}>{label}</Text>
      <Text
        style={[
          highlight ? theme.typography.subheading : theme.typography.bodyMedium,
          { color: highlight ? theme.primary : theme.text },
        ]}>
        {value}
      </Text>
    </View>
  );
}

function StatTile({
  icon,
  label,
  value,
}: {
  icon: IconName;
  label: string;
  value: string;
}) {
  const theme = useTheme();

  return (
    <View
      style={[styles.statTile, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
      <View style={[styles.roundIcon, { backgroundColor: theme.primarySubtle }]}>
        <Icon name={icon} size={18} color={theme.primary} />
      </View>
      <Text
        style={[theme.typography.subheading, { color: theme.text }]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.7}>
        {value}
      </Text>
      <Text style={[theme.typography.caption, { color: theme.textSecondary }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function Meta({ icon, text }: { icon: IconName; text: string }) {
  const theme = useTheme();

  return (
    <View style={styles.metaItem}>
      <Icon name={icon} size={15} color={theme.textSecondary} />
      <Text style={[theme.typography.caption, { color: theme.textSecondary }]} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

function SectionHeader({ title, action }: { title: string; action?: string }) {
  const theme = useTheme();

  return (
    <View style={styles.sectionHeader}>
      <Text style={[theme.typography.subheading, { color: theme.text }]}>{title}</Text>
      {action ? <Badge tone="neutral">{action}</Badge> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.four,
    gap: Spacing.two,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing.two,
    marginBottom: Spacing.one,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  statTile: {
    width: '48%',
    flexGrow: 1,
    flexBasis: '48%',
    borderWidth: 1,
    borderRadius: 14,
    padding: Spacing.three,
    gap: Spacing.one,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.three,
    marginBottom: Spacing.two,
  },
  routeCopy: {
    flex: 1,
    gap: Spacing.half,
  },
  amounts: {
    gap: Spacing.one,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: Spacing.two,
  },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.three,
    marginTop: Spacing.two,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    flexShrink: 1,
  },
  countBadges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.one,
    marginTop: Spacing.two,
    marginBottom: Spacing.two,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  flex: {
    flex: 1,
  },
  roundIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
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
  centerText: {
    textAlign: 'center',
    marginBottom: Spacing.two,
  },
  manageCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: 14,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.08)',
  },
  pressed: {
    opacity: 0.7,
  },
});