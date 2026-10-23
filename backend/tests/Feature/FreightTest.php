<?php

namespace Tests\Feature;

/**
 * Fleet + marketplace CRUD: validation messages, ownership, duplicate plates
 * and the status changes that release a booked counterpart.
 */
class FreightTest extends ApiTestCase
{
    public function test_a_truck_owner_can_register_a_truck(): void
    {
        $owner = $this->seedUser(['role' => 'truck_owner']);
        $token = $this->tokenFor($owner['id']);

        $response = $this->withHeaders($this->bearer($token))->postJson('/api/trucks', [
            'registrationNumber' => 'T 123 ABC',
            'truckType' => 'Flatbed',
            'capacityTons' => 25,
            'currentLocation' => 'Dar es Salaam',
            'availabilityDate' => '2026-10-20',
        ]);

        $response->assertStatus(201)
            ->assertJsonPath('ok', true)
            ->assertJsonPath('truck.status', 'available')
            ->assertJsonPath('truck.registrationNumber', 'T 123 ABC')
            ->assertJsonPath('truck.verificationStatus', 'pending');
    }

    public function test_a_created_truck_is_owned_by_the_session_user_and_appears_in_the_dashboard_fleet(): void
    {
        $owner = $this->seedUser(['role' => 'truck_owner']);
        $other = $this->seedUser(['role' => 'truck_owner']);
        $token = $this->tokenFor($owner['id']);
        $otherToken = $this->tokenFor($other['id']);

        $response = $this->withHeaders($this->bearer($token))->postJson('/api/trucks', [
            'registrationNumber' => 'T OWNER1',
            'truckType' => 'Flatbed',
            'capacityTons' => 25,
            'currentLocation' => 'Dar es Salaam',
            'availabilityDate' => '2026-10-20',
            'driverName' => 'Juma Ally',
            'driverPhone' => '+255 712 000 000',
            'ratePerTon' => 45000,
            // A client must not be able to choose the owner.
            'owner_id' => $other['id'],
        ]);

        $response->assertStatus(201)
            ->assertJsonPath('ok', true)
            ->assertJsonPath('truck.registrationNumber', 'T OWNER1')
            ->assertJsonPath('truck.status', 'available');

        $truckId = $response->json('truck.id');
        $truck = $this->db->selectOne('trucks', ['id' => 'eq.'.$truckId]);

        $this->assertNotNull($truck);
        $this->assertSame($owner['id'], $truck['owner_id']);
        $this->assertSame('Juma Ally', $truck['driver_name']);
        $this->assertSame('+255 712 000 000', $truck['driver_phone']);
        $this->assertEqualsWithDelta(45000, (float) $truck['rate_per_ton'], 0.01);
        $this->assertSame('available', $truck['status']);

        // The fleet listing and dashboard remain owner-scoped.
        $this->withHeaders($this->bearer($token))
            ->getJson('/api/trucks')
            ->assertOk()
            ->assertJsonCount(1, 'trucks')
            ->assertJsonPath('trucks.0.id', $truckId);

        $this->withHeaders($this->bearer($otherToken))
            ->getJson('/api/trucks')
            ->assertOk()
            ->assertJsonCount(0, 'trucks');

        $this->withHeaders($this->bearer($token))
            ->getJson('/api/dashboard')
            ->assertOk()
            ->assertJsonPath('role', 'truck_owner')
            ->assertJsonPath('fleet.total', 1)
            ->assertJsonPath('fleet.available', 1)
            ->assertJsonPath('marketplace.trucks', 1)
            ->assertJsonPath('marketplace.availableTrucks', 1);
    }

    public function test_registering_a_duplicate_plate_is_a_field_error(): void
    {
        $owner = $this->seedUser(['role' => 'truck_owner']);
        $token = $this->tokenFor($owner['id']);
        $this->seedTruck($owner['id'], ['registration_number' => 'T 123 ABC']);

        $response = $this->withHeaders($this->bearer($token))->postJson('/api/trucks', [
            // Same plate, different case — the unique index is case-insensitive.
            'registrationNumber' => 't 123 abc',
            'truckType' => 'Box body',
            'capacityTons' => 10,
            'currentLocation' => 'Dodoma',
            'availabilityDate' => '2026-10-21',
        ]);

        $response->assertStatus(422)
            ->assertJsonPath('ok', false)
            ->assertJsonPath('field', 'registrationNumber');

        $this->assertCount(1, $this->db->select('trucks'));
    }

    public function test_truck_validation_messages_match_the_app_wording(): void
    {
        $owner = $this->seedUser(['role' => 'truck_owner']);
        $token = $this->tokenFor($owner['id']);

        $this->withHeaders($this->bearer($token))
            ->postJson('/api/trucks', ['capacityTons' => 0])
            ->assertStatus(422)
            ->assertJsonPath('field', 'registrationNumber');

        $this->withHeaders($this->bearer($token))
            ->postJson('/api/trucks', [
                'registrationNumber' => 'T 999 XYZ',
                'truckType' => 'Flatbed',
                'capacityTons' => 0,
                'currentLocation' => 'Dar es Salaam',
                'availabilityDate' => '2026-10-20',
            ])
            ->assertStatus(422)
            ->assertJsonPath('field', 'capacityTons')
            ->assertJsonPath('message', 'Capacity must be greater than zero');
    }

