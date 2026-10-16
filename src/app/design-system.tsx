import { useState, type PropsWithChildren } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import {
  Badge,
  Button,
  Card,
  Header,
  Icon,
  Input,
  Screen,
  type BadgeTone,
  type ButtonVariant,
  type IconName,
} from '@/components/ui';
import {
  Radii,
  Spacing,
  Typography,
  type ThemeColor,
} from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useThemeMode, type ThemeMode } from '@/hooks/use-theme-mode';

const themeModes: { value: ThemeMode; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

const swatches: { label: string; key: ThemeColor }[] = [
  { label: 'Primary', key: 'primary' },
  { label: 'Accent', key: 'accent' },
  { label: 'Navy', key: 'brandNavy' },
  { label: 'Success', key: 'success' },
  { label: 'Warning', key: 'warning' },
  { label: 'Danger', key: 'danger' },
  { label: 'Info', key: 'info' },
  { label: 'Surface', key: 'backgroundElement' },
];

const typeSamples = [
  'display',
  'title',
  'heading',
  'subheading',
  'body',
  'label',
  'caption',
  'overline',
] as const satisfies readonly (keyof typeof Typography)[];

const variants: ButtonVariant[] = ['primary', 'secondary', 'outline', 'ghost', 'danger'];
const tones: BadgeTone[] = ['neutral', 'primary', 'success', 'warning', 'danger', 'info'];
const icons: IconName[] = [
  'truck',
  'box',
  'route',
  'bell',
  'clock',
  'pin',
  'card',
  'check',
  'alert',
  'search',
  'settings',
  'chat',
];

export default function DesignSystemScreen() {
  const theme = useTheme();
  const { mode, resolved, setMode } = useThemeMode();
  const [demoLoading, setDemoLoading] = useState(false);
  const [demoError, setDemoError] = useState<string | null>('This field is required');

  return (
    <Screen scroll contentStyle={styles.content}>
      <Header title="Design system" />

      <Text style={[theme.typography.body, { color: theme.textSecondary }]}>
        Tokens, components and live controls every screen is built from.
      </Text>

      <Section title="Appearance">
        <View style={styles.row}>
          {themeModes.map((entry) => (
            <Button
              key={entry.value}
              fullWidth={false}
              variant={mode === entry.value ? 'primary' : 'outline'}
              onPress={() => void setMode(entry.value)}>
              {entry.label}
            </Button>
          ))}
        </View>
        <Text style={[theme.typography.caption, { color: theme.textSecondary }]}>
          Rendering in {resolved} mode
          {mode === 'system' ? ' (follows your device setting)' : ''} — saved for next
          launch.
        </Text>
      </Section>

      <Section title="Colors">
        <View style={styles.swatchGrid}>
          {swatches.map((swatch) => (
            <View key={swatch.key} style={styles.swatch}>
              <View
                style={[
                  styles.swatchColor,
                  {
                    backgroundColor: theme.colors[swatch.key],
                    ...theme.shadow.sm,
                  },
                ]}
              />
              <Text style={[theme.typography.caption, { color: theme.text }]}>
                {swatch.label}
              </Text>
              <Text style={[theme.typography.caption, { color: theme.textSecondary }]}>
                {theme.colors[swatch.key]}
              </Text>
            </View>
          ))}
        </View>
      </Section>

      <Section title="Typography">
        <View style={styles.stack}>
          {typeSamples.map((sample) => (
            <View key={sample} style={styles.typeRow}>
              <Text style={[theme.typography[sample], { color: theme.text }]}>
                Freight forward, faster
              </Text>
              <Text style={[theme.typography.caption, { color: theme.textSecondary }]}>
                {sample}
              </Text>
            </View>
          ))}
        </View>
      </Section>

      <Section title="Buttons">
        <View style={styles.stack}>
          {variants.map((variant) => (
            <Button key={variant} variant={variant}>
              {variant}
            </Button>
          ))}

          <View style={styles.row}>
            <Button size="sm" variant="secondary" fullWidth={false}>
              Small
            </Button>
            <Button size="md" variant="secondary" fullWidth={false}>
              Medium
            </Button>
            <Button size="lg" variant="secondary" fullWidth={false}>
              Large
            </Button>
          </View>

          <Button loading>Loading</Button>
          <Button disabled>Disabled</Button>
        </View>
      </Section>

      <Section title="Playground">
        <View style={styles.stack}>
          <Text style={[theme.typography.caption, { color: theme.textSecondary }]}>
            Try component states without touching production code.
          </Text>

          <View style={styles.row}>
            <Button
              fullWidth={false}
              variant="secondary"
              onPress={() => setDemoLoading((value) => !value)}>
              {demoLoading ? 'Stop loading' : 'Start loading'}
            </Button>
            <Button
              fullWidth={false}
              variant="secondary"
              onPress={() => setDemoError((value) => (value ? null : 'Something went wrong'))}>
              {demoError ? 'Clear error' : 'Show error'}
            </Button>
          </View>

          <Button loading={demoLoading}>Primary action</Button>
          <Button variant="outline" loading={demoLoading}>
            Outline action
          </Button>

          <Input
            label="Playground field"
            placeholder="Type something"
            defaultValue=""
            error={demoError}
          />
        </View>
      </Section>

      <Section title="Inputs">
        <View style={styles.stack}>
          <Input label="Destination" placeholder="Dar es Salaam, TZ" defaultValue="Dar es Salaam, TZ" />
          <Input label="With error" placeholder="Enter a value" error="This field is required" />
          <Input
            label="Password"
            placeholder="Enter your password"
            secureTextEntry
            hint="Tap Show to reveal"
          />
        </View>
      </Section>

      <Section title="Badges">
        <View style={styles.wrap}>
          {tones.map((tone) => (
            <Badge key={tone} tone={tone} dot>
              {tone}
            </Badge>
          ))}
        </View>
      </Section>

      <Section title="Elevation">
        <View style={styles.row}>
          {(['none', 'sm', 'md', 'lg'] as const).map((level) => (
            <Card key={level} elevation={level} style={styles.elevationCard}>
              <Text style={[theme.typography.label, { color: theme.text }]}>{level}</Text>
            </Card>
          ))}
        </View>
      </Section>

      <Section title="Icons">
        <View style={styles.wrap}>
          {icons.map((name) => (
            <View
              key={name}
              style={[
                styles.iconCell,
                { backgroundColor: theme.backgroundSelected },
              ]}>
              <Icon name={name} size={22} color={theme.primary} />
              <Text style={[theme.typography.caption, { color: theme.textSecondary }]}>
                {name}
              </Text>
            </View>
          ))}
        </View>
      </Section>

      <Section title="Radii">
        <View style={styles.row}>
          {Object.entries(Radii).map(([name, value]) => (
            <View key={name} style={styles.radiusCell}>
              <View
                style={[
                  styles.radiusBox,
                  {
                    borderRadius: value,
                    backgroundColor: theme.primarySubtle,
                    borderColor: theme.primary,
                  },
                ]}
              />
              <Text style={[theme.typography.caption, { color: theme.textSecondary }]}>
                {name}
              </Text>
            </View>
          ))}
        </View>
      </Section>
    </Screen>
  );
}

function Section({ title, children }: PropsWithChildren<{ title: string }>) {
  const theme = useTheme();

  return (
    <View style={styles.section}>
      <Text style={[theme.typography.overline, { color: theme.textSecondary }]}>
        {title.toUpperCase()}
      </Text>
      <Card>{children}</Card>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.four,
    gap: Spacing.three,
  },
  section: {
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  stack: {
    gap: Spacing.three,
  },
  row: {
    flexDirection: 'row',
    gap: Spacing.two,
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  wrap: {
    flexDirection: 'row',
    gap: Spacing.two,
    flexWrap: 'wrap',
  },
  swatchGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.three,
  },
  swatch: {
    width: '21%',
    gap: 2,
  },
  swatchColor: {
    height: 52,
    borderRadius: Radii.md,
    marginBottom: Spacing.one,
  },
  typeRow: {
    gap: Spacing.half,
  },
  elevationCard: {
    flex: 1,
    minWidth: 64,
    alignItems: 'center',
  },
  iconCell: {
    width: 72,
    borderRadius: Radii.md,
    paddingVertical: Spacing.two,
    alignItems: 'center',
    gap: Spacing.half,
  },
  radiusCell: {
    alignItems: 'center',
    gap: Spacing.one,
  },
  radiusBox: {
    width: 44,
    height: 44,
    borderWidth: 1.5,
  },
});
