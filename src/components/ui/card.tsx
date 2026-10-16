import { type PropsWithChildren } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Radii, Spacing, type ShadowPreset } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type CardProps = PropsWithChildren<{
  /** Makes the whole card tappable. */
  onPress?: () => void;
  /** 'brand' renders on the navy background (dark surfaces). */
  tone?: 'default' | 'brand' | 'muted';
  elevation?: ShadowPreset;
  padded?: boolean;
  style?: StyleProp<ViewStyle>;
}>;

export function Card({
  children,
  onPress,
  tone = 'default',
  elevation = 'sm',
  padded = true,
  style,
}: CardProps) {
  const theme = useTheme();

  const background =
    tone === 'brand' ? theme.brandNavySurface : tone === 'muted' ? theme.backgroundSelected : theme.backgroundElement;

  const container = [
    styles.base,
    padded && styles.padded,
    {
      backgroundColor: background,
      borderRadius: Radii.lg,
      ...theme.shadow[elevation],
    },
    style,
  ];

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        style={({ pressed }) => [container, pressed && styles.pressed]}>
        {children}
      </Pressable>
    );
  }

  return <View style={container}>{children}</View>;
}

const styles = StyleSheet.create({
  base: {
    overflow: 'hidden',
  },
  padded: {
    padding: Spacing.three,
  },
  pressed: {
    opacity: 0.9,
    transform: [{ scale: 0.995 }],
  },
});
