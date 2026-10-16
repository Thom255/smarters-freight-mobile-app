import { type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type BadgeTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info';

export type BadgeProps = {
  children: ReactNode;
  tone?: BadgeTone;
  /** Show a small leading status dot. */
  dot?: boolean;
};

export function Badge({ children, tone = 'neutral', dot = false }: BadgeProps) {
  const theme = useTheme();

  const palette: Record<BadgeTone, { background: string; color: string }> = {
    neutral: { background: theme.backgroundSelected, color: theme.textSecondary },
    primary: { background: theme.primarySubtle, color: theme.primary },
    success: { background: theme.successSubtle, color: theme.success },
    warning: { background: theme.warningSubtle, color: theme.warning },
    danger: { background: theme.dangerSubtle, color: theme.danger },
    info: { background: theme.infoSubtle, color: theme.info },
  };

  const { background, color } = palette[tone];

  return (
    <View style={[styles.base, { backgroundColor: background }]}>
      {dot ? <View style={[styles.dot, { backgroundColor: color }]} /> : null}
      <Text style={[theme.typography.overline, { color }]} numberOfLines={1}>
        {children}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half + 2,
    borderRadius: Radii.pill,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
});
