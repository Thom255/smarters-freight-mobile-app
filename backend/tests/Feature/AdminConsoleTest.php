<?php

namespace Tests\Feature;

use App\Services\CommissionCalculator;
use Illuminate\Support\Str;

/**
 * Admin console (`/api/admin/overview|users|cargo|trucks|bookings|shipments`).
 *
 * These are the system-wide reads and the account-management write added for
 * SRS §2/§9. They sit behind `auth.role:admin`, so the rules under test are:
 * anonymous callers get 401, signed-in cargo/truck owners get 403 without the
 * controller ever running, only an admin can act, an admin can never lock
 * themselves out, and the records listed are the real rows with their owners
 * attached. Revenue stays on the separate `/admin/revenue` + commission routes
 * (CommissionTest) — nothing here writes the ledger.
 */
class AdminConsoleTest extends ApiTestCase
{
    /**
     * Every console route as [method, path, body] so the 401/403 sweeps below
     * cover the whole surface — a newly added endpoint fails this test until
     * it is included here.
     *
     * @return array<int, array{0: string, 1: string, 2: array<string, mixed>}>
     */
    private function consoleRoutes(): array
    {
        $userId = (string) Str::uuid();

        return [
            ['GET', '/api/admin/overview', []],
            ['GET', '/api/admin/users', []],
            ['PATCH', "/api/admin/users/{$userId}", ['role' => 'truck_owner']],
            ['GET', '/api/admin/cargo', []],
            ['GET', '/api/admin/trucks', []],
            ['GET', '/api/admin/bookings', []],
            ['GET', '/api/admin/shipments', []],
        ];
    }

    public function test_the_admin_console_is_closed_to_unauthenticated_requests(): void
    {
        foreach ($this->consoleRoutes() as [$method, $path, $body]) {
            $this->json($method, $path, $body)
                ->assertStatus(401)
                ->assertJsonPath('ok', false)
                ->assertJsonPath('field', 'session');
        }
    }

    public function test_a_cargo_owner_cannot_reach_any_admin_console_route(): void
    {
        $cargoOwner = $this->seedUser(['role' => 'cargo_owner']);
        $token = $this->tokenFor($cargoOwner['id']);

        foreach ($this->consoleRoutes() as [$method, $path, $body]) {
            $this->withHeaders($this->bearer($token))
                ->json($method, $path, $body)
                ->assertStatus(403)
                ->assertJsonPath('ok', false)
                ->assertJsonPath('field', 'role')
                ->assertJsonPath('message', 'Your account type does not allow that action.');
        }
    }

    public function test_a_truck_owner_cannot_reach_the_admin_console(): void
    {
        $truckOwner = $this->seedUser(['role' => 'truck_owner']);
        $token = $this->tokenFor($truckOwner['id']);

        $this->withHeaders($this->bearer($token))
            ->getJson('/api/admin/overview')
            ->assertStatus(403)
            ->assertJsonPath('field', 'role');

        $this->withHeaders($this->bearer($token))
            ->getJson('/api/admin/users')
            ->assertStatus(403)
            ->assertJsonPath('field', 'role');
    }

    public function test_a_non_admin_cannot_change_another_users_account(): void
    {
        $cargoOwner = $this->seedUser(['role' => 'cargo_owner']);
        $victim = $this->seedUser(['role' => 'cargo_owner']);
        $token = $this->tokenFor($cargoOwner['id']);

        $this->withHeaders($this->bearer($token))
            ->patchJson("/api/admin/users/{$victim['id']}", ['role' => 'admin'])
            ->assertStatus(403)
            ->assertJsonPath('field', 'role');

        // The middleware answered before the controller, so nothing moved.
        $this->assertSame(
            'cargo_owner',
            $this->db->selectOne('users', ['id' => 'eq.'.$victim['id']])['role'],
        );
    }

