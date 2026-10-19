<?php

namespace Tests\Feature;

use App\Exceptions\DataStoreUnavailable;
use App\Services\CommissionCalculator;
use App\Services\CommissionService;
use App\Services\SupabaseClient;
use Tests\Support\FakeSupabaseClient;

/**
 * 8% platform commission (Smarters Freight revenue rule).
 *
 *   TZS 1,000,000 cargo → commission TZS 80,000 → provider net TZS 920,000
 *
 * Covers: server-side calculation (the app can never submit an amount),
 * recording on the ACCEPT qualifying event, repeated requests and booking
 * conflicts, cancellation/refund handling, the pending → earned → paid
 * transitions (settling demands payment evidence), revenue totals that never
 * double-count, and admin-only authorization on every revenue endpoint.
 */
class CommissionTest extends ApiTestCase
{
    public function test_accepting_a_booking_records_the_8_percent_commission(): void
    {
        [$truckOwner, $load, , $booking] = $this->pendingBooking(['price' => 1000000]);

        $response = $this->withHeaders($this->bearer($this->tokenFor($truckOwner['id'])))
            ->postJson('/api/bookings/'.$booking['id'].'/accept');

        $response->assertOk()->assertJsonPath('ok', true);

        // Presented in the accept response…
        $response->assertJsonPath('commission.cargoPrice', 1000000)
            ->assertJsonPath('commission.commissionRate', 8)
            ->assertJsonPath('commission.commissionAmount', 80000)
            ->assertJsonPath('commission.providerNetAmount', 920000)
            ->assertJsonPath('commission.status', 'pending')
            ->assertJsonPath('commission.currency', 'TZS');

        // …and persisted in the ledger, not merely computed for the reply.
        $row = $this->db->selectOne('commissions', ['booking_id' => 'eq.'.$booking['id']]);
        $this->assertNotNull($row);
        $this->assertSame($load['id'], $row['cargo_id']);
        $this->assertSame('pending', $row['status']);
        $this->assertAmount(1000000, $row['cargo_price']);
        $this->assertAmount(8, $row['commission_rate']);
        $this->assertAmount(80000, $row['commission_amount']);
        $this->assertAmount(920000, $row['provider_net_amount']);
        $this->assertNull($row['paid_at'] ?? null);
        $this->assertNull($row['payment_reference'] ?? null);
    }

    public function test_the_agreed_price_falls_back_to_the_posted_cargo_price(): void
    {
        // The booking carries no quote, so the load's posted price applies.
        [$owner, , , $booking] = $this->pendingBooking(['price' => null], ['budget' => 500000]);

        $this->withHeaders($this->bearer($this->tokenFor($owner['id'])))
            ->postJson('/api/bookings/'.$booking['id'].'/accept')
            ->assertOk()
            ->assertJsonPath('commission.cargoPrice', 500000)
            ->assertJsonPath('commission.commissionAmount', 40000)
            ->assertJsonPath('commission.providerNetAmount', 460000);
    }

    public function test_a_load_without_any_agreed_price_gets_no_commission(): void
    {
        [$owner, , , $booking] = $this->pendingBooking(['price' => null], ['budget' => null]);

        // Booking still succeeds — nothing is invented where no price exists.
        $this->withHeaders($this->bearer($this->tokenFor($owner['id'])))
            ->postJson('/api/bookings/'.$booking['id'].'/accept')
            ->assertOk()
            ->assertJsonPath('booking.status', 'accepted')
            ->assertJsonPath('commission', null);

        $this->assertSame([], $this->db->select('commissions'));
    }

    public function test_repeated_requests_never_generate_the_commission_twice(): void
    {
        [$owner, $load, , $booking] = $this->pendingBooking(['price' => 1000000]);
        $token = $this->tokenFor($owner['id']);

        $this->withHeaders($this->bearer($token))
            ->postJson('/api/bookings/'.$booking['id'].'/accept')
            ->assertOk();

        // The same request replayed: the booking is already accepted (409)
        // and a second record is impossible (unique index on booking_id).
        $this->withHeaders($this->bearer($token))
            ->postJson('/api/bookings/'.$booking['id'].'/accept')
            ->assertStatus(409);

        $this->assertCount(1, $this->db->select('commissions'));

        // Even a direct, repeated write converges on the single stored row.
        $service = $this->app->make(CommissionService::class);
        $first = $service->recordForBooking($booking, $load);
        $second = $service->recordForBooking($booking, $load);

        $this->assertCount(1, $this->db->select('commissions'));
        $this->assertSame($first['id'], $second['id']);
        $this->assertAmount(80000, $second['commission_amount']);
    }

