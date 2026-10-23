import { Stack } from 'expo-router';

// The (auth) group has no index route, so without an explicit anchor expo-
// router picks the launch screen heuristically — that ambiguity is what once
// opened the app on Register. Login is now the declared entry point: a signed-
// out launch always shows Login, and Register/Forgot-password stay reachable
// through their links.
export const unstable_settings = {
  initialRouteName: 'login',
};

export default function AuthLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
