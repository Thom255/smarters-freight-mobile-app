import { Stack } from 'expo-router';

import { RoleGuard } from '@/components/role-guard';
import { useTheme } from '@/hooks/use-theme';

export default function AdminLayout() {
  const theme = useTheme();

  return (
    <RoleGuard area="admin">
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: theme.background },
        }}
      />
    </RoleGuard>
  );
}