    public function test_the_overview_reports_system_counts_and_commission_revenue(): void
    {
        $admin = $this->seedUser(['role' => 'admin']);
        $cargoOwner = $this->seedUser(['role' => 'cargo_owner']);
        $truckOwner = $this->seedUser(['role' => 'truck_owner']);

        $load = $this->seedCargo($cargoOwner['id']);
        $truck = $this->seedTruck($truckOwner['id']);
        $this->seedShipment($cargoOwner['id']);
        $this->seedBooking($cargoOwner['id'], $truckOwner['id'], $truck['id'], $load['id']);

        // Ledger rows exactly as the accept flow writes them: one pending,
        // one paid. Each commission carries its own load + booking, so they
        // add to the cargo/booking totals asserted below (3 and 3).
        $this->seedLedgerRow($cargoOwner['id'], $truckOwner['id'], $truck['id'], 1000.0, 'pending');
        $this->seedLedgerRow($cargoOwner['id'], $truckOwner['id'], $truck['id'], 2000.0, 'paid');

        $response = $this->withHeaders($this->bearer($this->tokenFor($admin['id'])))
            ->getJson('/api/admin/overview');

        $response->assertOk()
            ->assertJsonPath('ok', true)
            ->assertJsonPath('users.total', 3)
            ->assertJsonPath('users.admins', 1)
            ->assertJsonPath('users.cargoOwners', 1)
            ->assertJsonPath('users.truckOwners', 1)
            ->assertJsonPath('users.active', 3)
            ->assertJsonPath('users.suspended', 0)
            ->assertJsonPath('cargo.total', 3)
            ->assertJsonPath('cargo.byStatus.posted', 3)
            ->assertJsonPath('trucks.total', 1)
            ->assertJsonPath('trucks.byStatus.available', 1)
            ->assertJsonPath('bookings.total', 3)
            ->assertJsonPath('bookings.byStatus.pending', 3)
            ->assertJsonPath('shipments.total', 1)
            ->assertJsonPath('shipments.byStatus.booked', 1)
            // 8% of 1,000 (pending) + 8% of 2,000 (paid) = 240 live;
            // only the paid 160 counts as paid commission.
            ->assertJsonPath('revenue.liveCommission', 240)
            ->assertJsonPath('revenue.paidCommission', 160)
            ->assertJsonPath('revenue.totalRecords', 2);
    }

    public function test_the_users_list_returns_every_account_with_role_and_status(): void
    {
        $admin = $this->seedUser(['role' => 'admin', 'name' => 'Root Admin']);
        $cargoOwner = $this->seedUser(['role' => 'cargo_owner', 'company_name' => 'Acme Haulage']);

        $response = $this->withHeaders($this->bearer($this->tokenFor($admin['id'])))
            ->getJson('/api/admin/users');

        $response->assertOk()->assertJsonPath('ok', true);

        $users = collect($response->json('users'));

        $this->assertCount(2, $users);

        $listedAdmin = $users->firstWhere('id', $admin['id']);
        $listedOwner = $users->firstWhere('id', $cargoOwner['id']);

        $this->assertSame('admin', $listedAdmin['role']);
        $this->assertSame('active', $listedAdmin['status']);
        $this->assertSame('cargo_owner', $listedOwner['role']);
        $this->assertSame('Acme Haulage', $listedOwner['companyName']);
        $this->assertNotNull($listedOwner['createdAt']);
    }

    public function test_an_admin_can_change_another_users_role_and_status(): void
    {
        $admin = $this->seedUser(['role' => 'admin']);
        $target = $this->seedUser(['role' => 'cargo_owner']);

        $this->withHeaders($this->bearer($this->tokenFor($admin['id'])))
            ->patchJson("/api/admin/users/{$target['id']}", [
                'role' => 'truck_owner',
                'status' => 'suspended',
            ])
            ->assertOk()
            ->assertJsonPath('ok', true)
            ->assertJsonPath('user.role', 'truck_owner')
            ->assertJsonPath('user.status', 'suspended');

        $row = $this->db->selectOne('users', ['id' => 'eq.'.$target['id']]);
        $this->assertSame('truck_owner', $row['role']);
        $this->assertSame('suspended', $row['status']);
    }

    public function test_an_admin_cannot_change_their_own_account(): void
    {
        $admin = $this->seedUser(['role' => 'admin']);

        $this->withHeaders($this->bearer($this->tokenFor($admin['id'])))
            ->patchJson("/api/admin/users/{$admin['id']}", ['role' => 'cargo_owner'])
            ->assertStatus(422)
            ->assertJsonPath('ok', false)
            ->assertJsonPath('message', 'You cannot change your own account.');

        $this->assertSame('admin', $this->db->selectOne('users', ['id' => 'eq.'.$admin['id']])['role']);
    }