    public function test_a_competing_booking_conflict_leaves_a_single_commission(): void
    {
        [$owner, $load, , $bookingA] = $this->pendingBooking(['price' => 1000000]);
        $cargoOwner = $this->seedUser();
        $truckB = $this->seedTruck($owner['id'], ['registration_number' => 'T LOSE2']);
        $token = $this->tokenFor($owner['id']);

        $this->withHeaders($this->bearer($token))
            ->postJson('/api/bookings/'.$bookingA['id'].'/accept')
            ->assertOk();

        // B was requested before A won the load — accepting it must fail.
        $bookingB = $this->db->insert('bookings', [
            'cargo_id' => $load['id'],
            'truck_id' => $truckB['id'],
            'requester_id' => $cargoOwner['id'],
            'responder_id' => $owner['id'],
            'status' => 'pending',
            'price' => 1000000,
            'currency' => 'TZS',
            'requested_at' => now()->toIso8601String(),
        ]);

        $this->withHeaders($this->bearer($token))
            ->postJson('/api/bookings/'.$bookingB['id'].'/accept')
            ->assertStatus(409);

        $commissions = $this->db->select('commissions');
        $this->assertCount(1, $commissions);
        $this->assertSame($bookingA['id'], $commissions[0]['booking_id']);
    }

    public function test_the_app_cannot_submit_its_own_commission_amount(): void
    {
        $cargoOwner = $this->seedUser();
        $token = $this->tokenFor($cargoOwner['id']);
        $truckOwner = $this->seedUser(['role' => 'truck_owner']);
        $truck = $this->seedTruck($truckOwner['id']);

        // Posting a load: every commission field in the body is ignored.
        $created = $this->withHeaders($this->bearer($token))->postJson('/api/cargo', [
            'cargoType' => 'General cargo',
            'weightTons' => 10,
            'pickupLocation' => 'Dar es Salaam',
            'destination' => 'Nairobi',
            'pickupDate' => '2026-10-10',
            'budget' => 1000000,
            'commissionAmount' => 1,
            'commissionRate' => 0.01,
            'providerNetAmount' => 999999,
        ]);
        $created->assertStatus(201);

        $loadId = (string) $created->json('cargo.id');
        $booking = $this->seedBooking($cargoOwner['id'], $truckOwner['id'], $truck['id'], $loadId, [
            'price' => 1000000,
        ]);

        $this->withHeaders($this->bearer($this->tokenFor($truckOwner['id'])))
            ->postJson('/api/bookings/'.$booking['id'].'/accept')
            ->assertOk()
            ->assertJsonPath('commission.commissionAmount', 80000);

        // A commission edit has nowhere to go through the cargo endpoint.
        $this->withHeaders($this->bearer($token))
            ->patchJson('/api/cargo/'.$loadId, ['commissionAmount' => 1])
            ->assertStatus(422);

        $row = $this->db->selectOne('commissions', ['booking_id' => 'eq.'.$booking['id']]);
        $this->assertAmount(1000000, $row['cargo_price']);
        $this->assertAmount(80000, $row['commission_amount']);
        $this->assertAmount(920000, $row['provider_net_amount']);
    }

    public function test_a_user_cannot_change_another_users_agreed_price(): void
    {
        $owner = $this->seedUser();
        $stranger = $this->seedUser();
        $load = $this->seedCargo($owner['id'], ['budget' => 1000000]);

        $this->withHeaders($this->bearer($this->tokenFor($stranger['id'])))
            ->patchJson('/api/cargo/'.$load['id'], ['budget' => 1])
            ->assertStatus(404)
            ->assertJsonPath('field', 'cargo');

        $this->assertAmount(
            1000000,
            $this->db->selectOne('cargo', ['id' => 'eq.'.$load['id']])['budget'],
        );
    }

