import { useLocalSearchParams } from 'expo-router';
import { StyleSheet } from 'react-native';

import { MatchList } from '@/components/match-list';
import { Header, Screen } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useCargoMatches, useMatchBooking } from '@/hooks/use-matches';

export default function CargoMatchesScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { matches, loading, error, reload } = useCargoMatches(id);
  const { onAccept, submittingId } = useMatchBooking(() => void reload());

  const subtitle =
    matches.length > 0
      ? `${matches.length} truck${matches.length === 1 ? '' : 's'} matched`
      : undefined;

  return (
    <Screen scroll refreshing={loading} onRefresh={() => void reload()} contentStyle={styles.content}>
      <Header title="Trucks for this load" subtitle={subtitle} />
      <MatchList
        matches={matches}
        loading={loading}
        error={error}
        onReload={() => void reload()}
        perspective="cargo_owner"
        onAccept={onAccept}
        acceptingId={submittingId}
        emptyHint="No available trucks fit this load's route, weight and dates right now."
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.four,
    gap: Spacing.two,
  },
});
