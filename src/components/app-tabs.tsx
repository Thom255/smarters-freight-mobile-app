import { NativeTabs } from 'expo-router/unstable-native-tabs';

import { useAuth } from '@/hooks/use-auth';
import { useTheme } from '@/hooks/use-theme';

/**
 * Role-aware native tab bar.
 *
 * Admins get the system dashboard (overview, revenue and records) plus their
 * profile. Cargo owners get a "Cargo" tab for their posted loads; truck owners
 * get a "Fleet" tab for their trucks. Only the current role's workspace is
 * mounted, so another role's dashboard cannot be reached by switching tabs.
 */
export default function AppTabs() {
  const theme = useTheme();
  const { user } = useAuth();
  const isTruckOwner = user?.role === 'truck_owner';
  const isAdmin = user?.role === 'admin';

  const profileTrigger = (
    <NativeTabs.Trigger name="profile">
      <NativeTabs.Trigger.Label>Profile</NativeTabs.Trigger.Label>
      <NativeTabs.Trigger.Icon
        sf={{ default: 'person.crop.circle', selected: 'person.crop.circle.fill' }}
        md={{ default: 'account_circle', selected: 'account_circle' }}
      />
    </NativeTabs.Trigger>
  );

  if (isAdmin) {
    return (
      <NativeTabs
        backgroundColor={theme.background}
        indicatorColor={theme.backgroundElement}
        tintColor={theme.primary}
        labelStyle={{ selected: { color: theme.primary } }}>
        <NativeTabs.Trigger name="admin">
          <NativeTabs.Trigger.Label>Admin</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon
            sf={{ default: 'square.grid.2x2', selected: 'square.grid.2x2.fill' }}
            md={{ default: 'dashboard', selected: 'dashboard' }}
          />
        </NativeTabs.Trigger>
        {profileTrigger}
      </NativeTabs>
    );
  }

  return (
    <NativeTabs
      backgroundColor={theme.background}
      indicatorColor={theme.backgroundElement}
      tintColor={theme.primary}
      labelStyle={{ selected: { color: theme.primary } }}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{ default: 'house', selected: 'house.fill' }}
          md={{ default: 'home', selected: 'home_filled' }}
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="shipments">
        <NativeTabs.Trigger.Label>Shipments</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{ default: 'shippingbox', selected: 'shippingbox.fill' }}
          md={{ default: 'inventory_2', selected: 'inventory_2' }}
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="matches">
        <NativeTabs.Trigger.Label>Matches</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{ default: 'arrow.left.arrow.right', selected: 'arrow.left.arrow.right' }}
          md={{ default: 'swap_horiz', selected: 'swap_horiz' }}
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="marketplace">
        <NativeTabs.Trigger.Label>Market</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{ default: 'magnifyingglass', selected: 'magnifyingglass' }}
          md={{ default: 'storefront', selected: 'storefront' }}
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="bookings">
        <NativeTabs.Trigger.Label>Bookings</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{ default: 'checkmark.seal', selected: 'checkmark.seal.fill' }}
          md={{ default: 'fact_check', selected: 'fact_check' }}
        />
      </NativeTabs.Trigger>

      {isTruckOwner ? (
        <NativeTabs.Trigger name="trucks">
          <NativeTabs.Trigger.Label>Fleet</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon
            sf={{ default: 'box.truck', selected: 'box.truck.fill' }}
            md={{ default: 'local_shipping', selected: 'local_shipping' }}
          />
        </NativeTabs.Trigger>
      ) : (
        <NativeTabs.Trigger name="cargo">
          <NativeTabs.Trigger.Label>Cargo</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon
            sf={{ default: 'cube.box', selected: 'cube.box.fill' }}
            md={{ default: 'package_2', selected: 'package_2' }}
          />
        </NativeTabs.Trigger>
      )}

      {profileTrigger}
    </NativeTabs>
  );
}