    public function test_delivering_the_load_earns_the_commission(): void
    {
        $admin = $this->seedUser(['role' => 'admin']);
        $cargoOwner = $this->seedUser();
        [$truckOwner, $load, , $booking] = $this->pendingBooking(['price' => 1000000], [], $cargoOwner);

        $this->withHeaders($this->bearer($this->tokenFor($truckOwner['id'])))
            ->postJson('/api/bookings/'.$booking['id'].'/accept')
            ->assertJsonPath('commission.status', 'pending');

        $this->withHeaders($this->bearer($this->tokenFor($cargoOwner['id'])))
            ->patchJson('/api/cargo/'.$load['id'], ['status' => 'delivered'])
            ->assertOk();

        $row = $this->db->selectOne('commissions', ['booking_id' => 'eq.'.$booking['id']]);
        $this->assertSame('earned', $row['status']);
        $this->assertNotNull($row['earned_at']);

        $totals = $this->revenue($admin['id'])['totals'];
        $this->assertAmount(0, $totals['pendingCommission']);
        $this->assertAmount(80000, $totals['earnedCommission']);
        $this->assertAmount(0, $totals['paidCommission']);
        $this->assertAmount(80000, $totals['liveCommission']);
        $this->assertSame(1, $totals['completedShipments']);
    }

    public function test_cancelling_the_booking_removes_the_commission_from_revenue(): void
    {
        $admin = $this->seedUser(['role' => 'admin']);
        $cargoOwner = $this->seedUser();
        [$truckOwner, $load, , $booking] = $this->pendingBooking(['price' => 1000000], [], $cargoOwner);
        $token = $this->tokenFor($truckOwner['id']);

        $this->withHeaders($this->bearer($token))->postJson('/api/bookings/'.$booking['id'].'/accept')->assertOk();

        $this->withHeaders($this->bearer($this->tokenFor($cargoOwner['id'])))
            ->postJson('/api/bookings/'.$booking['id'].'/cancel')
            ->assertOk();

        $row = $this->db->selectOne('commissions', ['booking_id' => 'eq.'.$booking['id']]);
        $this->assertSame('cancelled', $row['status']);
        $this->assertNotNull($row['cancelled_at']);

        $totals = $this->revenue($admin['id'])['totals'];
        $this->assertAmount(0, $totals['pendingCommission']);
        $this->assertAmount(0, $totals['earnedCommission']);
        // The cancelled record is reported separately and counts for nothing.
        $this->assertAmount(80000, $totals['cancelledCommission']);
        $this->assertAmount(0, $totals['liveCommission']);
        $this->assertAmount(0, $totals['cargoValue']);

        // The load is free again — a second booking earns its own record.
        $truckB = $this->seedTruck($truckOwner['id'], ['registration_number' => 'T REBOOK']);
        $second = $this->seedBooking($cargoOwner['id'], $truckOwner['id'], $truckB['id'], $load['id'], [
            'price' => 1000000,
        ]);

        $this->withHeaders($this->bearer($token))->postJson('/api/bookings/'.$second['id'].'/accept')->assertOk();

        $this->assertCount(2, $this->db->select('commissions'));
        $totals = $this->revenue($admin['id'])['totals'];
        $this->assertAmount(80000, $totals['pendingCommission']);
        $this->assertAmount(1000000, $totals['cargoValue']);
    }

    public function test_cancelling_the_load_removes_its_commission_from_revenue(): void
    {
        $admin = $this->seedUser(['role' => 'admin']);
        $cargoOwner = $this->seedUser();
        [$truckOwner, $load, , $booking] = $this->pendingBooking(['price' => 2000000], [], $cargoOwner);

        $this->withHeaders($this->bearer($this->tokenFor($truckOwner['id'])))
            ->postJson('/api/bookings/'.$booking['id'].'/accept')
            ->assertOk();

        $this->withHeaders($this->bearer($this->tokenFor($cargoOwner['id'])))
            ->patchJson('/api/cargo/'.$load['id'], ['status' => 'cancelled'])
            ->assertOk();

        $row = $this->db->selectOne('commissions', ['booking_id' => 'eq.'.$booking['id']]);
        $this->assertSame('cancelled', $row['status']);

        $totals = $this->revenue($admin['id'])['totals'];
        $this->assertAmount(160000, $totals['cancelledCommission']);
        $this->assertAmount(0, $totals['liveCommission']);
        $this->assertAmount(0, $totals['cargoValue']);
    }

