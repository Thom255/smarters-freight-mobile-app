<?php

namespace Tests\Feature;

use App\Services\SupabaseClient;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Tests\Support\FakeSupabaseClient;
use Tests\TestCase;

/**
 * Base class for API feature tests.
 *
 * Swaps the real Supabase REST client for an in-memory double, so every test
 * exercises the actual routes, middleware, validation and authorization
 * without touching the network or the shared Supabase project.
 */
abstract class ApiTestCase extends TestCase
{
    protected FakeSupabaseClient $db;

    protected function setUp(): void
    {
        parent::setUp();

        $this->db = new FakeSupabaseClient;
        $this->app->instance(SupabaseClient::class, $this->db);
    }

    /**
     * Inserts a user row and returns its credentials.
     *
     * @param  array<string, mixed>  $overrides
     * @return array{id: string, identifier: string, password: string, name: string, role: string}
     */
    protected function seedUser(array $overrides = []): array
    {
        $user = [
            'id' => (string) Str::uuid(),
            'name' => $overrides['name'] ?? 'Test User',
            'identifier' => $overrides['identifier'] ?? 'user-'.strtolower(Str::random(8)).'@example.com',
            'password' => $overrides['password'] ?? 'secret123',
            'role' => $overrides['role'] ?? 'cargo_owner',
        ];

        $this->db->insert('users', [
            'id' => $user['id'],
            'name' => $user['name'],
            'identifier' => $user['identifier'],
            'password_hash' => Hash::make($user['password']),
            'role' => $user['role'],
            'company_name' => $overrides['company_name'] ?? null,
        ]);

        return $user;
    }

    /** Issues the same opaque bearer token the app stores on the device. */
    protected function tokenFor(string $userId): string
    {
        $token = 'sf_'.Str::random(64);

        $this->db->insert('api_tokens', [
            'id' => (string) Str::uuid(),
            'user_id' => $userId,
            'token_hash' => hash('sha256', $token),
            'expires_at' => now()->addDays(30)->toIso8601String(),
        ]);

        return $token;
    }

    /** @return array<string, string> */
    protected function bearer(string $token): array
    {
        return ['Authorization' => 'Bearer '.$token, 'Accept' => 'application/json'];
    }

    /**
     * @param  array<string, mixed>  $overrides
     * @return array<string, mixed>
     */
    protected function seedShipment(string $userId, array $overrides = []): array
    {
        $shipment = $this->db->insert('shipments', array_merge([
            'id' => (string) Str::uuid(),
            'user_id' => $userId,
            'reference' => 'SF-'.strtoupper(Str::random(6)),
            'origin' => 'Dar es Salaam',
            'destination' => 'Nairobi',
            'status' => 'booked',
            'notes' => null,
        ], $overrides));

        // POST /api/shipments seeds this entry — fixtures mirror that.
        $this->db->insert('shipment_events', [
            'shipment_id' => $shipment['id'],
            'user_id' => $userId,
            'type' => 'update',
            'title' => 'Shipment booked',
            'body' => $shipment['origin'].' → '.$shipment['destination'],
        ]);

        return $shipment;
    }

    /**
     * @param  array<string, mixed>  $overrides
     * @return array<string, mixed>
     */
    protected function seedTruck(string $ownerId, array $overrides = []): array
    {
        return $this->db->insert('trucks', array_merge([
            'id' => (string) Str::uuid(),
            'owner_id' => $ownerId,
            'registration_number' => 'T '.strtoupper(Str::random(5)),
            'truck_type' => 'Flatbed',
            'capacity_tons' => 20,
            'current_location' => 'Dar es Salaam',
            'availability_date' => '2026-10-01',
            'driver_name' => null,
            'driver_phone' => null,
            'rate_per_ton' => null,
            'status' => 'available',
            'verification_status' => 'pending',
            'matched_cargo_id' => null,
            'matched_at' => null,
        ], $overrides));
    }

    /**
     * @param  array<string, mixed>  $overrides
     * @return array<string, mixed>
     */
    protected function seedCargo(string $ownerId, array $overrides = []): array
    {
        return $this->db->insert('cargo', array_merge([
            'id' => (string) Str::uuid(),
            'owner_id' => $ownerId,
            'reference' => 'CG-'.strtoupper(Str::random(6)),
            'cargo_type' => 'General cargo',
            'weight_tons' => 10,
            'pickup_location' => 'Dar es Salaam',
            'destination_location' => 'Nairobi',
            'pickup_date' => '2026-10-10',
            'budget' => null,
            'currency' => 'TZS',
            'status' => 'posted',
            'matched_truck_id' => null,
            'matched_at' => null,
        ], $overrides));
    }

    /**
     * @param  array<string, mixed>  $overrides
     * @return array<string, mixed>
     */
    protected function seedBooking(string $requesterId, string $responderId, string $truckId, string $cargoId, array $overrides = []): array
    {
        return $this->db->insert('bookings', array_merge([
            'id' => (string) Str::uuid(),
            'cargo_id' => $cargoId,
            'truck_id' => $truckId,
            'requester_id' => $requesterId,
            'responder_id' => $responderId,
            'status' => 'pending',
            'price' => null,
            'currency' => 'TZS',
            'message' => null,
            'requested_at' => now()->toIso8601String(),
        ], $overrides));
    }
}
