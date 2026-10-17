<?php

namespace Tests\Feature;

/**
 * Shipment lifecycle: list/create/show, ownership, status transitions and the
 * shipment_events history the app's timeline renders.
 */
class ShipmentTest extends ApiTestCase
{
    public function test_listing_returns_only_my_shipments_newest_first(): void
    {
        $mine = $this->seedUser();
        $other = $this->seedUser();
        $token = $this->tokenFor($mine['id']);

        $this->seedShipment($mine['id'], ['reference' => 'SF-OLDEST', 'created_at' => '2026-10-01T08:00:00+00:00']);
        $this->seedShipment($mine['id'], ['reference' => 'SF-NEWEST', 'created_at' => '2026-10-09T08:00:00+00:00']);
        $this->seedShipment($other['id'], ['reference' => 'SF-SHOULDNOTAPPEAR']);

        $response = $this->withHeaders($this->bearer($token))->getJson('/api/shipments');

        $response->assertOk()->assertJsonPath('ok', true);
        $references = array_column($response->json('shipments'), 'reference');

        $this->assertSame(['SF-NEWEST', 'SF-OLDEST'], $references);
        $this->assertNotContains('SF-SHOULDNOTAPPEAR', $references);
    }

    public function test_creating_a_shipment_seeds_the_first_timeline_event(): void
    {
        $user = $this->seedUser();
        $token = $this->tokenFor($user['id']);

        $response = $this->withHeaders($this->bearer($token))->postJson('/api/shipments', [
            'origin' => 'Dar es Salaam',
            'destination' => 'Mwanza',
            'notes' => 'Fragile',
        ]);

        $response->assertStatus(201)
            ->assertJsonPath('ok', true)
            ->assertJsonPath('shipment.status', 'booked')
            ->assertJsonPath('shipment.origin', 'Dar es Salaam');

        $this->assertStringStartsWith('SF-', $response->json('shipment.reference'));

        // Every shipment payload carries its timeline, oldest first.
        $events = $response->json('shipment.events');
        $this->assertIsArray($events);
        $this->assertSame('Shipment booked', $events[0]['title']);
    }

    public function test_creating_a_shipment_requires_a_route(): void
    {
        $user = $this->seedUser();
        $token = $this->tokenFor($user['id']);

        $this->withHeaders($this->bearer($token))
            ->postJson('/api/shipments', ['origin' => 'Dar es Salaam'])
            ->assertStatus(422)
            ->assertJsonPath('ok', false)
            ->assertJsonPath('field', 'destination');
    }

    public function test_show_returns_history_with_timestamps_and_actor(): void
    {
        $user = $this->seedUser(['name' => 'Amina Juma']);
        $token = $this->tokenFor($user['id']);
        $shipment = $this->seedShipment($user['id']);

        $this->db->insert('shipment_events', [
            'shipment_id' => $shipment['id'],
            'user_id' => $user['id'],
            'type' => 'in_transit',
            'title' => 'In transit',
            'body' => 'Dar es Salaam → Nairobi',
        ]);

        $response = $this->withHeaders($this->bearer($token))->getJson('/api/shipments/'.$shipment['id']);

        $response->assertOk()->assertJsonPath('ok', true);
        $events = $response->json('shipment.events');

        // 'Shipment booked' from creation + the in-transit entry we just added.
        $this->assertCount(2, $events);
        $this->assertSame('Shipment booked', $events[0]['title']);
        $this->assertSame('In transit', $events[1]['title']);
        $this->assertSame('Amina Juma', $events[1]['actor']);
        $this->assertIsInt($events[1]['createdAt']);
    }

    public function test_show_hides_other_peoples_shipments(): void
    {
        $mine = $this->seedUser();
        $other = $this->seedUser();
        $token = $this->tokenFor($mine['id']);
        $foreign = $this->seedShipment($other['id']);

        $this->withHeaders($this->bearer($token))
            ->getJson('/api/shipments/'.$foreign['id'])
            ->assertStatus(404)
            ->assertJsonPath('field', 'shipment');
    }

    public function test_a_malformed_id_is_a_404_not_a_server_error(): void
    {
        $user = $this->seedUser();
        $token = $this->tokenFor($user['id']);

        $this->withHeaders($this->bearer($token))
            ->getJson('/api/shipments/not-a-uuid')
            ->assertStatus(404)
            ->assertJsonPath('ok', false);

        $this->withHeaders($this->bearer($token))
            ->patchJson('/api/shipments/not-a-uuid', ['status' => 'in_transit'])
            ->assertStatus(404)
            ->assertJsonPath('ok', false);
    }

    public function test_shipments_requires_authentication(): void
    {
        $this->getJson('/api/shipments')->assertStatus(401);
        $this->postJson('/api/shipments', ['origin' => 'A', 'destination' => 'B'])->assertStatus(401);
    }