    public function test_invalid_or_negative_prices_are_rejected(): void
    {
        $cargoOwner = $this->seedUser();
        $truckOwner = $this->seedUser(['role' => 'truck_owner']);
        $load = $this->seedCargo($cargoOwner['id']);
        $truck = $this->seedTruck($truckOwner['id']);

        $this->withHeaders($this->bearer($this->tokenFor($cargoOwner['id'])))->postJson('/api/bookings', [
            'truckId' => $truck['id'],
            'cargoId' => $load['id'],
            'price' => -1000000,
        ])->assertStatus(422)->assertJsonPath('field', 'price');

        $this->withHeaders($this->bearer($this->tokenFor($cargoOwner['id'])))->postJson('/api/bookings', [
            'truckId' => $truck['id'],
            'cargoId' => $load['id'],
            'price' => 0,
        ])->assertStatus(422)->assertJsonPath('field', 'price');

        $this->withHeaders($this->bearer($this->tokenFor($cargoOwner['id'])))->postJson('/api/cargo', [
            'cargoType' => 'General cargo',
            'weightTons' => 10,
            'pickupLocation' => 'Dar es Salaam',
            'destination' => 'Nairobi',
            'pickupDate' => '2026-10-10',
            'budget' => -5000,
        ])->assertStatus(422)->assertJsonPath('field', 'budget');

        $this->assertSame([], $this->db->select('commissions'));
    }

    public function test_revenue_endpoints_are_denied_to_non_admins(): void
    {
        $owner = $this->seedUser();
        $cargoOwner = $this->seedUser();
        $truckOwner = $this->seedUser(['role' => 'truck_owner']);
        $load = $this->seedCargo($cargoOwner['id']);
        $truck = $this->seedTruck($truckOwner['id']);
        $booking = $this->seedBooking($cargoOwner['id'], $truckOwner['id'], $truck['id'], $load['id'], [
            'price' => 1000000,
        ]);

        $this->withHeaders($this->bearer($this->tokenFor($truckOwner['id'])))
            ->postJson('/api/bookings/'.$booking['id'].'/accept')
            ->assertOk();

        $commissionId = (string) $this->db->selectOne('commissions', ['booking_id' => 'eq.'.$booking['id']])['id'];

        // Anonymous callers get 401 before any role answer leaks out.
        // (withHeaders() persists for the rest of the test — drop the token.)
        $this->flushHeaders();
        $this->getJson('/api/admin/revenue')->assertStatus(401);
        $this->postJson('/api/admin/commissions/'.$commissionId.'/settle', [])->assertStatus(401);

        // Signed in, but not an admin.
        $headers = $this->bearer($this->tokenFor($owner['id']));
        $this->withHeaders($headers)->getJson('/api/admin/revenue')
            ->assertStatus(403)
            ->assertJsonPath('field', 'role');

        $this->withHeaders($headers)
            ->postJson('/api/admin/commissions/'.$commissionId.'/settle', ['paymentReference' => 'MP-1'])
            ->assertStatus(403)
            ->assertJsonPath('field', 'role');

        $this->withHeaders($headers)
            ->postJson('/api/admin/commissions/'.$commissionId.'/refund', ['reason' => 'not mine'])
            ->assertStatus(403);

        // Nothing moved: still pending and unpaid.
        $row = $this->db->selectOne('commissions', ['id' => 'eq.'.$commissionId]);
        $this->assertSame('pending', $row['status']);
        $this->assertNull($row['payment_reference'] ?? null);
    }

