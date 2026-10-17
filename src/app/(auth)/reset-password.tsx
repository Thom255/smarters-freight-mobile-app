import { router, useLocalSearchParams } from 'expo-router';
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
import type { AuthField } from '@/lib/auth-core';

type FormErrors = Partial<Record<AuthField, string>>;

/** Route params can be a string or string[] depending on the deep link. */
function firstValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

export default function ResetPasswordScreen() {
  const theme = useTheme();
  const { resetPassword } = useAuth();
  const params = useLocalSearchParams<{ token?: string; identifier?: string }>();

  const token = firstValue(params.token);
  const linkIdentifier = firstValue(params.identifier);

  const [identifier, setIdentifier] = useState(linkIdentifier);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const clearError = (field: AuthField) =>
    setErrors((current) => ({ ...current, [field]: undefined }));

  const submit = async () => {
    if (submitting) return;

    setSubmitting(true);
    const result = await resetPassword({ identifier, token, password, confirm });
    setSubmitting(false);

    if (!result.ok) {
      setErrors({ [result.field]: result.message });
      return;
    }

    setDone(result.message);
  };

  // Opened without a link (or a link missing its token): nothing to reset.
  if (!token && !done) {
    return (
      <Screen variant="brand" edges={['top', 'left', 'right', 'bottom']}>
        <View style={styles.content}>
          <Card elevation="md" style={styles.card}>
            <View style={styles.success}>
              <Icon name="alert" size={40} color={theme.danger} />
              <Text style={[theme.typography.heading, { color: theme.text }]}>
                Link not valid
              </Text>
              <Text
                style={[
                  theme.typography.body,
                  styles.successCopy,
                  { color: theme.textSecondary },
                ]}>
                This password reset link is missing or incomplete. Request a new one
                to continue.
              </Text>
              <Button size="lg" onPress={() => router.replace('/forgot-password')}>
                Request a new link
              </Button>
              <Button
                size="lg"
                variant="ghost"
                onPress={() => router.replace('/login')}>
                Back to sign in
              </Button>
            </View>
          </Card>
        </View>
      </Screen>
    );
  }

  return (
    <Screen variant="brand" edges={['top', 'left', 'right', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.content}>
          <View style={styles.header}>
            <Text style={[theme.typography.display, { color: theme.onBrand }]}>
              New password
            </Text>
            <Text style={[theme.typography.body, styles.tagline]}>
              Choose a new password for your Smarters Freight account.
            </Text>
          </View>

          <Card elevation="md" style={styles.card}>
            {done ? (
              <View style={styles.success}>
                <Icon name="checkSeal" size={40} color={theme.primary} />
                <Text style={[theme.typography.heading, { color: theme.text }]}>
                  Password updated
                </Text>
                <Text
                  style={[
                    theme.typography.body,
                    styles.successCopy,
                    { color: theme.textSecondary },
                  ]}>
                  {done}
                </Text>
                <Button size="lg" onPress={() => router.replace('/login')}>
                  Sign in
                </Button>
              </View>
            ) : (
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
                  label="New password"
                  placeholder="At least 6 characters"
                  value={password}
                  onChangeText={(value) => {
                    setPassword(value);
                    clearError('password');
                  }}
                  error={errors.password}
                  hint="Minimum 6 characters"
                  secureTextEntry
                  autoComplete="new-password"
                  returnKeyType="next"
                />

                <Input
                  label="Confirm password"
                  placeholder="Repeat your new password"
                  value={confirm}
                  onChangeText={(value) => {
                    setConfirm(value);
                    clearError('confirm');
                  }}
                  error={errors.confirm}
                  secureTextEntry
                  autoComplete="new-password"
                  returnKeyType="done"
                  onSubmitEditing={submit}
                />

                {errors.token ? (
                  <Text style={[theme.typography.caption, { color: theme.danger }]}>
                    {errors.token}
                  </Text>
                ) : null}
                {errors.form ? (
                  <Text style={[theme.typography.caption, { color: theme.danger }]}>
                    {errors.form}
                  </Text>
                ) : null}

                <Button size="lg" loading={submitting} onPress={submit}>
                  Reset password
                </Button>
              </View>
            )}
          </Card>

          {!done ? (
            <Pressable
              style={styles.loginRow}
              hitSlop={Spacing.two}
              onPress={() => router.replace('/login')}>
              <Text style={[theme.typography.body, { color: theme.textSecondary }]}>
                Back to{' '}
              </Text>
              <Text style={[theme.typography.bodyMedium, { color: theme.accent }]}>
                sign in
              </Text>
            </Pressable>
          ) : null}
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
    gap: Spacing.four,
  },
  header: {
    gap: Spacing.one,
  },
  tagline: {
    color: '#D5E4F5',
  },
  card: {
    gap: Spacing.one,
  },
  fields: {
    gap: Spacing.three,
  },
  success: {
    alignItems: 'center',
    gap: Spacing.two,
  },
  successCopy: {
    textAlign: 'center',
    marginBottom: Spacing.two,
  },
  loginRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
});