    public function test_status_moves_forward_and_records_who_did_it(): void
    {
        $user = $this->seedUser(['name' => 'Amina Juma']);
        $token = $this->tokenFor($user['id']);
        $shipment = $this->seedShipment($user['id']);

        $transit = $this->withHeaders($this->bearer($token))
            ->patchJson('/api/shipments/'.$shipment['id'], ['status' => 'in_transit']);

        $transit->assertOk()
            ->assertJsonPath('ok', true)
            ->assertJsonPath('shipment.status', 'in_transit');

        $delivered = $this->withHeaders($this->bearer($token))
            ->patchJson('/api/shipments/'.$shipment['id'], ['status' => 'delivered']);

        $delivered->assertOk()->assertJsonPath('shipment.status', 'delivered');

        $events = $delivered->json('shipment.events');
        $titles = array_column($events, 'title');

        $this->assertSame(['Shipment booked', 'In transit', 'Delivered'], $titles);
        $this->assertSame('Amina Juma', $events[1]['actor']);

        $this->assertSame('delivered', $this->db->selectOne('shipments', ['id' => 'eq.'.$shipment['id']])['status']);
    }

    public function test_invalid_status_transitions_are_rejected(): void
    {
        $user = $this->seedUser();
        $token = $this->tokenFor($user['id']);
        $delivered = $this->seedShipment($user['id'], ['status' => 'delivered']);
        $booked = $this->seedShipment($user['id']);

        // Terminal states never change again.
        $this->withHeaders($this->bearer($token))
            ->patchJson('/api/shipments/'.$delivered['id'], ['status' => 'in_transit'])
            ->assertStatus(422)
            ->assertJsonPath('field', 'status');

        // booked cannot jump straight to delivered.
        $this->withHeaders($this->bearer($token))
            ->patchJson('/api/shipments/'.$booked['id'], ['status' => 'delivered'])
            ->assertStatus(422)
            ->assertJsonPath('field', 'status');

        // Unknown enum value fails validation with the mobile contract shape.
        $this->withHeaders($this->bearer($token))
            ->patchJson('/api/shipments/'.$booked['id'], ['status' => 'teleported'])
            ->assertStatus(422)
            ->assertJsonPath('ok', false)
            ->assertJsonPath('field', 'status');
    }

    public function test_cancellation_is_allowed_from_an_active_state(): void
    {
        $user = $this->seedUser();
        $token = $this->tokenFor($user['id']);
        $shipment = $this->seedShipment($user['id']);

        $response = $this->withHeaders($this->bearer($token))
            ->patchJson('/api/shipments/'.$shipment['id'], ['status' => 'cancelled']);

        $response->assertOk()->assertJsonPath('shipment.status', 'cancelled');

        $event = $response->json('event');
        $this->assertSame('Shipment cancelled', $event['title']);
        // 'cancelled' is not in the shipment_events CHECK list — it logs as 'update'.
        $this->assertSame('update', $event['type']);
    }

    public function test_a_user_cannot_change_another_users_shipment(): void
    {
        $mine = $this->seedUser();
        $other = $this->seedUser();
        $token = $this->tokenFor($mine['id']);
        $foreign = $this->seedShipment($other['id']);

        $this->withHeaders($this->bearer($token))
            ->patchJson('/api/shipments/'.$foreign['id'], ['status' => 'in_transit'])
            ->assertStatus(404);

        $this->assertSame('booked', $this->db->selectOne('shipments', ['id' => 'eq.'.$foreign['id']])['status']);
    }

    public function test_creating_a_shipment_stores_cargo_and_planning_details(): void
    {
        $user = $this->seedUser();
        $token = $this->tokenFor($user['id']);

        $response = $this->withHeaders($this->bearer($token))->postJson('/api/shipments', [
            'origin' => 'Dar es Salaam',
            'destination' => 'Kigali',
            'cargoType' => 'General cargo',
            'cargoDescription' => 'Cement bags on pallets',
            'weightTons' => 24.5,
            'dimensions' => '12 x 2.4 x 2.6 m',
            'pickupDate' => '2026-10-20',
            'deliveryDeadline' => '2026-10-25',
            'bookingReference' => 'BK-7781',
        ]);

        $response->assertStatus(201)
            ->assertJsonPath('ok', true)
            ->assertJsonPath('shipment.cargoType', 'General cargo')
            ->assertJsonPath('shipment.cargoDescription', 'Cement bags on pallets')
            ->assertJsonPath('shipment.weightTons', 24.5)
            ->assertJsonPath('shipment.dimensions', '12 x 2.4 x 2.6 m')
            ->assertJsonPath('shipment.bookingReference', 'BK-7781');

        $this->assertNotNull($response->json('shipment.pickupDate'));
        $this->assertNotNull($response->json('shipment.deliveryDeadline'));

        $stored = $this->db->selectOne('shipments', [
            'reference' => 'eq.'.$response->json('shipment.reference'),
        ]);

        $this->assertSame('2026-10-20', $stored['pickup_date']);
        $this->assertSame('2026-10-25', $stored['delivery_deadline']);
        $this->assertSame('BK-7781', $stored['booking_reference']);
    }

