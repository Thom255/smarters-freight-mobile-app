import { type PropsWithChildren, type ReactNode } from 'react';
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

import { BottomTabInset, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type ScreenVariant = 'default' | 'brand' | 'plain';

export type ScreenProps = PropsWithChildren<{
  /** Background treatment: app background, brand navy, or an elevated surface. */
  variant?: ScreenVariant;
  /** Wrap children in a ScrollView with keyboard handling. */
  scroll?: boolean;
  /** Adds bottom padding so content clears the tab bar. */
  tabBar?: boolean;
  edges?: Edge[];
  /** Pinned above the bottom safe area (e.g. a primary action). */
  footer?: ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
  /** Pull-to-refresh (requires `scroll`). */
  refreshing?: boolean;
  onRefresh?: () => void;
}>;

export function Screen({
  children,
  variant = 'default',
  scroll = false,
  tabBar = false,
  edges = ['top', 'left', 'right'],
  footer,
  contentStyle,
  refreshing = false,
  onRefresh,
}: ScreenProps) {
  const theme = useTheme();

  const background =
    variant === 'brand'
      ? theme.brandNavy
      : variant === 'plain'
        ? theme.backgroundElement
        : theme.background;

  const content = scroll ? (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={[
        styles.scrollContent,
        contentStyle,
        tabBar && { paddingBottom: Spacing.four + BottomTabInset },
      ]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      refreshControl={
        onRefresh ? (
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.primary}
            colors={[theme.primary]}
          />
        ) : undefined
      }>
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.flex, contentStyle]}>{children}</View>
  );

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: background }]} edges={edges}>
      {content}
      {footer ? (
        <View style={[styles.footer, { borderTopColor: theme.divider }]}>{footer}</View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: Spacing.four,
  },
  footer: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
