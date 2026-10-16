import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type HeaderProps = {
  title: string;
  subtitle?: string;
  /** Defaults to going back in the stack. Hidden on tab roots. */
  onBack?: () => void;
  /** Set to false to hide the back button (tab root screens). */
  back?: boolean;
  /** Optional node rendered opposite the title (e.g. an action button). */
  action?: ReactNode;
};

/** Back button + title bar for screens pushed onto the root stack. */
export function Header({ title, subtitle, onBack, back = true, action }: HeaderProps) {
  const theme = useTheme();

  return (
    <View style={styles.bar}>
      {back ? (
        <Pressable
          onPress={onBack ?? (() => router.back())}
          hitSlop={Spacing.two}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          style={({ pressed }) => [
            styles.back,
            { backgroundColor: theme.backgroundSelected },
            pressed && styles.pressed,
          ]}>
          <Icon name="chevronLeft" size={22} color={theme.text} />
        </Pressable>
      ) : null}

      <View style={styles.copy}>
        <Text
          style={[theme.typography.heading, { color: theme.text }]}
          numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text
            style={[theme.typography.caption, { color: theme.textSecondary }]}
            numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>

      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  back: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.6,
  },
  copy: {
    flex: 1,
    gap: Spacing.half,
  },
});
