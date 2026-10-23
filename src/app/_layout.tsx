import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import type { ReactNode } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { AuthProvider, useAuth } from '@/hooks/use-auth';
import { useTheme } from '@/hooks/use-theme';
import { ThemeModeProvider, useThemeMode } from '@/hooks/use-theme-mode';
import { configureApiOrigin } from '@/lib/api';
import { deviceApiOrigin } from '@/lib/api-origin';

SplashScreen.preventAutoHideAsync();

// Resolve the backend origin once at startup — before any screen can fire a
// request — so a device/emulator never falls back to localhost:8001 when
// EXPO_PUBLIC_API_URL is unset. A null origin means .env already governs.
configureApiOrigin(deviceApiOrigin());

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
