<?php

namespace Tests\Feature;

/**
 * The open marketplace browse (SRS §14, §16–§17): unlike the owner-scoped
 * /api/trucks and /api/cargo listings, these show every available truck and
 * posted load to any signed-in user, and carry the driver + pricing fields.
 */
class MarketplaceTest extends ApiTestCase
{
    public function test_anyone_can_browse_every_available_truck(): void
    {
        $ownerA = $this->seedUser(['role' => 'truck_owner']);
        $ownerB = $this->seedUser(['role' => 'truck_owner']);
        $viewer = $this->seedUser();
        $token = $this->tokenFor($viewer['id']);

        $this->seedTruck($ownerA['id'], ['registration_number' => 'T OPEN1']);
        $this->seedTruck($ownerB['id'], ['registration_number' => 'T OPEN2']);
        // Booked trucks are not on the market.
        $this->seedTruck($ownerA['id'], ['registration_number' => 'T BUSY3', 'status' => 'booked']);

        $response = $this->withHeaders($this->bearer($token))->getJson('/api/marketplace/trucks');

        $response->assertOk()->assertJsonPath('ok', true);

        $plates = array_column($response->json('trucks'), 'registrationNumber');
        $this->assertContains('T OPEN1', $plates);
        $this->assertContains('T OPEN2', $plates);
        $this->assertNotContains('T BUSY3', $plates);
    }

    public function test_anyone_can_browse_every_posted_load(): void
    {
        $cargoA = $this->seedUser();
        $cargoB = $this->seedUser();
        $viewer = $this->seedUser(['role' => 'truck_owner']);
        $token = $this->tokenFor($viewer['id']);

        $this->seedCargo($cargoA['id'], ['reference' => 'CG-OPEN1']);
        $this->seedCargo($cargoB['id'], ['reference' => 'CG-BUSY2', 'status' => 'booked']);

        $response = $this->withHeaders($this->bearer($token))->getJson('/api/marketplace/cargo');

        $response->assertOk()->assertJsonPath('ok', true);

        $references = array_column($response->json('cargo'), 'reference');
        $this->assertContains('CG-OPEN1', $references);
        $this->assertNotContains('CG-BUSY2', $references);
    }

    public function test_a_truck_detail_carries_driver_and_rate(): void
    {
        $owner = $this->seedUser(['role' => 'truck_owner']);
        $viewer = $this->seedUser();
        $token = $this->tokenFor($viewer['id']);

        $truck = $this->seedTruck($owner['id'], [
            'driver_name' => 'Juma Mwinyi',
            'driver_phone' => '+255700000001',
            'rate_per_ton' => 8500,
        ]);

        $response = $this->withHeaders($this->bearer($token))->getJson('/api/marketplace/trucks/'.$truck['id']);

        $response->assertOk()
            ->assertJsonPath('truck.id', $truck['id'])
            ->assertJsonPath('truck.driverName', 'Juma Mwinyi')
            ->assertJsonPath('truck.driverPhone', '+255700000001')
            ->assertJsonPath('truck.ratePerTon', 8500);
    }

    public function test_a_cargo_detail_carries_its_currency(): void
    {
        $owner = $this->seedUser();
        $viewer = $this->seedUser(['role' => 'truck_owner']);
        $token = $this->tokenFor($viewer['id']);

        $cargo = $this->seedCargo($owner['id'], ['currency' => 'KES', 'budget' => 900000]);

        $this->withHeaders($this->bearer($token))
            ->getJson('/api/marketplace/cargo/'.$cargo['id'])
            ->assertOk()
            ->assertJsonPath('cargo.currency', 'KES')
            ->assertJsonPath('cargo.budget', 900000);
    }

    public function test_unknown_and_malformed_marketplace_ids_answer_404(): void
    {
        $viewer = $this->seedUser();
        $token = $this->tokenFor($viewer['id']);

        $this->withHeaders($this->bearer($token))
            ->getJson('/api/marketplace/trucks/whatever')
            ->assertStatus(404)
            ->assertJsonPath('field', 'truck');

        $this->withHeaders($this->bearer($token))
            ->getJson('/api/marketplace/cargo/whatever')
            ->assertStatus(404)
            ->assertJsonPath('field', 'cargo');
    }
}
