/**
 * Central theme hook. Returns the active color scheme plus all design tokens.
 *
 * Light/dark aware:
 * https://docs.expo.dev/guides/color-schemes/
 */

import {
  Colors,
  Fonts,
  Radii,
  Shadows,
  Spacing,
  Typography,
  type ColorScheme,
  type ThemeColor,
} from '@/constants/theme';
import { useThemeMode } from '@/hooks/use-theme-mode';

export function useTheme() {
  const { resolved } = useThemeMode();
  const mode: ColorScheme = resolved;
  const colors = Colors[mode];

  return {
    /** 'light' | 'dark' — handy for picking variant assets. */
    mode,
    /** Flat color tokens, e.g. `theme.primary`. */
    ...colors,
    /** Namespaced access, e.g. `theme.colors[themeColor]`. */
    colors,
    spacing: Spacing,
    radius: Radii,
    typography: Typography,
    shadow: Shadows,
    fonts: Fonts,
  };
}

export type AppTheme = ReturnType<typeof useTheme>;

export type { ThemeColor };
