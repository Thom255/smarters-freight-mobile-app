import { Stack } from 'expo-router';

import { RoleGuard } from '@/components/role-guard';
import { useTheme } from '@/hooks/use-theme';

export default function TrucksLayout() {
  const theme = useTheme();

  return (
    <RoleGuard area="trucks">
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: theme.background },
        }}
      />
    </RoleGuard>
  );
}
