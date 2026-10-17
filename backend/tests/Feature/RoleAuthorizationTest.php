<?php

namespace Tests\Feature;

use App\Exceptions\DataStoreUnavailable;
use App\Services\SupabaseClient;
use App\Support\ApiRateLimit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Tests\Support\FakeSupabaseClient;

/**
 * Role permissions are enforced by the API, not just by hiding tabs in the
 * app: `auth.role` rejects a signed-in user acting outside their role, admin
 * bypasses every rule, and the whole authenticated surface is rate limited.
 */
class RoleAuthorizationTest extends ApiTestCase
{
    public function test_a_cargo_owner_cannot_register_a_truck(): void
    {
        $cargoOwner = $this->seedUser(['role' => 'cargo_owner']);
        $token = $this->tokenFor($cargoOwner['id']);

        $response = $this->withHeaders($this->bearer($token))->postJson('/api/trucks', [
            'registrationNumber' => 'T FORBIDDEN',
            'truckType' => 'Flatbed',
            'capacityTons' => 10,
            'currentLocation' => 'Dar es Salaam',
            'availabilityDate' => '2026-10-20',
        ]);

        $response->assertStatus(403)
            ->assertJsonPath('ok', false)
            ->assertJsonPath('field', 'role');

        $this->assertSame([], $this->db->select('trucks'));
    }

    public function test_a_truck_owner_cannot_post_cargo(): void
    {
        $truckOwner = $this->seedUser(['role' => 'truck_owner']);
        $token = $this->tokenFor($truckOwner['id']);

        $response = $this->withHeaders($this->bearer($token))->postJson('/api/cargo', [
            'cargoType' => 'Agriculture',
            'weightTons' => 5,
            'pickupLocation' => 'Dodoma',
            'destination' => 'Dar es Salaam',
            'pickupDate' => '2026-10-25',
        ]);

        $response->assertStatus(403)
            ->assertJsonPath('ok', false)
            ->assertJsonPath('field', 'role');

        $this->assertSame([], $this->db->select('cargo'));
    }

    public function test_a_cargo_owner_cannot_edit_a_truck_they_do_not_own(): void
    {
        $cargoOwner = $this->seedUser(['role' => 'cargo_owner']);
        $truckOwner = $this->seedUser(['role' => 'truck_owner']);
        $token = $this->tokenFor($cargoOwner['id']);
        $truck = $this->seedTruck($truckOwner['id']);

        // Role check fires before ownership, so the answer is 403 not 404.
        $this->withHeaders($this->bearer($token))
            ->patchJson('/api/trucks/'.$truck['id'], ['status' => 'maintenance'])
            ->assertStatus(403)
            ->assertJsonPath('field', 'role');

        $this->assertSame('available', $this->db->selectOne('trucks', ['id' => 'eq.'.$truck['id']])['status']);
    }

    public function test_browsing_stays_open_to_every_role(): void
    {
        $truckOwner = $this->seedUser(['role' => 'truck_owner']);
        $cargoOwner = $this->seedUser(['role' => 'cargo_owner']);
        $this->seedTruck($truckOwner['id']);
        $this->seedCargo($cargoOwner['id']);

        $truckToken = $this->tokenFor($truckOwner['id']);
        $cargoToken = $this->tokenFor($cargoOwner['id']);

        // A cargo owner still browses the fleet; a truck owner still browses
        // the load board — only writes are role-gated.
        $this->withHeaders($this->bearer($cargoToken))->getJson('/api/trucks')->assertOk();
        $this->withHeaders($this->bearer($truckToken))->getJson('/api/cargo')->assertOk();
    }

