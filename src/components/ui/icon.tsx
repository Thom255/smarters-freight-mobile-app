import { SymbolView, type SFSymbol } from 'expo-symbols';
import type { StyleProp, ViewStyle } from 'react-native';

/**
 * Semantic icon names mapped across platforms:
 * iOS renders SF Symbols, Android/web render Material Symbols.
 * Material names: https://fonts.google.com/icons
 * SF names: https://developer.apple.com/sf-symbols/
 */
const sources = {
  truck: { ios: 'box.truck', android: 'local_shipping', web: 'local_shipping' },
  box: { ios: 'shippingbox', android: 'inventory_2', web: 'inventory_2' },
  bell: { ios: 'bell', android: 'notifications', web: 'notifications' },
  clock: { ios: 'clock', android: 'schedule', web: 'schedule' },
  hourglass: { ios: 'hourglass', android: 'pending', web: 'pending' },
  arrowRight: { ios: 'arrow.forward', android: 'arrow_forward', web: 'arrow_forward' },
  chevronRight: { ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' },
  chevronLeft: { ios: 'chevron.left', android: 'chevron_left', web: 'chevron_left' },
  chevronDown: { ios: 'chevron.down', android: 'expand_more', web: 'expand_more' },
  person: { ios: 'person', android: 'person', web: 'person' },
  plus: { ios: 'plus', android: 'add', web: 'add' },
  search: { ios: 'magnifyingglass', android: 'search', web: 'search' },
  swap: { ios: 'arrow.left.arrow.right', android: 'swap_horiz', web: 'swap_horiz' },
  card: { ios: 'creditcard', android: 'payments', web: 'payments' },
  check: { ios: 'checkmark.circle', android: 'check_circle', web: 'check_circle' },
  checkSeal: { ios: 'checkmark.seal', android: 'done_all', web: 'done_all' },
  alert: { ios: 'exclamationmark.triangle', android: 'warning', web: 'warning' },
  error: { ios: 'exclamationmark.circle', android: 'error', web: 'error' },
  info: { ios: 'info.circle', android: 'info', web: 'info' },
  eye: { ios: 'eye', android: 'visibility', web: 'visibility' },
  settings: { ios: 'gearshape', android: 'settings', web: 'settings' },
  logout: {
    ios: 'rectangle.portrait.and.arrow.right',
    android: 'logout',
    web: 'logout',
  },
  sliders: { ios: 'slider.horizontal.3', android: 'tune', web: 'tune' },
  pin: { ios: 'mappin', android: 'place', web: 'place' },
  route: { ios: 'map', android: 'route', web: 'route' },
  chat: { ios: 'bubble.left', android: 'support_agent', web: 'support_agent' },
  warehouse: { ios: 'building.2', android: 'warehouse', web: 'warehouse' },
  grid: { ios: 'square.grid.2x2', android: 'dashboard', web: 'dashboard' },
  flag: { ios: 'flag', android: 'flag', web: 'flag' },
} as const satisfies Record<string, { ios: SFSymbol; android: string; web: string }>;

export type IconName = keyof typeof sources;

export type IconProps = {
  name: IconName;
  size?: number;
  /** Tint color — usually a theme color like `theme.primary`. */
  color?: string;
  style?: StyleProp<ViewStyle>;
};

export function Icon({ name, size = 20, color, style }: IconProps) {
  return (
    <SymbolView name={sources[name]} size={size} tintColor={color} style={style} />
  );
}
