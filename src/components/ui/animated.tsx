import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import Animated, { FadeInDown, FadeIn } from 'react-native-reanimated';

export type FadeInViewProps = {
  children: ReactNode;
  /** Staggers the entrance when rendering a list. */
  index?: number;
  /** 'down' slides up into place (list items); 'fade' is a plain fade. */
  variant?: 'down' | 'fade';
  style?: StyleProp<ViewStyle>;
};

/** Subtle entrance animation for cards and list rows. */
export function FadeInView({
  children,
  index = 0,
  variant = 'down',
  style,
}: FadeInViewProps) {
  const delay = Math.min(index, 8) * 45;
  const entering =
    variant === 'fade'
      ? FadeIn.duration(260).delay(delay)
      : FadeInDown.duration(320).delay(delay).springify().damping(18);

  return (
    <Animated.View entering={entering} style={style}>
      {children}
    </Animated.View>
  );
}
