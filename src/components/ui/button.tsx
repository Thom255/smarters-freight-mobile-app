import { type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export type ButtonProps = {
  children: ReactNode;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  disabled?: boolean;
  /** Stretch to the full width of the container. */
  fullWidth?: boolean;
  iconLeft?: ReactNode;
  iconRight?: ReactNode;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
};

export function Button({
  children,
  onPress,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  fullWidth = true,
  iconLeft,
  iconRight,
  style,
  textStyle,
}: ButtonProps) {
  const theme = useTheme();
  const inactive = disabled || loading;

  const sizes: Record<ButtonSize, ViewStyle> = {
    sm: { minHeight: 40, paddingHorizontal: Spacing.three },
    md: { minHeight: 50, paddingHorizontal: Spacing.four },
    lg: { minHeight: 56, paddingHorizontal: Spacing.five },
  };

  const variants: Record<ButtonVariant, ViewStyle> = {
    primary: { backgroundColor: theme.primary },
    secondary: { backgroundColor: theme.backgroundSelected },
    outline: {
      backgroundColor: 'transparent',
      borderWidth: 1,
      borderColor: theme.border,
    },
    ghost: { backgroundColor: 'transparent' },
    danger: { backgroundColor: theme.danger },
  };

  const labelColor: Record<ButtonVariant, string> = {
    primary: theme.onPrimary,
    secondary: theme.text,
    outline: theme.primary,
    ghost: theme.primary,
    danger: '#FFFFFF',
  };

  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy: loading }}
      style={({ pressed }) => [
        styles.base,
        sizes[size],
        variants[variant],
        fullWidth && styles.fullWidth,
        inactive && styles.inactive,
        pressed && !inactive && styles.pressed,
        style,
      ]}>
      {loading ? (
        <ActivityIndicator color={labelColor[variant]} size="small" />
      ) : (
        <>
          {iconLeft}
          <Text
            style={[
              { color: labelColor[variant] },
              size === 'sm' ? theme.typography.label : theme.typography.bodyMedium,
              textStyle,
            ]}
            numberOfLines={1}>
            {children}
          </Text>
          {iconRight}
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    borderRadius: Radii.md,
  },
  fullWidth: {
    alignSelf: 'stretch',
  },
  inactive: {
    opacity: 0.55,
  },
  pressed: {
    opacity: 0.85,
    transform: [{ scale: 0.99 }],
  },
});
