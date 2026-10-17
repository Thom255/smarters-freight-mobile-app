import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon, Input } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type FilterOption<T extends string> = { value: T; label: string };

/** Every filterable screen shares the same rule: case-insensitive substring. */
export function matchesQuery(
  query: string,
  ...fields: (string | null | undefined)[]
): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;

  return fields.some((field) => (field ?? '').toLowerCase().includes(needle));
}

type ListControlsProps<T extends string> = {
  query: string;
  onQueryChange: (value: string) => void;
  placeholder: string;
  /** Status chips shown under the search box. */
  options: readonly FilterOption<T>[];
  active: T | 'all';
  onActiveChange: (value: T | 'all') => void;
  allLabel?: string;
};

/**
 * Search box + status chips used by the shipments, trucks and cargo lists so
 * filtering looks and behaves identically everywhere.
 */
export function ListControls<T extends string>({
  query,
  onQueryChange,
  placeholder,
  options,
  active,
  onActiveChange,
  allLabel = 'All',
}: ListControlsProps<T>) {
  const theme = useTheme();

  return (
    <View style={styles.wrap}>
      <Input
        value={query}
        onChangeText={onQueryChange}
        placeholder={placeholder}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        accessibilityLabel={placeholder}
        iconLeft={<Icon name="search" size={18} color={theme.textSecondary} />}
        accessoryRight={
          query.length > 0 ? (
            <Pressable
              onPress={() => onQueryChange('')}
              hitSlop={Spacing.two}
              accessibilityRole="button"
              accessibilityLabel="Clear search">
              <Text style={[theme.typography.label, { color: theme.primary }]}>Clear</Text>
            </Pressable>
          ) : null
        }
      />

      <View style={styles.chips}>
        {[{ value: 'all' as const, label: allLabel }, ...options].map((option) => {
          const selected = option.value === active;
          return (
            <Pressable
              key={option.value}
              onPress={() => onActiveChange(option.value)}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              style={[
                styles.chip,
                { backgroundColor: selected ? theme.primary : theme.backgroundSelected },
              ]}>
              <Text
                style={[
                  theme.typography.caption,
                  { color: selected ? theme.onPrimary : theme.text },
                ]}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: Spacing.two,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.one,
  },
  chip: {
    borderRadius: 999,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
});
