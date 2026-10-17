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

export default function ForgotPasswordScreen() {
  const theme = useTheme();
  const { requestPasswordReset } = useAuth();

  const [identifier, setIdentifier] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sentMessage, setSentMessage] = useState<string | null>(null);

  const submit = async () => {
    if (submitting) return;

    setSubmitting(true);
    const result = await requestPasswordReset({ identifier });
    setSubmitting(false);

    if (!result.ok) {
      setError(result.message);
      return;
    }

    setError(null);
    setSentMessage(result.message);
  };

  return (
    <Screen variant="brand" edges={['top', 'left', 'right', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.content}>
          <View style={styles.header}>
            <Pressable
              style={[styles.backButton, { backgroundColor: theme.brandNavySurface }]}
              onPress={() => router.back()}
              hitSlop={Spacing.two}
              accessibilityRole="button"
              accessibilityLabel="Back to sign in">
              <Icon name="chevronRight" size={18} color={theme.onBrand} style={styles.backIcon} />
            </Pressable>

            <Text style={[theme.typography.display, { color: theme.onBrand }]}>
              Forgot password?
            </Text>
            <Text style={[theme.typography.body, styles.tagline]}>
              Enter the email or phone number on your account and we&apos;ll send you
              a link to choose a new password.
            </Text>
          </View>

          <Card elevation="md" style={styles.card}>
            {sentMessage ? (
              <View style={styles.success}>
                <Icon name="checkSeal" size={40} color={theme.primary} />
                <Text style={[theme.typography.heading, { color: theme.text }]}>
                  Check your inbox
                </Text>
                <Text
                  style={[
                    theme.typography.body,
                    styles.successCopy,
                    { color: theme.textSecondary },
                  ]}>
                  {sentMessage}
                </Text>
                <Button size="lg" onPress={() => router.replace('/login')}>
                  Back to sign in
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
                    setError(null);
                  }}
                  error={error}
                  autoCapitalize="none"
                  autoComplete="email"
                  keyboardType="email-address"
                  returnKeyType="done"
                  onSubmitEditing={submit}
                />

                <Button size="lg" loading={submitting} onPress={submit}>
                  Send reset link
                </Button>
              </View>
            )}
          </Card>

          {!sentMessage ? (
            <Pressable
              style={styles.loginRow}
              hitSlop={Spacing.two}
              onPress={() => router.replace('/login')}>
              <Text style={[theme.typography.body, { color: theme.textSecondary }]}>
                Remembered it?{' '}
              </Text>
              <Text style={[theme.typography.bodyMedium, { color: theme.accent }]}>
                Sign in
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
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.two,
  },
  backIcon: {
    transform: [{ rotate: '180deg' }],
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
