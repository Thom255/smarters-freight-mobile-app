import { router } from 'expo-router';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Button, Card, Icon, Input, Screen } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useTheme } from '@/hooks/use-theme';
import { dashboardPathForRole, type AuthField } from '@/lib/auth-core';

type FormErrors = Partial<Record<AuthField, string>>;

export default function LoginScreen() {
  const theme = useTheme();
  const { signIn } = useAuth();

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (submitting) return;

    setSubmitting(true);
    // `replace` keeps the login screen out of history, so Back from the
    // dashboard can never land here again.
    const result = await signIn({ identifier, password });
    setSubmitting(false);

    if (!result.ok) {
      setErrors({ [result.field]: result.message });
      return;
    }

    // The role came back from /api/auth/login (server-verified), not from
    // anything the client supplied.
    router.replace(dashboardPathForRole(result.user.role));
  };

  const clearError = (field: AuthField) =>
    setErrors((current) => ({ ...current, [field]: undefined }));

  return (
    <Screen variant="brand" edges={['top', 'left', 'right', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.content}>
          <View style={styles.brand}>
            <Text style={[theme.typography.display, { color: theme.onBrand }]}>
              SMARTERS
            </Text>
            <Text style={[theme.typography.display, { color: theme.accent }]}>
              FREIGHT
            </Text>
            <Text style={[theme.typography.body, styles.tagline]}>
              Move goods across borders, track every mile.
            </Text>
          </View>

          <Card elevation="md" style={styles.card}>
            <Text style={[theme.typography.heading, { color: theme.text }]}>
              Welcome back
            </Text>
            <Text style={[theme.typography.caption, { color: theme.textSecondary }]}>
              Sign in to manage your shipments.
            </Text>

            <View style={styles.fields}>
              <Input
                label="Email or phone"
                placeholder="you@company.com"
                value={identifier}
                onChangeText={(value) => {
                  setIdentifier(value);
                  clearError('identifier');
                }}
                error={errors.identifier}
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                returnKeyType="next"
              />

              <Input
                label="Password"
                placeholder="Enter your password"
                value={password}
                onChangeText={(value) => {
                  setPassword(value);
                  clearError('password');
                }}
                error={errors.password}
                hint="Minimum 6 characters"
                secureTextEntry
                autoComplete="password"
                returnKeyType="done"
                onSubmitEditing={submit}
              />

              <Pressable
                style={styles.forgot}
                hitSlop={Spacing.two}
                onPress={() => router.push('/forgot-password')}>
                <Text style={[theme.typography.label, { color: theme.primary }]}>
                  Forgot password?
                </Text>
              </Pressable>

              {errors.form ? (
                <Text style={[theme.typography.caption, { color: theme.danger }]}>
                  {errors.form}
                </Text>
              ) : null}

              <Button size="lg" loading={submitting} onPress={submit}>
                Sign in
              </Button>
            </View>
          </Card>

          <Pressable
            style={styles.registerRow}
            hitSlop={Spacing.two}
            onPress={() => router.push('/register')}>
            <Text style={[theme.typography.body, { color: theme.textSecondary }]}>
              Don&apos;t have an account?{' '}
            </Text>
            <Text style={[theme.typography.bodyMedium, { color: theme.accent }]}>
              Register
            </Text>
            <Icon name="chevronRight" size={16} color={theme.accent} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.five,
    gap: Spacing.five,
  },
  brand: {
    alignItems: 'center',
    gap: Spacing.half,
  },
  tagline: {
    color: '#D5E4F5',
    textAlign: 'center',
    marginTop: Spacing.two,
  },
  card: {
    gap: Spacing.one,
  },
  fields: {
    marginTop: Spacing.three,
    gap: Spacing.three,
  },
  forgot: {
    alignSelf: 'flex-end',
  },
  registerRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
});
