import { StyleSheet } from 'react-native';

import { MatchList } from '@/components/match-list';
import { Header, Screen } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useMatchBooking, useMatches } from '@/hooks/use-matches';

export default function MatchesScreen() {
  const { user } = useAuth();
  const perspective = user?.role === 'truck_owner' ? 'truck_owner' : 'cargo_owner';
  const { matches, loading, error, reload } = useMatches();
  const { onAccept, submittingId } = useMatchBooking(() => void reload());

  const subtitle =
    matches.length > 0
      ? perspective === 'truck_owner'
        ? `${matches.length} load${matches.length === 1 ? '' : 's'} for your trucks`
        : `${matches.length} truck${matches.length === 1 ? '' : 's'} for your loads`
      : undefined;

  return (
    <Screen scroll tabBar refreshing={loading} onRefresh={() => void reload()} contentStyle={styles.content}>
      <Header title="Matches" subtitle={subtitle} back={false} />
      <MatchList
        matches={matches}
        loading={loading}
        error={error}
        onReload={() => void reload()}
        perspective={perspective}
        onAccept={onAccept}
        acceptingId={submittingId}
        emptyHint={
          perspective === 'truck_owner'
            ? 'Add an available truck or check back once cargo owners post loads.'
            : 'Post a load or check back once trucks become available.'
        }
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