    public function test_updating_a_missing_or_malformed_user_is_404(): void
    {
        $admin = $this->seedUser(['role' => 'admin']);
        $token = $this->tokenFor($admin['id']);

        // Well-formed UUID that matches no row…
        $this->withHeaders($this->bearer($token))
            ->patchJson('/api/admin/users/'.Str::uuid(), ['role' => 'admin'])
            ->assertStatus(404)
            ->assertJsonPath('field', 'user');

        // …and something that is not a UUID at all, which must not reach
        // PostgREST as `id=eq…` (that answers 400, not 404).
        $this->withHeaders($this->bearer($token))
            ->patchJson('/api/admin/users/not-a-uuid', ['role' => 'admin'])
            ->assertStatus(404)
            ->assertJsonPath('field', 'user');
    }

    public function test_an_account_update_needs_a_known_field_with_a_known_value(): void
    {
        $admin = $this->seedUser(['role' => 'admin']);
        $target = $this->seedUser(['role' => 'cargo_owner']);
        $token = $this->tokenFor($admin['id']);

        $this->withHeaders($this->bearer($token))
            ->patchJson("/api/admin/users/{$target['id']}", ['role' => 'superuser'])
            ->assertStatus(422)
            ->assertJsonPath('field', 'role');

        $this->withHeaders($this->bearer($token))
            ->patchJson("/api/admin/users/{$target['id']}", [])
            ->assertStatus(422)
            ->assertJsonPath('field', 'form')
            ->assertJsonPath('message', 'Nothing to update');

        $this->assertSame('cargo_owner', $this->db->selectOne('users', ['id' => 'eq.'.$target['id']])['role']);
    }

    public function test_admin_record_lists_include_other_users_rows_with_owners_attached(): void
    {
        $admin = $this->seedUser(['role' => 'admin']);
        $cargoOwner = $this->seedUser(['role' => 'cargo_owner', 'company_name' => 'Acme Haulage']);
        $truckOwner = $this->seedUser(['role' => 'truck_owner', 'name' => 'Fleet Manager']);

        $load = $this->seedCargo($cargoOwner['id']);
        $truck = $this->seedTruck($truckOwner['id']);
        $this->seedShipment($cargoOwner['id']);
        $this->seedBooking($cargoOwner['id'], $truckOwner['id'], $truck['id'], $load['id']);

        $headers = $this->bearer($this->tokenFor($admin['id']));

        // The admin sees records it is not a party to — unlike the customer
        // reads, which filter on owner_id/user_id.
        $cargo = $this->withHeaders($headers)->getJson('/api/admin/cargo')->assertOk()->json('cargo');
        $this->assertCount(1, $cargo);
        $this->assertSame($cargoOwner['id'], $cargo[0]['owner']['id']);
        $this->assertSame('Acme Haulage', $cargo[0]['owner']['companyName']);

        $trucks = $this->withHeaders($headers)->getJson('/api/admin/trucks')->assertOk()->json('trucks');
        $this->assertCount(1, $trucks);
        $this->assertSame($truckOwner['id'], $trucks[0]['owner']['id']);
        $this->assertSame('Fleet Manager', $trucks[0]['owner']['name']);

        $shipments = $this->withHeaders($headers)->getJson('/api/admin/shipments')->assertOk()->json('shipments');
        $this->assertCount(1, $shipments);
        $this->assertSame($cargoOwner['id'], $shipments[0]['owner']['id']);

        $bookings = $this->withHeaders($headers)->getJson('/api/admin/bookings')->assertOk()->json('bookings');
        $this->assertCount(1, $bookings);
        $this->assertSame($cargo['0']['id'], $bookings[0]['cargo']['id']);
        $this->assertSame($trucks[0]['id'], $bookings[0]['truck']['id']);
        $this->assertSame($cargoOwner['id'], $bookings[0]['requester']['id']);
        $this->assertSame($truckOwner['id'], $bookings[0]['responder']['id']);
    }