    public function test_only_the_owner_sees_and_edits_a_truck(): void
    {
        $owner = $this->seedUser(['role' => 'truck_owner']);
        $stranger = $this->seedUser(['role' => 'truck_owner']);
        $ownerToken = $this->tokenFor($owner['id']);
        $strangerToken = $this->tokenFor($stranger['id']);
        $truck = $this->seedTruck($owner['id']);

        $this->withHeaders($this->bearer($strangerToken))
            ->getJson('/api/trucks/'.$truck['id'])
            ->assertStatus(404);

        $this->withHeaders($this->bearer($strangerToken))
            ->patchJson('/api/trucks/'.$truck['id'], ['status' => 'inactive'])
            ->assertStatus(404);

        $this->withHeaders($this->bearer($ownerToken))
            ->patchJson('/api/trucks/'.$truck['id'], ['status' => 'maintenance'])
            ->assertOk()
            ->assertJsonPath('truck.status', 'maintenance');
    }

    public function test_making_a_truck_unavailable_releases_the_load_it_held(): void
    {
        $owner = $this->seedUser(['role' => 'truck_owner']);
        $cargoOwner = $this->seedUser();
        $token = $this->tokenFor($owner['id']);

        $truck = $this->seedTruck($owner['id'], ['status' => 'booked', 'matched_cargo_id' => null]);
        $load = $this->seedCargo($cargoOwner['id'], [
            'status' => 'booked',
            'matched_truck_id' => $truck['id'],
        ]);
        // Link the truck side now that we know both ids.
        $this->db->update('trucks', 'id', 'eq.'.$truck['id'], ['matched_cargo_id' => $load['id']]);

        $this->withHeaders($this->bearer($token))
            ->patchJson('/api/trucks/'.$truck['id'], ['status' => 'inactive'])
            ->assertOk();

        // The truck keeps the status the owner asked for; the load it held is
        // what gets released back to the market.
        $this->assertSame('inactive', $this->db->selectOne('trucks', ['id' => 'eq.'.$truck['id']])['status']);
        $this->assertSame('posted', $this->db->selectOne('cargo', ['id' => 'eq.'.$load['id']])['status']);
        $this->assertNull($this->db->selectOne('cargo', ['id' => 'eq.'.$load['id']])['matched_truck_id']);
        $this->assertNull($this->db->selectOne('trucks', ['id' => 'eq.'.$truck['id']])['matched_cargo_id']);
    }

    public function test_a_cargo_owner_can_post_a_load_and_the_listing_is_theirs(): void
    {
        $mine = $this->seedUser();
        $other = $this->seedUser();
        $token = $this->tokenFor($mine['id']);

        $response = $this->withHeaders($this->bearer($token))->postJson('/api/cargo', [
            'cargoType' => 'Agriculture',
            'weightTons' => 12,
            'pickupLocation' => 'Dodoma',
            'destination' => 'Dar es Salaam',
            'pickupDate' => '2026-10-25',
            'budget' => 1500000,
        ]);

        $response->assertStatus(201)
            ->assertJsonPath('ok', true)
            ->assertJsonPath('cargo.status', 'posted')
            ->assertJsonPath('cargo.budget', 1500000);

        $this->seedCargo($other['id'], ['reference' => 'CG-SHOULDNOTAPPEAR']);

        $listed = $this->withHeaders($this->bearer($token))->getJson('/api/cargo');
        $listed->assertOk();

        $references = array_column($listed->json('cargo'), 'reference');
        $this->assertContains($response->json('cargo.reference'), $references);
        $this->assertNotContains('CG-SHOULDNOTAPPEAR', $references);
    }

    public function test_finishing_a_load_frees_the_truck_reserved_for_it(): void
    {
        $cargoOwner = $this->seedUser();
        $truckOwner = $this->seedUser(['role' => 'truck_owner']);
        $token = $this->tokenFor($cargoOwner['id']);

        $truck = $this->seedTruck($truckOwner['id'], ['status' => 'booked']);
        $load = $this->seedCargo($cargoOwner['id'], [
            'status' => 'booked',
            'matched_truck_id' => $truck['id'],
        ]);
        $this->db->update('trucks', 'id', 'eq.'.$truck['id'], ['matched_cargo_id' => $load['id']]);

        $this->withHeaders($this->bearer($token))
            ->patchJson('/api/cargo/'.$load['id'], ['status' => 'cancelled'])
            ->assertOk()
            ->assertJsonPath('cargo.status', 'cancelled');

        $this->assertSame('available', $this->db->selectOne('trucks', ['id' => 'eq.'.$truck['id']])['status']);
        $this->assertNull($this->db->selectOne('trucks', ['id' => 'eq.'.$truck['id']])['matched_cargo_id']);
    }

    public function test_unknown_and_malformed_ids_answer_404(): void
    {
        $owner = $this->seedUser(['role' => 'truck_owner']);
        $token = $this->tokenFor($owner['id']);

        $this->withHeaders($this->bearer($token))
            ->getJson('/api/trucks/whatever')
            ->assertStatus(404)
            ->assertJsonPath('field', 'truck');

        $this->withHeaders($this->bearer($token))
            ->getJson('/api/cargo/whatever')
            ->assertStatus(404)
            ->assertJsonPath('field', 'cargo');
    }
}
