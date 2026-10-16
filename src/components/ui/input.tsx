import { useState, type ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';

import { Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type InputProps = TextInputProps & {
  label?: string;
  /** Validation message — switches the field into its error state. */
  error?: string | null;
  /** Helper text shown when there is no error. */
  hint?: string;
  iconLeft?: ReactNode;
  /** Rendered inside the field on the right (e.g. a clear button). */
  accessoryRight?: ReactNode;
  containerStyle?: StyleProp<ViewStyle>;
};

export function Input({
  label,
  error,
  hint,
  iconLeft,
  accessoryRight,
  containerStyle,
  style,
  secureTextEntry,
  onFocus,
  onBlur,
  ...rest
}: InputProps) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(!!secureTextEntry);

  const borderColor = error
    ? theme.danger
    : focused
      ? theme.primary
      : theme.border;

  return (
    <View style={[styles.container, containerStyle]}>
      {label ? (
        <Text style={[theme.typography.label, { color: theme.text }]}>{label}</Text>
      ) : null}

      <View
        style={[
          styles.field,
          {
            backgroundColor: theme.backgroundElement,
            borderColor,
            ...theme.shadow.sm,
          },
          focused && { borderColor: theme.primary },
        ]}>
        {iconLeft}

        <TextInput
          style={[
            styles.input,
            { color: theme.text },
            theme.typography.body,
            style,
          ]}
          placeholderTextColor={theme.textSecondary}
          secureTextEntry={hidden}
          onFocus={(event) => {
            setFocused(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          {...rest}
        />

        {secureTextEntry ? (
          <Pressable
            onPress={() => setHidden((value) => !value)}
            hitSlop={Spacing.two}
            accessibilityRole="button"
            accessibilityLabel={hidden ? 'Show password' : 'Hide password'}>
            <Text style={[theme.typography.label, { color: theme.primary }]}>
              {hidden ? 'Show' : 'Hide'}
            </Text>
          </Pressable>
        ) : null}

        {accessoryRight}
      </View>

      {error ? (
        <Text style={[theme.typography.caption, { color: theme.danger }]}>{error}</Text>
      ) : hint ? (
        <Text style={[theme.typography.caption, { color: theme.textSecondary }]}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing.one,
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: 52,
    borderWidth: 1,
    borderRadius: Radii.md,
    paddingHorizontal: Spacing.three,
  },
  input: {
    flex: 1,
    paddingVertical: Spacing.two,
  },
});