    public function test_admin_is_exempt_from_role_rules(): void
    {
        $admin = $this->seedUser(['role' => 'admin']);
        $token = $this->tokenFor($admin['id']);

        $this->withHeaders($this->bearer($token))
            ->postJson('/api/trucks', [
                'registrationNumber' => 'T ADMIN1',
                'truckType' => 'Flatbed',
                'capacityTons' => 10,
                'currentLocation' => 'Dar es Salaam',
                'availabilityDate' => '2026-10-20',
            ])
            ->assertStatus(201);

        $this->withHeaders($this->bearer($token))
            ->postJson('/api/cargo', [
                'cargoType' => 'Agriculture',
                'weightTons' => 5,
                'pickupLocation' => 'Dodoma',
                'destination' => 'Dar es Salaam',
                'pickupDate' => '2026-10-25',
            ])
            ->assertStatus(201);
    }

    public function test_an_unauthenticated_request_is_still_401_not_403(): void
    {
        // Middleware order matters: auth.api must answer before auth.role,
        // otherwise an anonymous caller would learn which roles exist.
        $this->postJson('/api/trucks', [])->assertStatus(401);
        $this->postJson('/api/cargo', [])->assertStatus(401);
    }

    public function test_the_authenticated_surface_is_rate_limited_in_the_mobile_contract(): void
    {
        // Same rule the app registers, with a lower ceiling so the test does
        // not have to fire 121 requests.
        RateLimiter::for('api', fn (Request $request) => ApiRateLimit::for($request, 2));

        $user = $this->seedUser();
        $token = $this->tokenFor($user['id']);
        $headers = $this->bearer($token);

        $this->withHeaders($headers)->getJson('/api/auth/me')->assertOk();
        $this->withHeaders($headers)->getJson('/api/shipments')->assertOk();

        $this->withHeaders($headers)
            ->getJson('/api/dashboard')
            ->assertStatus(429)
            ->assertJsonPath('ok', false)
            ->assertJsonPath('field', 'form')
            ->assertJsonPath('message', 'Too many requests. Please wait a moment and try again.');
    }

    public function test_rate_limiting_bounds_traffic_before_authentication_resolves(): void
    {
        RateLimiter::for('api', fn (Request $request) => ApiRateLimit::for($request, 1));

        // The limiter runs ahead of auth.api (Laravel's middleware priority),
        // so even requests with no/invalid token draw from the same address
        // budget — a rotating bogus token cannot buy a fresh allowance while
        // still costing an auth round trip.
        $this->getJson('/api/shipments')->assertStatus(401);
        $this->getJson('/api/shipments')
            ->assertStatus(429)
            ->assertJsonPath('message', 'Too many requests. Please wait a moment and try again.');
    }

    public function test_a_data_store_outage_reports_503_with_a_retryable_message(): void
    {
        $user = $this->seedUser();
        $token = $this->tokenFor($user['id']);

        $down = new class extends FakeSupabaseClient
        {
            public function select(string $table, array $query = []): array
            {
                throw new DataStoreUnavailable(
                    'Cannot reach Supabase REST API: cURL error 28',
                    503
                );
            }
        };
        $this->app->instance(SupabaseClient::class, $down);

        $response = $this->withHeaders($this->bearer($token))->getJson('/api/shipments');

        $response->assertStatus(503)
            ->assertJsonPath('ok', false)
            ->assertJsonPath('field', 'form')
            ->assertJsonPath('message', 'The service is temporarily unavailable. Please try again in a moment.');

        foreach (['trace', 'exception', 'Supabase', 'cURL', 'vendor', '.php'] as $leak) {
            $this->assertStringNotContainsString($leak, $response->getContent(), "Response leaked \"{$leak}\".");
        }
    }

    public function test_a_schema_problem_is_a_500_without_internals(): void
    {
        $user = $this->seedUser();
        $token = $this->tokenFor($user['id']);

        $misconfigured = new class extends FakeSupabaseClient
        {
            public function select(string $table, array $query = []): array
            {
                throw new DataStoreUnavailable(
                    "Supabase table missing for '{$table}'. Run supabase_schema.sql first.",
                    500
                );
            }
        };
        $this->app->instance(SupabaseClient::class, $misconfigured);

        $this->withHeaders($this->bearer($token))
            ->getJson('/api/shipments')
            ->assertStatus(500)
            ->assertJsonPath('ok', false)
            ->assertJsonPath('message', 'Something went wrong on our side. Please try again.');
    }
}
