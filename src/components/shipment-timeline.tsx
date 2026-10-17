import { StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { ShipmentStatus } from '@/lib/shipments';

type Step = { key: ShipmentStatus; label: string; hint: string };

const STEPS: Step[] = [
  { key: 'booked', label: 'Confirmed', hint: 'Load confirmed and ready for pickup.' },
  { key: 'in_transit', label: 'In transit', hint: 'On the road to the destination.' },
  { key: 'delivered', label: 'Delivered', hint: 'Handed over at the destination.' },
];

/** Vertical status stepper shown on the shipment detail screen. */
export function ShipmentTimeline({ status }: { status: ShipmentStatus }) {
  if (status === 'cancelled') {
    return (
      <View style={styles.timeline}>
        <TimelineRow
          label="Confirmed"
          hint="Load was confirmed before cancellation."
          state="done"
          last={false}
        />
        <TimelineRow
          label="Cancelled"
          hint="This shipment was cancelled."
          state="danger"
          last
        />
      </View>
    );
  }

  const activeIndex = STEPS.findIndex((step) => step.key === status);

  return (
    <View style={styles.timeline}>
      {STEPS.map((step, index) => {
        const done = index < activeIndex || status === 'delivered';
        const state = done ? 'done' : index === activeIndex ? 'current' : 'todo';
        return (
          <TimelineRow
            key={step.key}
            label={step.label}
            hint={step.hint}
            state={state}
            last={index === STEPS.length - 1}
          />
        );
      })}
    </View>
  );
}

type RowState = 'done' | 'current' | 'todo' | 'danger';

function TimelineRow({
  label,
  hint,
  state,
  last,
}: {
  label: string;
  hint: string;
  state: RowState;
  last: boolean;
}) {
  const theme = useTheme();

  const nodeColor =
    state === 'danger'
      ? theme.danger
      : state === 'done'
        ? theme.primary
        : state === 'current'
          ? theme.backgroundElement
          : theme.backgroundSelected;
  const nodeBorder =
    state === 'current' ? theme.primary : state === 'todo' ? theme.border : nodeColor;
  const lineColor = state === 'done' ? theme.primary : theme.border;
  const labelColor = state === 'todo' ? theme.textSecondary : theme.text;

  return (
    <View style={styles.row}>
      <View style={styles.rail}>
        <View
          style={[
            styles.node,
            { backgroundColor: nodeColor, borderColor: nodeBorder },
          ]}>
          {state === 'done' ? (
            <Icon name="check" size={14} color={theme.onPrimary} />
          ) : state === 'danger' ? (
            <Icon name="error" size={14} color="#FFFFFF" />
          ) : state === 'current' ? (
            <View style={[styles.pulse, { backgroundColor: theme.primary }]} />
          ) : null}
        </View>
        {!last ? <View style={[styles.line, { backgroundColor: lineColor }]} /> : null}
      </View>

      <View style={styles.copy}>
        <Text style={[theme.typography.bodyMedium, { color: labelColor }]}>{label}</Text>
        <Text style={[theme.typography.caption, { color: theme.textSecondary }]}>{hint}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  timeline: {
    gap: 0,
  },
  row: {
    flexDirection: 'row',
    gap: Spacing.three,
  },
  rail: {
    width: 24,
    alignItems: 'center',
  },
  node: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulse: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  line: {
    width: 2,
    flex: 1,
    minHeight: 22,
    marginVertical: 2,
    borderRadius: 1,
  },
  copy: {
    flex: 1,
    gap: Spacing.half,
    paddingBottom: Spacing.four,
  },
});
