import { useLocalSearchParams } from 'expo-router';
import { StyleSheet } from 'react-native';

import { MatchList } from '@/components/match-list';
import { Header, Screen } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useMatchBooking, useTruckMatches } from '@/hooks/use-matches';

export default function TruckMatchesScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { matches, loading, error, reload } = useTruckMatches(id);
  const { onAccept, submittingId } = useMatchBooking(() => void reload());

  const subtitle =
    matches.length > 0
      ? `${matches.length} load${matches.length === 1 ? '' : 's'} matched`
      : undefined;

  return (
    <Screen scroll refreshing={loading} onRefresh={() => void reload()} contentStyle={styles.content}>
      <Header title="Loads for this truck" subtitle={subtitle} />
      <MatchList
        matches={matches}
        loading={loading}
        error={error}
        onReload={() => void reload()}
        perspective="truck_owner"
        onAccept={onAccept}
        acceptingId={submittingId}
        emptyHint="No posted cargo fits this truck's location, capacity and dates right now."
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