    public function test_creating_rejects_a_delivery_deadline_before_pickup(): void
    {
        $user = $this->seedUser();
        $token = $this->tokenFor($user['id']);

        $this->withHeaders($this->bearer($token))
            ->postJson('/api/shipments', [
                'origin' => 'Dar es Salaam',
                'destination' => 'Mwanza',
                'pickupDate' => '2026-10-25',
                'deliveryDeadline' => '2026-10-20',
            ])
            ->assertStatus(422)
            ->assertJsonPath('field', 'deliveryDeadline');
    }

    public function test_creating_rejects_an_unknown_assigned_truck(): void
    {
        $user = $this->seedUser();
        $token = $this->tokenFor($user['id']);

        $this->withHeaders($this->bearer($token))
            ->postJson('/api/shipments', [
                'origin' => 'Dar es Salaam',
                'destination' => 'Mwanza',
                'assignedTruckId' => '00000000-0000-4000-8000-000000000000',
            ])
            ->assertStatus(422)
            ->assertJsonPath('field', 'assignedTruckId');
    }

    public function test_show_includes_the_assigned_truck_details(): void
    {
        $owner = $this->seedUser();
        $token = $this->tokenFor($owner['id']);
        $truck = $this->seedTruck($owner['id'], [
            'registration_number' => 'T 555 XYZ',
            'truck_type' => 'Flatbed',
            'current_location' => 'Dodoma',
        ]);
        $shipment = $this->seedShipment($owner['id'], ['assigned_truck_id' => $truck['id']]);

        $this->withHeaders($this->bearer($token))
            ->getJson('/api/shipments/'.$shipment['id'])
            ->assertOk()
            ->assertJsonPath('shipment.assignedTruck.registrationNumber', 'T 555 XYZ')
            ->assertJsonPath('shipment.assignedTruck.truckType', 'Flatbed')
            ->assertJsonPath('shipment.assignedTruck.currentLocation', 'Dodoma');
    }

    public function test_details_can_be_edited_while_the_shipment_is_still_booked(): void
    {
        $user = $this->seedUser(['name' => 'Amina Juma']);
        $token = $this->tokenFor($user['id']);
        $shipment = $this->seedShipment($user['id']);

        $response = $this->withHeaders($this->bearer($token))
            ->patchJson('/api/shipments/'.$shipment['id'], [
                'cargoType' => 'Perishables',
                'weightTons' => 8.5,
                'deliveryDeadline' => '2026-11-02',
            ]);

        $response->assertOk()
            ->assertJsonPath('shipment.cargoType', 'Perishables')
            ->assertJsonPath('shipment.weightTons', 8.5)
            ->assertJsonPath('event.title', 'Shipment details updated')
            ->assertJsonPath('event.actor', 'Amina Juma');
    }

    public function test_a_truck_can_be_assigned_while_editing(): void
    {
        $user = $this->seedUser();
        $token = $this->tokenFor($user['id']);
        $truck = $this->seedTruck($user['id'], ['registration_number' => 'T 900 QRS']);
        $shipment = $this->seedShipment($user['id']);

        $this->withHeaders($this->bearer($token))
            ->patchJson('/api/shipments/'.$shipment['id'], ['assignedTruckId' => $truck['id']])
            ->assertOk()
            ->assertJsonPath('shipment.assignedTruckId', $truck['id'])
            ->assertJsonPath('shipment.assignedTruck.registrationNumber', 'T 900 QRS');
    }

    public function test_an_edit_with_no_changes_is_accepted_without_a_history_entry(): void
    {
        $user = $this->seedUser();
        $token = $this->tokenFor($user['id']);
        $shipment = $this->seedShipment($user['id'], ['cargo_type' => 'General cargo']);

        $response = $this->withHeaders($this->bearer($token))
            ->patchJson('/api/shipments/'.$shipment['id'], ['cargoType' => 'General cargo']);

        $response->assertOk()->assertJsonPath('ok', true);
        $this->assertNull($response->json('event'));
    }

    public function test_details_cannot_be_edited_once_the_shipment_is_finished(): void
    {
        $user = $this->seedUser();
        $token = $this->tokenFor($user['id']);
        $shipment = $this->seedShipment($user['id'], ['status' => 'delivered']);

        $this->withHeaders($this->bearer($token))
            ->patchJson('/api/shipments/'.$shipment['id'], ['cargoType' => 'Late edit'])
            ->assertStatus(422)
            ->assertJsonPath('field', 'status');
    }
}