    public function test_a_transient_data_store_outage_does_not_lose_the_commission(): void
    {
        $cargoOwner = $this->seedUser();
        $truckOwner = $this->seedUser(['role' => 'truck_owner']);
        $load = $this->seedCargo($cargoOwner['id']);
        $truck = $this->seedTruck($truckOwner['id']);
        $booking = $this->seedBooking($cargoOwner['id'], $truckOwner['id'], $truck['id'], $load['id'], [
            'price' => 1000000,
        ]);

        // First ledger write dies on a dropped connection; the retry lands.
        $flaky = new class extends FakeSupabaseClient
        {
            public int $commissionInserts = 0;

            public function insert(string $table, array $values): array
            {
                if ($table === 'commissions') {
                    $this->commissionInserts++;
                    if ($this->commissionInserts === 1) {
                        throw new DataStoreUnavailable('Cannot reach Supabase REST API: cURL error 28', 503);
                    }
                }

                return parent::insert($table, $values);
            }
        };
        // Mint the token BEFORE swapping, so it exists in the store the API
        // will actually read (the swapped-in double carries a table snapshot).
        $token = $this->tokenFor($truckOwner['id']);

        $flaky->tables = $this->db->tables;
        $this->app->instance(SupabaseClient::class, $flaky);

        $this->withHeaders($this->bearer($token))
            ->postJson('/api/bookings/'.$booking['id'].'/accept')
            ->assertOk()
            ->assertJsonPath('commission.commissionAmount', 80000);

        $this->assertSame(2, $flaky->commissionInserts, 'The ledger write must be retried once.');
        $this->assertCount(1, $flaky->select('commissions'));
        $row = $flaky->selectOne('commissions', ['booking_id' => 'eq.'.$booking['id']]);
        $this->assertAmount(80000, $row['commission_amount']);
    }

    public function test_admin_totals_cover_every_bucket_without_double_counting(): void
    {
        $admin = $this->seedUser(['role' => 'admin']);
        $cargoOwner = $this->seedUser();
        $truckOwner = $this->seedUser(['role' => 'truck_owner']);
        $truck = $this->seedTruck($truckOwner['id']);

        $pending = $this->ledgerRow($cargoOwner, $truckOwner, $truck, 1000000, 'pending');
        $earned = $this->ledgerRow($cargoOwner, $truckOwner, $truck, 500000, 'earned');
        $paid = $this->ledgerRow($cargoOwner, $truckOwner, $truck, 2000000, 'paid');
        $this->ledgerRow($cargoOwner, $truckOwner, $truck, 1000000, 'cancelled');
        $this->ledgerRow($cargoOwner, $truckOwner, $truck, 1000000, 'refunded');

        // Completed shipments are counted from real load states.
        $this->seedCargo($cargoOwner['id'], ['status' => 'delivered', 'reference' => 'CG-DONE1']);
        $this->seedCargo($cargoOwner['id'], ['status' => 'completed', 'reference' => 'CG-DONE2']);
        $this->seedCargo($cargoOwner['id'], ['status' => 'posted', 'reference' => 'CG-OPEN1']);

        $payload = $this->revenue($admin['id']);

        $this->assertSame(8, (int) $payload['commissionRate']);
        $this->assertSame('TZS', $payload['currency']);

        $totals = $payload['totals'];
        // Only LIVE commissions carry cargo value (3 loads, never 5).
        $this->assertAmount(3500000, $totals['cargoValue']);
        $this->assertAmount(80000, $totals['pendingCommission']);
        $this->assertAmount(40000, $totals['earnedCommission']);
        $this->assertAmount(160000, $totals['paidCommission']);
        $this->assertAmount(80000, $totals['cancelledCommission']);
        $this->assertAmount(80000, $totals['refundedCommission']);
        $this->assertAmount(280000, $totals['liveCommission']);
        $this->assertSame(2, $totals['completedShipments']);

        $counts = $payload['counts'];
        $this->assertSame(1, $counts['pending']);
        $this->assertSame(1, $counts['earned']);
        $this->assertSame(1, $counts['paid']);
        $this->assertSame(1, $counts['cancelled']);
        $this->assertSame(1, $counts['refunded']);
        $this->assertSame(5, $counts['total']);

        // Records are traceable to the load and the booking behind them.
        $ids = array_column($payload['commissions'], 'id');
        $this->assertContains($pending['id'], $ids);
        $this->assertContains($earned['id'], $ids);
        $this->assertContains($paid['id'], $ids);

        foreach ($payload['commissions'] as $record) {
            $this->assertNotNull($record['cargo']['id'], 'Every commission must link to its load.');
            $this->assertNotNull($record['booking']['id'], 'Every commission must link to its booking.');
            $this->assertAmount(
                8,
                (float) $record['commissionAmount'] / (float) $record['cargoPrice'] * 100,
                'A listed commission must always be 8% of its price.',
            );
        }
    }