    public function test_a_suspended_account_cannot_sign_in_even_with_the_right_password(): void
    {
        $admin = $this->seedUser(['role' => 'admin']);
        $target = $this->seedUser(['role' => 'cargo_owner', 'password' => 'secret123']);

        // Sanity: the account signs in before suspension.
        $this->postJson('/api/auth/login', [
            'identifier' => $target['identifier'],
            'password' => 'secret123',
        ])->assertOk()->assertJsonPath('ok', true);

        $this->withHeaders($this->bearer($this->tokenFor($admin['id'])))
            ->patchJson("/api/admin/users/{$target['id']}", ['status' => 'suspended'])
            ->assertOk()
            ->assertJsonPath('user.status', 'suspended');

        // Correct credentials are not enough while suspended.
        $this->postJson('/api/auth/login', [
            'identifier' => $target['identifier'],
            'password' => 'secret123',
        ])->assertStatus(403)
            ->assertJsonPath('ok', false)
            ->assertJsonPath('field', 'form')
            ->assertJsonPath('message', 'This account has been suspended. Please contact the platform administrator.');

        // Reactivating restores sign-in — suspension is reversible, not a delete.
        $this->withHeaders($this->bearer($this->tokenFor($admin['id'])))
            ->patchJson("/api/admin/users/{$target['id']}", ['status' => 'active'])
            ->assertOk()
            ->assertJsonPath('user.status', 'active');

        $this->postJson('/api/auth/login', [
            'identifier' => $target['identifier'],
            'password' => 'secret123',
        ])->assertOk()->assertJsonPath('ok', true);
    }

    public function test_a_suspension_revokes_existing_sessions_until_reactivated(): void
    {
        $admin = $this->seedUser(['role' => 'admin']);
        $target = $this->seedUser(['role' => 'truck_owner']);
        $targetToken = $this->tokenFor($target['id']);

        // The session works before suspension.
        $this->withHeaders($this->bearer($targetToken))
            ->getJson('/api/auth/me')
            ->assertOk()
            ->assertJsonPath('user.id', $target['id']);

        $this->withHeaders($this->bearer($this->tokenFor($admin['id'])))
            ->patchJson("/api/admin/users/{$target['id']}", ['status' => 'suspended'])
            ->assertOk();

        // Every token-bearing route now rejects the session as unauthorized
        // (field 'session' → the app clears it and returns to sign-in).
        foreach (['/api/auth/me', '/api/dashboard', '/api/trucks'] as $path) {
            $this->withHeaders($this->bearer($targetToken))
                ->getJson($path)
                ->assertStatus(401)
                ->assertJsonPath('ok', false)
                ->assertJsonPath('field', 'session')
                ->assertJsonPath('message', 'This account has been suspended. Please contact the platform administrator.');
        }

        // Reactivation brings the very same session back — nothing was revoked
        // or rotated, only gated on status.
        $this->withHeaders($this->bearer($this->tokenFor($admin['id'])))
            ->patchJson("/api/admin/users/{$target['id']}", ['status' => 'active'])
            ->assertOk();

        $this->withHeaders($this->bearer($targetToken))
            ->getJson('/api/auth/me')
            ->assertOk()
            ->assertJsonPath('user.id', $target['id']);
    }

    public function test_accounts_without_the_status_migration_keep_working_as_active(): void
    {
        // users.status is an optional migration (supabase_admin.sql): a row
        // without the column must sign in and keep its sessions.
        $user = $this->seedUser(['password' => 'secret123']);
        $this->assertArrayNotHasKey('status', $this->db->selectOne('users', ['id' => 'eq.'.$user['id']]));

        $this->postJson('/api/auth/login', [
            'identifier' => $user['identifier'],
            'password' => 'secret123',
        ])->assertOk();

        $this->withHeaders($this->bearer($this->tokenFor($user['id'])))
            ->getJson('/api/dashboard')
            ->assertOk();
    }

    /**
     * A ledger row with the split the database itself would accept, on its own
     * load and booking (commissions carry a unique booking_id and only one
     * LIVE row per load).
     */
    private function seedLedgerRow(
        string $cargoOwner,
        string $truckOwner,
        string $truckId,
        float $price,
        string $status,
    ): void {
        $split = CommissionCalculator::calculate($price);
        $load = $this->seedCargo($cargoOwner, ['budget' => $price]);
        $booking = $this->seedBooking($cargoOwner, $truckOwner, $truckId, $load['id'], ['price' => $price]);

        $this->db->insert('commissions', array_merge($split, [
            'cargo_id' => $load['id'],
            'booking_id' => $booking['id'],
            'currency' => 'TZS',
            'status' => $status,
            'earned_at' => in_array($status, ['earned', 'paid'], true) ? now()->toIso8601String() : null,
            'paid_at' => $status === 'paid' ? now()->toIso8601String() : null,
            'payment_reference' => $status === 'paid' ? 'MP-SEED-0001' : null,
        ]));
    }
}
