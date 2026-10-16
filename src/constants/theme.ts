/**
 * Design tokens for Smarters Freight.
 *
 * Everything the UI is built from lives here: colors (light/dark), spacing,
 * radii, typography and shadows. Components should read tokens from
 * `useTheme()` instead of hardcoding values.
 *
 * Docs: https://docs.expo.dev/guides/color-schemes/
 */

import '@/global.css';

import { Platform, type TextStyle, type ViewStyle } from 'react-native';

export const Colors = {
  light: {
    // Base surfaces (kept names from the Expo starter)
    text: '#0B1220',
    background: '#F5F7FB',
    backgroundElement: '#FFFFFF',
    backgroundSelected: '#E7EDF7',
    textSecondary: '#5B6B82',

    // Brand
    primary: '#2563EB',
    primaryPressed: '#1D4ED8',
    primarySubtle: '#E8EFFE',
    onPrimary: '#FFFFFF',
    accent: '#4DA3FF',
    brandNavy: '#0B1F3A',
    brandNavySurface: '#132B4D',
    onBrand: '#FFFFFF',
    onBrandMuted: '#AFC4DA',

    // Lines
    border: '#DFE6F1',
    divider: '#EDF1F8',

    // Feedback
    success: '#15803D',
    successSubtle: '#E7F7EE',
    warning: '#B45309',
    warningSubtle: '#FDF3E4',
    danger: '#DC2626',
    dangerSubtle: '#FDECEC',
    info: '#0369A1',
    infoSubtle: '#E6F6FE',

    // Misc
    overlay: 'rgba(11, 31, 58, 0.55)',
  },
  dark: {
    // Base surfaces
    text: '#EAF0F9',
    background: '#0A0F1A',
    backgroundElement: '#131A2A',
    backgroundSelected: '#1E2739',
    textSecondary: '#94A3B8',

    // Brand
    primary: '#3B82F6',
    primaryPressed: '#2563EB',
    primarySubtle: '#152242',
    onPrimary: '#FFFFFF',
    accent: '#4DA3FF',
    brandNavy: '#081527',
    brandNavySurface: '#10233D',
    onBrand: '#FFFFFF',
    onBrandMuted: '#AFC4DA',

    // Lines
    border: '#22304A',
    divider: '#1A2437',

    // Feedback
    success: '#4ADE80',
    successSubtle: '#0F2A1C',
    warning: '#FBBF24',
    warningSubtle: '#2C2110',
    danger: '#F87171',
    dangerSubtle: '#2E1618',
    info: '#38BDF8',
    infoSubtle: '#0E2533',

    // Misc
    overlay: 'rgba(3, 7, 15, 0.6)',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export type ColorScheme = keyof typeof Colors;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const Radii = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 22,
  pill: 999,
} as const;

/** Type scale. Use with `style={theme.typography.body}` or `ThemedText`. */
export const Typography = {
  display: { fontSize: 34, lineHeight: 40, fontWeight: '800', letterSpacing: 0.2 },
  title: { fontSize: 28, lineHeight: 34, fontWeight: '800' },
  heading: { fontSize: 22, lineHeight: 28, fontWeight: '700' },
  subheading: { fontSize: 18, lineHeight: 24, fontWeight: '700' },
  body: { fontSize: 16, lineHeight: 24, fontWeight: '400' },
  bodyMedium: { fontSize: 16, lineHeight: 24, fontWeight: '600' },
  label: { fontSize: 14, lineHeight: 20, fontWeight: '600' },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '500' },
  overline: { fontSize: 12, lineHeight: 16, fontWeight: '700', letterSpacing: 1 },
} as const satisfies Record<string, TextStyle>;

export type Shadow = ViewStyle;

const shadow = (opacity: number, radius: number, elevation: number): Shadow =>
  Platform.select({
    ios: {
      shadowColor: '#0B1F3A',
      shadowOpacity: opacity,
      shadowOffset: { width: 0, height: Math.max(1, Math.round(radius / 3)) },
      shadowRadius: radius,
    },
    android: { elevation },
    default: {
      boxShadow: `0 ${Math.max(1, Math.round(radius / 3))}px ${radius}px rgba(11, 31, 58, ${opacity})`,
    },
  }) ?? {};

/** Elevation presets. Read them from `useTheme().shadow`. */
export const Shadows = {
  none: {},
  sm: shadow(0.06, 6, 1),
  md: shadow(0.1, 14, 3),
  lg: shadow(0.16, 28, 6),
} as const satisfies Record<string, Shadow>;

export type ShadowPreset = keyof typeof Shadows;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