    public function test_settlement_requires_verified_payment_evidence(): void
    {
        $admin = $this->seedUser(['role' => 'admin']);
        $cargoOwner = $this->seedUser();
        $truckOwner = $this->seedUser(['role' => 'truck_owner']);
        $load = $this->seedCargo($cargoOwner['id']);
        $truck = $this->seedTruck($truckOwner['id']);
        $booking = $this->seedBooking($cargoOwner['id'], $truckOwner['id'], $truck['id'], $load['id'], [
            'price' => 1000000,
        ]);

        $this->withHeaders($this->bearer($this->tokenFor($truckOwner['id'])))
            ->postJson('/api/bookings/'.$booking['id'].'/accept')
            ->assertOk();

        $commissionId = (string) $this->db->selectOne('commissions', ['booking_id' => 'eq.'.$booking['id']])['id'];
        $headers = $this->bearer($this->tokenFor($admin['id']));

        // No evidence → refused, and nothing is marked as received.
        $this->withHeaders($headers)
            ->postJson('/api/admin/commissions/'.$commissionId.'/settle', [])
            ->assertStatus(422)
            ->assertJsonPath('field', 'paymentReference');

        $this->assertSame('pending', $this->db->selectOne('commissions', ['id' => 'eq.'.$commissionId])['status']);

        $this->withHeaders($headers)
            ->postJson('/api/admin/commissions/'.$commissionId.'/settle', ['paymentReference' => 'MP-881320491'])
            ->assertOk()
            ->assertJsonPath('commission.status', 'paid')
            ->assertJsonPath('commission.paymentReference', 'MP-881320491');

        $this->assertNotNull($this->db->selectOne('commissions', ['id' => 'eq.'.$commissionId])['paid_at']);

        $totals = $this->revenue($admin['id'])['totals'];
        $this->assertAmount(0, $totals['pendingCommission']);
        $this->assertAmount(80000, $totals['paidCommission']);

        // A settled commission cannot be settled twice, nor rewound to pending.
        $this->withHeaders($headers)
            ->postJson('/api/admin/commissions/'.$commissionId.'/settle', ['paymentReference' => 'MP-AGAIN'])
            ->assertStatus(409)
            ->assertJsonPath('field', 'status');

        $this->assertSame(
            'MP-881320491',
            $this->db->selectOne('commissions', ['id' => 'eq.'.$commissionId])['payment_reference'],
        );
    }

    public function test_a_refund_takes_settled_money_out_of_the_paid_total(): void
    {
        $admin = $this->seedUser(['role' => 'admin']);
        $cargoOwner = $this->seedUser();
        $truckOwner = $this->seedUser(['role' => 'truck_owner']);
        $truck = $this->seedTruck($truckOwner['id']);
        $commission = $this->ledgerRow($cargoOwner, $truckOwner, $truck, 1000000, 'paid');
        $headers = $this->bearer($this->tokenFor($admin['id']));

        $this->assertAmount(80000, $this->revenue($admin['id'])['totals']['paidCommission']);

        // Reversing without a reason is refused.
        $this->withHeaders($headers)
            ->postJson('/api/admin/commissions/'.$commission['id'].'/refund', [])
            ->assertStatus(422)
            ->assertJsonPath('field', 'reason');

        $this->withHeaders($headers)
            ->postJson('/api/admin/commissions/'.$commission['id'].'/refund', [
                'reason' => 'Settled in error — provider paid directly',
            ])
            ->assertOk()
            ->assertJsonPath('commission.status', 'refunded');

        $totals = $this->revenue($admin['id'])['totals'];
        $this->assertAmount(0, $totals['paidCommission']);
        $this->assertAmount(80000, $totals['refundedCommission']);
        $this->assertAmount(0, $totals['liveCommission']);
        $this->assertAmount(0, $totals['cargoValue']);

        // Refunding twice is a conflict — history is never rewritten.
        $this->withHeaders($headers)
            ->postJson('/api/admin/commissions/'.$commission['id'].'/refund', ['reason' => 'again'])
            ->assertStatus(409);
    }

