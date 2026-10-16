import { router, type Href } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { Button, Card, Icon, Screen, type IconName } from '@/components/ui';
import { Radii, Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useTheme } from '@/hooks/use-theme';
import { useThemeMode, type ThemeMode } from '@/hooks/use-theme-mode';
import { roleLabel } from '@/lib/marketplace';

const themeModes: { value: ThemeMode; label: string; icon: IconName }[] = [
  { value: 'system', label: 'System', icon: 'settings' },
  { value: 'light', label: 'Light', icon: 'eye' },
  { value: 'dark', label: 'Dark', icon: 'eye' },
];

export default function ProfileScreen() {
  const theme = useTheme();
  const { user, signOut } = useAuth();
  const { mode, setMode } = useThemeMode();
  const [signingOut, setSigningOut] = useState(false);

  const isTruckOwner = user?.role === 'truck_owner';
  const displayName = user?.name?.trim() || 'New member';
  const initials = getInitials(user?.name ?? user?.identifier ?? '');

  const shortcuts: { label: string; hint: string; icon: IconName; route: Href }[] =
    isTruckOwner
      ? [
          { label: 'My fleet', hint: 'Manage your trucks', icon: 'truck', route: '/trucks' },
          { label: 'Shipments', hint: 'Track deliveries', icon: 'box', route: '/shipments' },
          { label: 'Matches', hint: 'Loads for your trucks', icon: 'swap', route: '/matches' },
        ]
      : [
          { label: 'My cargo', hint: 'Loads you posted', icon: 'box', route: '/cargo' },
          { label: 'Shipments', hint: 'Track deliveries', icon: 'truck', route: '/shipments' },
          { label: 'Matches', hint: 'Trucks for your loads', icon: 'swap', route: '/matches' },
        ];

  const confirmSignOut = () => {
    Alert.alert('Log out?', 'You will need to sign in again to access your workspace.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Log out',
        style: 'destructive',
        onPress: () => {
          setSigningOut(true);
          void signOut().finally(() => setSigningOut(false));
        },
      },
    ]);
  };

  return (
    <Screen scroll tabBar contentStyle={styles.content}>
      {/* Hero */}
      <View style={[styles.hero, { backgroundColor: theme.brandNavy }]}>
        <View style={[styles.avatar, { backgroundColor: theme.brandNavySurface }]}>
          <Text style={[theme.typography.title, { color: theme.accent }]}>{initials}</Text>
        </View>
        <View style={styles.heroCopy}>
          <Text style={[theme.typography.heading, { color: theme.onBrand }]} numberOfLines={1}>
            {displayName}
          </Text>
          <Text style={[theme.typography.caption, { color: theme.onBrandMuted }]} numberOfLines={1}>
            {user?.identifier ?? 'Not signed in'}
          </Text>
        </View>
        <View style={[styles.rolePill, { backgroundColor: theme.brandNavySurface }]}>
          <Icon
            name={isTruckOwner ? 'truck' : 'box'}
            size={14}
            color={theme.accent}
          />
          <Text style={[theme.typography.label, { color: theme.onBrand }]}>
            {roleLabel(user?.role)}
          </Text>
        </View>
      </View>

      <View style={styles.body}>
        <SectionLabel>Account</SectionLabel>
        <Card>
          <DetailRow label="Name" value={displayName} />
          <Divider />
          <DetailRow label="Company" value={user?.companyName?.trim() || '—'} />
          <Divider />
          <DetailRow label="Contact" value={user?.identifier ?? '—'} />
          <Divider />
          <DetailRow
            label="Member since"
            value={
              user?.createdAt
                ? new Date(user.createdAt).toLocaleDateString(undefined, {
                    month: 'short',
                    year: 'numeric',
                  })
                : '—'
            }
          />
        </Card>

        <SectionLabel>Appearance</SectionLabel>
        <Card>
          <View style={styles.modeRow}>
            {themeModes.map((entry) => {
              const selected = entry.value === mode;
              return (
                <Pressable
                  key={entry.value}
                  onPress={() => void setMode(entry.value)}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  style={[
                    styles.modeButton,
                    {
                      backgroundColor: selected
                        ? theme.primary
                        : theme.backgroundSelected,
                    },
                  ]}>
                  <Icon
                    name={entry.icon}
                    size={16}
                    color={selected ? theme.onPrimary : theme.textSecondary}
                  />
                  <Text
                    style={[
                      theme.typography.label,
                      { color: selected ? theme.onPrimary : theme.text },
                    ]}>
                    {entry.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={[theme.typography.caption, { color: theme.textSecondary }]}>
            {mode === 'system'
              ? 'Follows your device setting.'
              : `Always uses ${mode} mode.`}{' '}
            Saved for next launch.
          </Text>
        </Card>

        <SectionLabel>Workspace</SectionLabel>
        <Card padded={false}>
          {shortcuts.map((item, index) => (
            <View key={item.label}>
              {index > 0 ? <Divider /> : null}
              <LinkRow
                icon={item.icon}
                label={item.label}
                hint={item.hint}
                onPress={() => router.push(item.route)}
              />
            </View>
          ))}
        </Card>

        <SectionLabel>Developer</SectionLabel>
        <Card padded={false}>
          <LinkRow
            icon="grid"
            label="Design system"
            hint="Tokens, components & playground"
            onPress={() => router.push('/design-system')}
          />
        </Card>

        <Button
          variant="danger"
          size="lg"
          loading={signingOut}
          onPress={confirmSignOut}
          iconLeft={<Icon name="logout" size={18} color="#FFFFFF" />}
          style={styles.signOut}>
          Log out
        </Button>

        <Text style={[theme.typography.caption, styles.version, { color: theme.textSecondary }]}>
          Smarters Freight · v1.0.0
        </Text>
      </View>
    </Screen>
  );
}

function getInitials(value: string): string {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'SF';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function SectionLabel({ children }: { children: string }) {
  const theme = useTheme();

  return (
    <Text
      style={[
        theme.typography.overline,
        styles.sectionLabel,
        { color: theme.textSecondary },
      ]}>
      {children.toUpperCase()}
    </Text>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  const theme = useTheme();

  return (
    <View style={styles.detailRow}>
      <Text style={[theme.typography.body, { color: theme.textSecondary }]}>{label}</Text>
      <Text
        style={[theme.typography.bodyMedium, styles.detailValue, { color: theme.text }]}
        numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function LinkRow({
  icon,
  label,
  hint,
  onPress,
}: {
  icon: IconName;
  label: string;
  hint: string;
  onPress: () => void;
}) {
  const theme = useTheme();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.linkRow, pressed && styles.pressed]}>
      <View style={[styles.linkIcon, { backgroundColor: theme.primarySubtle }]}>
        <Icon name={icon} size={18} color={theme.primary} />
      </View>
      <View style={styles.linkCopy}>
        <Text style={[theme.typography.bodyMedium, { color: theme.text }]}>{label}</Text>
        <Text style={[theme.typography.caption, { color: theme.textSecondary }]} numberOfLines={1}>
          {hint}
        </Text>
      </View>
      <Icon name="chevronRight" size={18} color={theme.textSecondary} />
    </Pressable>
  );
}

function Divider() {
  const theme = useTheme();
  return <View style={[styles.divider, { backgroundColor: theme.divider }]} />;
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: Spacing.three,
  },
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.five,
    paddingBottom: Spacing.four,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroCopy: {
    flex: 1,
    gap: Spacing.half,
  },
  rolePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one + 2,
    borderRadius: Radii.pill,
  },
  body: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
    gap: Spacing.two,
  },
  sectionLabel: {
    marginTop: Spacing.three,
    marginBottom: Spacing.one,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
    paddingVertical: Spacing.two,
  },
  detailValue: {
    flexShrink: 1,
    textAlign: 'right',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
  },
  modeRow: {
    flexDirection: 'row',
    gap: Spacing.two,
    marginBottom: Spacing.two,
  },
  modeButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one,
    paddingVertical: Spacing.two,
    borderRadius: Radii.md,
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
  },
  linkIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  linkCopy: {
    flex: 1,
    gap: Spacing.half,
  },
  pressed: {
    opacity: 0.7,
  },
  signOut: {
    marginTop: Spacing.four,
  },
  version: {
    textAlign: 'center',
    marginTop: Spacing.three,
  },
});
