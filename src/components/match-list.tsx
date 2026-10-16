import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { Badge, Button, Card, FadeInView, Icon, SkeletonList } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { ApiMatch } from '@/lib/api';
import {
  formatDate,
  formatTons,
  MATCH_CATEGORY_TONE,
  titleCaseStatus,
} from '@/lib/marketplace';

export type MatchListProps = {
  matches: ApiMatch[];
  loading: boolean;
  error: string | null;
  onReload: () => void;
  /** Which side the signed-in user owns — decides the highlighted summary. */
  perspective: 'truck_owner' | 'cargo_owner';
  emptyHint: string;
  /** When provided, each match gets a "Book" action. */
  onAccept?: (match: ApiMatch) => void;
  /** Id of the match currently being booked (shows a spinner on its button). */
  acceptingId?: string | null;
};

/** Renders scored truck↔cargo matches with the weighted breakdown. */
export function MatchList({
  matches,
  loading,
  error,
  onReload,
  perspective,
  emptyHint,
  onAccept,
  acceptingId,
}: MatchListProps) {
  const theme = useTheme();

  if (loading && matches.length === 0) {
    return <SkeletonList count={3} />;
  }

  if (error && matches.length === 0) {
    return (
      <Card>
        <View style={styles.emptyState}>
          <View style={[styles.emptyIcon, { backgroundColor: theme.dangerSubtle }]}>
            <Icon name="alert" size={26} color={theme.danger} />
          </View>
          <Text style={[theme.typography.subheading, { color: theme.text }]}>
            Couldn&apos;t load matches
          </Text>
          <Text style={[theme.typography.caption, styles.emptyText, { color: theme.textSecondary }]}>
            {error}
          </Text>
          <Button fullWidth={false} onPress={onReload}>
            Try again
          </Button>
        </View>
      </Card>
    );
  }

  if (matches.length === 0) {
    return (
      <Card>
        <View style={styles.emptyState}>
          <View style={[styles.emptyIcon, { backgroundColor: theme.primarySubtle }]}>
            <Icon name="swap" size={26} color={theme.primary} />
          </View>
          <Text style={[theme.typography.subheading, { color: theme.text }]}>
            No matches yet
          </Text>
          <Text style={[theme.typography.caption, styles.emptyText, { color: theme.textSecondary }]}>
            {emptyHint}
          </Text>
        </View>
      </Card>
    );
  }

  return (
    <>
      {error ? (
        <Text style={[theme.typography.caption, { color: theme.danger, marginBottom: Spacing.two }]}>
          {error} Pull down to retry.
        </Text>
      ) : null}

      {matches.map((match, index) => {
        const counterpartLabel =
          perspective === 'truck_owner'
            ? match.cargo.cargoType
            : `${match.truck.truckType} · ${match.truck.registrationNumber}`;

        return (
          <FadeInView key={match.id} index={index}>
            <Card>
              <View style={styles.topRow}>
                <View style={styles.routeCopy}>
                  <Text style={[theme.typography.bodyMedium, { color: theme.text }]} numberOfLines={1}>
                    {match.cargo.pickupLocation} → {match.cargo.destination}
                  </Text>
                  <Text
                    style={[theme.typography.caption, { color: theme.textSecondary }]}
                    numberOfLines={1}>
                    {counterpartLabel}
                  </Text>
                </View>

                <View style={styles.scoreBlock}>
                  <Badge tone={MATCH_CATEGORY_TONE[match.category]}>
                    {titleCaseStatus(match.category)}
                  </Badge>
                  <View style={[styles.scorePill, { backgroundColor: theme.primarySubtle }]}>
                    <Text style={[theme.typography.subheading, { color: theme.primary }]}>
                      {match.score}
                    </Text>
                  </View>
                </View>
              </View>

              <View style={[styles.metaRow, { borderTopColor: theme.divider }]}>
                <Meta icon="box" text={`${match.cargo.cargoType} · ${formatTons(match.cargo.weightTons)}`} />
                <Meta
                  icon="truck"
                  text={`${match.truck.truckType} · ${formatTons(match.truck.capacityTons)}`}
                />
                <Meta icon="clock" text={formatDate(match.cargo.pickupDate) || 'Flexible'} />
              </View>

              <View style={styles.breakdown}>
                <ScoreBar label="Route" value={match.scores.route} max={30} />
                <ScoreBar label="Capacity" value={match.scores.capacity} max={25} />
                <ScoreBar label="Date" value={match.scores.date} max={20} />
                <ScoreBar label="Location" value={match.scores.location} max={15} />
                <ScoreBar label="Available" value={match.scores.availability} max={10} />
              </View>

              {onAccept ? (
                <View style={styles.actions}>
                  <Button
                    size="sm"
                    fullWidth={false}
                    loading={acceptingId === match.id}
                    disabled={acceptingId !== null && acceptingId !== undefined}
                    onPress={() => onAccept(match)}
                    iconLeft={<Icon name="check" size={16} color={theme.onPrimary} />}>
                    Book
                  </Button>
                </View>
              ) : null}
            </Card>
          </FadeInView>
        );
      })}
    </>
  );
}

function Meta({ icon, text }: { icon: 'box' | 'truck' | 'clock'; text: string }) {
  const theme = useTheme();

  return (
    <View style={styles.metaItem}>
      <Icon name={icon} size={15} color={theme.textSecondary} />
      <Text style={[theme.typography.caption, { color: theme.textSecondary }]} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

function ScoreBar({ label, value, max }: { label: string; value: number; max: number }) {
  const theme = useTheme();
  const ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withTiming(ratio, {
      duration: 650,
      easing: Easing.out(Easing.cubic),
    });
  }, [ratio, progress]);

  const fillStyle = useAnimatedStyle(() => ({ width: `${progress.value * 100}%` }));

  const color =
    ratio >= 0.75 ? theme.success : ratio >= 0.4 ? theme.primary : theme.warning;

  return (
    <View style={styles.bar}>
      <View style={styles.barHead}>
        <Text style={[theme.typography.caption, { color: theme.textSecondary }]}>{label}</Text>
        <Text style={[theme.typography.label, { color: theme.text }]}>
          {value}/{max}
        </Text>
      </View>
      <View style={[styles.barTrack, { backgroundColor: theme.backgroundSelected }]}>
        <Animated.View style={[styles.barFill, { backgroundColor: color }, fillStyle]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  emptyState: {
    alignItems: 'center',
    gap: Spacing.two,
  },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.one,
  },
  emptyText: {
    textAlign: 'center',
    marginBottom: Spacing.two,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    marginBottom: Spacing.two,
  },
  routeCopy: {
    flex: 1,
    gap: Spacing.half,
  },
  scoreBlock: {
    alignItems: 'flex-end',
    gap: Spacing.one,
  },
  scorePill: {
    minWidth: 44,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
    borderRadius: 12,
    alignItems: 'center',
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.three,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: Spacing.two,
    marginBottom: Spacing.two,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    flexShrink: 1,
  },
  breakdown: {
    gap: Spacing.two,
    marginTop: Spacing.one,
  },
  bar: {
    gap: Spacing.one,
  },
  barHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  barTrack: {
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 4,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    marginTop: Spacing.three,
  },
});
