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
import { dashboardPathForRole, type AuthField, type UserRole } from '@/lib/auth-core';

type FormErrors = Partial<Record<AuthField, string>>;

const ROLES: { value: Exclude<UserRole, 'admin'>; label: string; hint: string }[] = [
  { value: 'cargo_owner', label: 'I have cargo', hint: 'Post loads and find trucks' },
  { value: 'truck_owner', label: 'I have trucks', hint: 'List trucks and find loads' },
];

export default function RegisterScreen() {
  const theme = useTheme();
  const { signUp } = useAuth();

  const [role, setRole] = useState<Exclude<UserRole, 'admin'>>('cargo_owner');
  const [name, setName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitting, setSubmitting] = useState(false);

  const clearError = (field: AuthField) =>
    setErrors((current) => ({ ...current, [field]: undefined }));

  const submit = async () => {
    if (submitting) return;

    setSubmitting(true);
    const result = await signUp({
      name,
      identifier,
      password,
      confirm,
      role,
      companyName: companyName.trim() || undefined,
    });
    setSubmitting(false);

    if (!result.ok) {
      setErrors({ [result.field]: result.message });
      return;
    }

    // Session is already active — replace so Back never returns here. The
    // landing route comes from the server-verified role, same as sign-in.
    router.replace(dashboardPathForRole(result.user.role));
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
              Create account
            </Text>
            <Text style={[theme.typography.body, styles.tagline]}>
              Join the freight marketplace — match trucks with cargo and cut empty
              return trips.
            </Text>
          </View>

          <Card elevation="md" style={styles.card}>
            <View style={styles.fields}>
              <View style={styles.field}>
                <Text style={[theme.typography.label, { color: theme.text }]}>
                  I&apos;m joining as
                </Text>
                <View style={styles.roles}>
                  {ROLES.map((option) => {
                    const selected = option.value === role;
                    return (
                      <Pressable
                        key={option.value}
                        onPress={() => {
                          setRole(option.value);
                          clearError('role');
                        }}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                        style={[
                          styles.roleCard,
                          {
                            backgroundColor: selected
                              ? theme.primarySubtle
                              : theme.backgroundElement,
                            borderColor: selected ? theme.primary : theme.border,
                          },
                        ]}>
                        <Icon
                          name={option.value === 'truck_owner' ? 'truck' : 'box'}
                          size={20}
                          color={selected ? theme.primary : theme.textSecondary}
                        />
                        <Text
                          style={[
                            theme.typography.bodyMedium,
                            { color: selected ? theme.primary : theme.text },
                          ]}>
                          {option.label}
                        </Text>
                        <Text
                          style={[theme.typography.caption, { color: theme.textSecondary }]}
                          numberOfLines={2}>
                          {option.hint}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                {errors.role ? (
                  <Text style={[theme.typography.caption, { color: theme.danger }]}>
                    {errors.role}
                  </Text>
                ) : null}
              </View>

              <Input
                label="Full name"
                placeholder="Amina Juma"
                value={name}
                onChangeText={(value) => {
                  setName(value);
                  clearError('name');
                }}
                error={errors.name}
                autoCapitalize="words"
                autoComplete="name"
                returnKeyType="next"
              />

              <Input
                label="Company (optional)"
                placeholder="Smarters Logistics"
                value={companyName}
                onChangeText={setCompanyName}
                autoCapitalize="words"
                returnKeyType="next"
              />

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
                placeholder="Repeat your password"
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

              {errors.form ? (
                <Text style={[theme.typography.caption, { color: theme.danger }]}>
                  {errors.form}
                </Text>
              ) : null}

              <Button size="lg" loading={submitting} onPress={submit}>
                Create account
              </Button>
            </View>
          </Card>

          <Pressable
            style={styles.loginRow}
            hitSlop={Spacing.two}
            onPress={() => router.replace('/login')}>
            <Text style={[theme.typography.body, { color: theme.textSecondary }]}>
              Already have an account?{' '}
            </Text>
            <Text style={[theme.typography.bodyMedium, { color: theme.accent }]}>
              Log in
            </Text>
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
  field: {
    gap: Spacing.one,
  },
  roles: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  roleCard: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 14,
    padding: Spacing.three,
    gap: Spacing.one,
  },
  loginRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
});
