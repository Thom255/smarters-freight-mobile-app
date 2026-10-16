import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import type { ReactNode } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { AuthProvider, useAuth } from '@/hooks/use-auth';
import { useTheme } from '@/hooks/use-theme';
import { ThemeModeProvider, useThemeMode } from '@/hooks/use-theme-mode';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  return (
    <AuthProvider>
      <ThemeModeProvider>
        <AppThemeProvider>
          <AnimatedSplashOverlay />
          <RootNavigator />
        </AppThemeProvider>
      </ThemeModeProvider>
    </AuthProvider>
  );
}

/** Applies the chosen light/dark mode to React Navigation as well. */
function AppThemeProvider({ children }: { children: ReactNode }) {
  const { resolved } = useThemeMode();

  return (
    <ThemeProvider value={resolved === 'dark' ? DarkTheme : DefaultTheme}>
      {children}
    </ThemeProvider>
  );
}

function RootNavigator() {
  const { status } = useAuth();
  const theme = useTheme();

  // Session still hydrating — the splash overlay covers this frame.
  if (status === 'loading') {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: theme.background,
        }}>
        <ActivityIndicator color={theme.primary} />
      </View>
    );
  }

  const authenticated = status === 'authenticated';

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={authenticated}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="design-system" />
      </Stack.Protected>
      <Stack.Protected guard={!authenticated}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
    </Stack>
  );
}
