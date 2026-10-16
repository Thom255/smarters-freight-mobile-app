import {
  Tabs,
  TabList,
  TabTrigger,
  TabSlot,
  type TabTriggerSlotProps,
  type TabListProps,
} from 'expo-router/ui';
import { type Href } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon, type IconName } from '@/components/ui/icon';
import { MaxContentWidth, Radii, Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useTheme } from '@/hooks/use-theme';

type TabItem = { name: string; href: Href; label: string; icon: IconName };

export default function AppTabs() {
  const { user } = useAuth();
  const isTruckOwner = user?.role === 'truck_owner';

  const tabs: TabItem[] = [
    { name: 'index', href: '/', label: 'Home', icon: 'grid' },
    { name: 'shipments', href: '/shipments', label: 'Shipments', icon: 'box' },
    { name: 'matches', href: '/matches', label: 'Matches', icon: 'swap' },
    isTruckOwner
      ? { name: 'trucks', href: '/trucks', label: 'Fleet', icon: 'truck' }
      : { name: 'cargo', href: '/cargo', label: 'Cargo', icon: 'box' },
    { name: 'profile', href: '/profile', label: 'Profile', icon: 'person' },
  ];

  return (
    <Tabs style={styles.tabs}>
      <TabList asChild>
        <TabBar>
          {tabs.map((tab) => (
            <TabTrigger key={tab.name} name={tab.name} href={tab.href} asChild>
              <TabButton icon={tab.icon}>{tab.label}</TabButton>
            </TabTrigger>
          ))}
        </TabBar>
      </TabList>
      <TabSlot style={styles.slot} />
    </Tabs>
  );
}

function TabBar(props: TabListProps) {
  const theme = useTheme();

  return (
    <View
      {...props}
      style={[
        styles.barWrap,
        { backgroundColor: theme.background, borderBottomColor: theme.divider },
      ]}>
      <View style={styles.bar}>
        <View style={styles.brand}>
          <View style={[styles.brandMark, { backgroundColor: theme.primary }]}>
            <Icon name="truck" size={16} color={theme.onPrimary} />
          </View>
          <Text style={[theme.typography.bodyMedium, { color: theme.text }]}>
            Smarters Freight
          </Text>
        </View>

        <View style={styles.links}>{props.children}</View>
      </View>
    </View>
  );
}

function TabButton({
  icon,
  children,
  isFocused,
  ...props
}: TabTriggerSlotProps & { icon: IconName }) {
  const theme = useTheme();

  return (
    <Pressable {...props} style={({ pressed }) => [styles.tab, pressed && styles.pressed]}>
      <View
        style={[styles.tabInner, isFocused && { backgroundColor: theme.primarySubtle }]}>
        <Icon name={icon} size={17} color={isFocused ? theme.primary : theme.textSecondary} />
        <Text
          style={[
            theme.typography.label,
            { color: isFocused ? theme.primary : theme.textSecondary },
          ]}>
          {children}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tabs: {
    flex: 1,
  },
  slot: {
    flex: 1,
  },
  barWrap: {
    padding: Spacing.three,
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    width: '100%',
    maxWidth: MaxContentWidth,
  },
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginRight: 'auto',
  },
  brandMark: {
    width: 26,
    height: 26,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  links: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  tab: {
    borderRadius: Radii.pill,
  },
  tabInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingVertical: Spacing.one + 2,
    paddingHorizontal: Spacing.three,
    borderRadius: Radii.pill,
  },
  pressed: {
    opacity: 0.7,
  },
});
