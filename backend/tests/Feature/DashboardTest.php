<?php

namespace Tests\Feature;

/**
 * Dashboard payload — the home screen's only data source. Covers the
 * role-aware marketplace summary, shipment stats, fleet/load breakdowns,
 * active bookings, upcoming deliveries, the recent-activity feed and the
 * alerts derived from the rows in hand.
 */
class DashboardTest extends ApiTestCase
{
    public function test_it_requires_authentication(): void
    {
        $this->getJson('/api/dashboard')->assertStatus(401);
    }

    public function test_a_cargo_owner_sees_stats_marketplace_and_activity(): void
    {
        $user = $this->seedUser(['role' => 'cargo_owner']);
        $truckOwner = $this->seedUser(['role' => 'truck_owner']);
        $token = $this->tokenFor($user['id']);

        $this->seedShipment($user['id'], ['status' => 'booked', 'created_at' => '2026-10-01T08:00:00+00:00']);
        $this->seedShipment($user['id'], ['status' => 'in_transit', 'created_at' => '2026-10-02T08:00:00+00:00']);
        $this->seedShipment($user['id'], ['status' => 'delivered', 'created_at' => '2026-10-03T08:00:00+00:00']);

        $this->seedCargo($user['id'], ['status' => 'posted', 'pickup_date' => '2026-10-10', 'weight_tons' => 10]);
        $this->seedCargo($user['id'], ['status' => 'booked']);

        $truck = $this->seedTruck($truckOwner['id'], [
            'current_location' => 'Dar es Salaam',
            'capacity_tons' => 20,
            'availability_date' => '2026-10-01',
        ]);
        // Not available → must not count as a market truck.
        $this->seedTruck($truckOwner['id'], ['status' => 'maintenance']);

        // Reserve the available truck for one of the owner's loads.
        $this->seedCargo($user['id'], ['status' => 'booked', 'matched_truck_id' => $truck['id']]);

        $response = $this->withHeaders($this->bearer($token))->getJson('/api/dashboard');

        $response->assertOk()
            ->assertJsonPath('ok', true)
            ->assertJsonPath('role', 'cargo_owner')
            ->assertJsonPath('stats.shipments', 3)
            ->assertJsonPath('stats.booked', 1)
            ->assertJsonPath('stats.inTransit', 1)
            ->assertJsonPath('stats.delivered', 1)
            ->assertJsonPath('stats.cancelled', 0)
            ->assertJsonPath('stats.orders', 1)
            ->assertJsonPath('marketplace.trucks', 1)
            ->assertJsonPath('marketplace.availableTrucks', 1)
            ->assertJsonPath('marketplace.cargo', 3)
            ->assertJsonPath('marketplace.postedCargo', 1)
            ->assertJsonPath('marketplace.matches', 1)
            // A cargo owner has no fleet of their own.
            ->assertJsonPath('fleet.total', 0)
            ->assertJsonPath('loads.total', 3)
            ->assertJsonPath('loads.pending', 1)
            ->assertJsonPath('loads.confirmed', 2)
            ->assertJsonPath('bookings.active', 1);

        // Active shipment is the newest one still on the road.
        $this->assertSame('in_transit', $response->json('activeShipment.status'));

        // Upcoming deliveries are the booked + in-transit shipments,
        // longest-waiting first, and never the delivered one.
        $upcoming = $response->json('upcomingDeliveries');
        $this->assertCount(2, $upcoming);
        $this->assertSame('booked', $upcoming[0]['status']);
        $this->assertIsInt($upcoming[0]['createdAt']);

        $activity = $response->json('recentActivity');
        $this->assertNotEmpty($activity);
        $this->assertSame('Shipment booked', $activity[0]['title']);
        $this->assertIsInt($activity[0]['createdAt']);

        // Both alerts are derived from the seeded rows.
        $alertIds = array_column($response->json('alerts'), 'id');
        $this->assertContains('awaiting-pickup', $alertIds);
        $this->assertContains('in-transit', $alertIds);
        $this->assertContains('unmatched-loads', $alertIds);
    }

    public function test_a_truck_owner_sees_their_fleet_against_posted_loads(): void
    {
        $user = $this->seedUser(['role' => 'truck_owner']);
        $cargoOwner = $this->seedUser();
        $token = $this->tokenFor($user['id']);

        $available = $this->seedTruck($user['id'], [
            'current_location' => 'Dar es Salaam',
            'capacity_tons' => 20,
            'availability_date' => '2026-10-01',
        ]);
        $this->seedTruck($user['id'], ['status' => 'inactive']);
        $this->seedTruck($user['id'], ['status' => 'maintenance']);

        $openLoad = $this->seedCargo($cargoOwner['id'], [
            'status' => 'posted',
            'pickup_location' => 'Dar es Salaam',
            'weight_tons' => 10,
            'pickup_date' => '2026-10-10',
        ]);
        // Load already reserved by another truck → not open in the market.
        $this->seedCargo($cargoOwner['id'], ['status' => 'booked']);

        // This owner's available truck is booked for the open load.
        $this->db->updateMatching('trucks', ['id' => 'eq.'.$available['id']], [
            'status' => 'booked',
            'matched_cargo_id' => $openLoad['id'],
        ]);

        $response = $this->withHeaders($this->bearer($token))->getJson('/api/dashboard');

        $response->assertOk()
            ->assertJsonPath('role', 'truck_owner')
            ->assertJsonPath('marketplace.trucks', 3)
            ->assertJsonPath('marketplace.availableTrucks', 0)
            ->assertJsonPath('marketplace.cargo', 1)
            ->assertJsonPath('marketplace.postedCargo', 1)
            ->assertJsonPath('fleet.total', 3)
            ->assertJsonPath('fleet.booked', 1)
            ->assertJsonPath('fleet.maintenance', 1)
            ->assertJsonPath('fleet.inactive', 1)
            // A truck owner has no loads of their own.
            ->assertJsonPath('loads.total', 0)
            ->assertJsonPath('bookings.active', 1)
            ->assertJsonPath('activeShipment', null);

        // The available truck moved to `booked`, so no market truck matches
        // the open load any more.
        $this->assertSame(0, $response->json('marketplace.matches'));

        $alertIds = array_column($response->json('alerts'), 'id');
        $this->assertContains('maintenance', $alertIds);
        $this->assertContains('verification', $alertIds);
    }
}
