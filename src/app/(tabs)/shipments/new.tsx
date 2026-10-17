import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { ShipmentForm } from '@/components/shipment-form';
import { Card, FadeInView, Header, Screen } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useCreateShipment } from '@/hooks/use-shipments';
import { useTrucks } from '@/hooks/use-trucks';

/** Full-screen create form for a shipment, including cargo + planning detail. */
export default function NewShipmentScreen() {
  const { createShipment, submitting } = useCreateShipment();
  const { trucks } = useTrucks();

  return (
    <Screen scroll contentStyle={styles.content}>
      <Header title="New shipment" subtitle="Book a load from pickup to delivery" />

      <View style={styles.body}>
        <FadeInView>
          <Card>
            <ShipmentForm
              submitLabel="Create shipment"
              cancelLabel="Discard"
              submitting={submitting}
              trucks={trucks}
              onCancel={() => router.back()}
              onSubmit={async (values) => {
                const result = await createShipment(values);
                if (!result.ok) {
                  return { ok: false, field: result.field, message: result.message };
                }

                router.replace({
                  pathname: '/shipments/[id]',
                  params: { id: result.shipment.id },
                });
                return { ok: true, shipment: result.shipment };
              }}
            />
          </Card>
        </FadeInView>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: Spacing.four,
  },
  body: {
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
  },
});