    public function test_unknown_commission_ids_answer_with_a_404(): void
    {
        $admin = $this->seedUser(['role' => 'admin']);
        $headers = $this->bearer($this->tokenFor($admin['id']));

        $this->withHeaders($headers)
            ->postJson('/api/admin/commissions/whatever/settle', ['paymentReference' => 'MP-123456'])
            ->assertStatus(404)
            ->assertJsonPath('field', 'commission');

        $this->withHeaders($headers)
            ->postJson('/api/admin/commissions/00000000-0000-4000-8000-000000000000/settle', [
                'paymentReference' => 'MP-123456',
            ])
            ->assertStatus(404)
            ->assertJsonPath('field', 'commission');
    }

    public function test_an_empty_ledger_reports_zeroed_totals(): void
    {
        $admin = $this->seedUser(['role' => 'admin']);
        $payload = $this->revenue($admin['id']);

        $this->assertAmount(0, $payload['totals']['cargoValue']);
        $this->assertAmount(0, $payload['totals']['pendingCommission']);
        $this->assertAmount(0, $payload['totals']['earnedCommission']);
        $this->assertAmount(0, $payload['totals']['paidCommission']);
        $this->assertSame(0, $payload['totals']['completedShipments']);
        $this->assertSame([], $payload['commissions']);
        $this->assertSame(0, $payload['counts']['total']);
        $this->assertSame(8, (int) $payload['commissionRate']);
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    /**
     * A load, a truck and a PENDING booking request ready to be accepted.
     *
     * @param  array<string, mixed>  $bookingOverrides
     * @param  array<string, mixed>  $cargoOverrides
     * @return array{0: array{id: string, role: string}, 1: array<string, mixed>, 2: array<string, mixed>, 3: array<string, mixed>}
     */
    private function pendingBooking(
        array $bookingOverrides = [],
        array $cargoOverrides = [],
        ?array $cargoOwner = null,
    ): array {
        $cargoOwner ??= $this->seedUser();
        $truckOwner = $this->seedUser(['role' => 'truck_owner']);
        $load = $this->seedCargo($cargoOwner['id'], $cargoOverrides);
        $truck = $this->seedTruck($truckOwner['id']);
        $booking = $this->seedBooking($cargoOwner['id'], $truckOwner['id'], $truck['id'], $load['id'], $bookingOverrides);

        return [$truckOwner, $load, $truck, $booking];
    }

    /**
     * Writes a ledger row exactly where the accept flow would, with the split
     * the database itself would accept.
     *
     * @param  array<string, mixed>  $cargoOwner
     * @param  array<string, mixed>  $truckOwner
     * @param  array<string, mixed>  $truck
     * @return array<string, mixed>
     */
    private function ledgerRow(
        array $cargoOwner,
        array $truckOwner,
        array $truck,
        float $price,
        string $status,
    ): array {
        $split = CommissionCalculator::calculate($price);
        $load = $this->seedCargo($cargoOwner['id'], ['budget' => $price]);
        $booking = $this->seedBooking($cargoOwner['id'], $truckOwner['id'], $truck['id'], $load['id'], [
            'price' => $price,
        ]);

        return $this->db->insert('commissions', array_merge($split, [
            'cargo_id' => $load['id'],
            'booking_id' => $booking['id'],
            'currency' => 'TZS',
            'status' => $status,
            'earned_at' => in_array($status, ['earned', 'paid'], true) ? now()->toIso8601String() : null,
            'paid_at' => $status === 'paid' ? now()->toIso8601String() : null,
            'payment_reference' => $status === 'paid' ? 'MP-SEED-0001' : null,
            'cancelled_at' => $status === 'cancelled' ? now()->toIso8601String() : null,
            'refunded_at' => $status === 'refunded' ? now()->toIso8601String() : null,
        ]));
    }

    /** @return array<string, mixed> */
    private function revenue(string $adminId): array
    {
        $response = $this->withHeaders($this->bearer($this->tokenFor($adminId)))
            ->getJson('/api/admin/revenue');

        $response->assertOk()->assertJsonPath('ok', true);

        return $response->json();
    }

    /**
     * Money assertions must survive the JSON round trip, where a whole-float
     * like 80000.0 comes back as the integer 80000.
     */
    private function assertAmount(float $expected, mixed $actual, string $message = ''): void
    {
        $this->assertTrue(
            is_int($actual) || is_float($actual) || is_string($actual),
            $message !== '' ? $message : 'Expected a numeric amount, got '.get_debug_type($actual),
        );

        $this->assertEqualsWithDelta($expected, (float) $actual, 0.001, $message);
    }
}
