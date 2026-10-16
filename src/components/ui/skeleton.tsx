import { useEffect } from 'react';
import {
  StyleSheet,
  View,
  type DimensionValue,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type SkeletonProps = {
  width?: DimensionValue;
  height?: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
};

/** A pulsing placeholder block used while data loads. */
export function Skeleton({
  width = '100%',
  height = 16,
  radius = Radii.sm,
  style,
}: SkeletonProps) {
  const theme = useTheme();
  const progress = useSharedValue(0.45);

  useEffect(() => {
    progress.value = withRepeat(
      withTiming(1, { duration: 750, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
  }, [progress]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: progress.value }));

  return (
    <Animated.View
      style={[
        { width, height, borderRadius: radius, backgroundColor: theme.backgroundSelected },
        animatedStyle,
        style,
      ]}
    />
  );
}

/** Card-shaped skeleton that mirrors the marketplace list rows. */
export function SkeletonCard() {
  const theme = useTheme();

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: theme.backgroundElement, ...theme.shadow.sm },
      ]}>
      <Skeleton width={40} height={40} radius={20} />
      <View style={styles.copy}>
        <Skeleton width="68%" height={14} />
        <Skeleton width="42%" height={12} />
      </View>
      <Skeleton width={56} height={22} radius={11} />
    </View>
  );
}

/** Renders `count` stacked card skeletons for a list loading state. */
export function SkeletonList({ count = 3 }: { count?: number }) {
  return (
    <View style={styles.list}>
      {Array.from({ length: count }, (_, index) => (
        <SkeletonCard key={index} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: Spacing.two,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Radii.lg,
  },
  copy: {
    flex: 1,
    gap: Spacing.two,
  },
});
