<?php

namespace Tests\Unit;

use App\Services\BookingService;
use App\Services\MatchingEngine;
use PHPUnit\Framework\TestCase;
use Tests\Support\FakeSupabaseClient;

class BookingServiceTest extends TestCase
{
    private FakeSupabaseClient $supabase;

    private BookingService $bookings;

    protected function setUp(): void
    {
        parent::setUp();

        $this->supabase = new FakeSupabaseClient;
        $this->supabase->tables['trucks'] = [[
            'id' => 't1',
            'owner_id' => 'owner-t',
            'registration_number' => 'T 123 ABC',
            'truck_type' => 'Flatbed',
            'capacity_tons' => 20,
            'current_location' => 'Dar es Salaam',
            'availability_date' => '2026-10-01',
            'rate_per_ton' => 1000,
            'status' => 'available',
            'matched_cargo_id' => null,
            'matched_at' => null,
        ]];
        $this->supabase->tables['cargo'] = [[
            'id' => 'c1',
            'owner_id' => 'owner-c',
            'reference' => 'CG-ABC123',
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
        ]];

        $this->bookings = new BookingService($this->supabase, new MatchingEngine);
    }

    /** @return array<string, mixed> */
    private function cargo(): array
    {
        return $this->supabase->selectOne('cargo', ['id' => 'eq.c1']);
    }

    /** @return array<string, mixed> */
    private function truck(): array
    {
        return $this->supabase->selectOne('trucks', ['id' => 'eq.t1']);
    }

    /** @param array<string, mixed> $overrides */
    private function seedBooking(array $overrides = []): array
    {
        return $this->supabase->insert('bookings', array_merge([
            'id' => 'b1',
            'cargo_id' => 'c1',
            'truck_id' => 't1',
            'requester_id' => 'owner-c',
            'responder_id' => 'owner-t',
            'status' => 'pending',
            'price' => 10000,
            'currency' => 'TZS',
            'message' => null,
            'requested_at' => now()->toIso8601String(),
        ], $overrides));
    }

    public function test_request_creates_a_pending_booking_with_the_counterparty_as_responder(): void
    {
        $result = $this->bookings->request('owner-c', 't1', 'c1');

        $this->assertTrue($result['ok']);
        $this->assertSame('pending', $result['booking']['status']);
        $this->assertSame('owner-c', $result['booking']['requester_id']);
        $this->assertSame('owner-t', $result['booking']['responder_id']);

        // Nothing is reserved until the counterparty accepts.
        $this->assertSame('available', $this->truck()['status']);
        $this->assertSame('posted', $this->cargo()['status']);
    }

    public function test_request_rejects_a_caller_who_owns_neither_side(): void
    {
        $result = $this->bookings->request('stranger', 't1', 'c1');

        $this->assertFalse($result['ok']);
        $this->assertSame(403, $result['status']);
        $this->assertSame([], $this->supabase->select('bookings'));
    }

    public function test_request_rejects_a_truck_that_is_no_longer_available(): void
    {
        $this->supabase->update('trucks', 'id', 'eq.t1', ['status' => 'booked']);

        $result = $this->bookings->request('owner-c', 't1', 'c1');

        $this->assertFalse($result['ok']);
        $this->assertSame(409, $result['status']);
        $this->assertSame('truck', $result['field']);
    }

    public function test_request_rejects_a_pair_that_no_longer_matches(): void
    {
        $this->supabase->update('cargo', 'id', 'eq.c1', ['weight_tons' => 99]);

        $result = $this->bookings->request('owner-c', 't1', 'c1');

        $this->assertFalse($result['ok']);
        $this->assertSame(422, $result['status']);
    }

    public function test_accept_reserves_both_sides_and_links_them(): void
    {
        $this->seedBooking();

        $result = $this->bookings->accept('owner-t', 'b1');

        $this->assertTrue($result['ok']);
        $this->assertSame('booked', $this->truck()['status']);
        $this->assertSame('c1', $this->truck()['matched_cargo_id']);
        $this->assertSame('booked', $this->cargo()['status']);
        $this->assertSame('t1', $this->cargo()['matched_truck_id']);
        $this->assertNotNull($this->cargo()['matched_at']);
    }

    public function test_accept_is_forbidden_for_the_requester(): void
    {
        $this->seedBooking();

        $result = $this->bookings->accept('owner-c', 'b1');

        $this->assertFalse($result['ok']);
        $this->assertSame(403, $result['status']);
        $this->assertSame('available', $this->truck()['status']);
    }

    public function test_accept_returns_not_found_for_unknown_ids(): void
    {
        $result = $this->bookings->accept('owner-t', 'nope');

        $this->assertFalse($result['ok']);
        $this->assertSame(404, $result['status']);
    }

    public function test_reject_closes_the_request(): void
    {
        $this->seedBooking();

        $result = $this->bookings->reject('owner-t', 'b1');

        $this->assertTrue($result['ok']);
        $this->assertSame('rejected', $this->supabase->selectOne('bookings', ['id' => 'eq.b1'])['status']);
    }

    public function test_cancel_returns_an_accepted_booking_to_the_marketplace(): void
    {
        $this->seedBooking();
        $this->bookings->accept('owner-t', 'b1');

        $result = $this->bookings->cancel('owner-c', 'b1');

        $this->assertTrue($result['ok']);
        $this->assertSame('cancelled', $this->supabase->selectOne('bookings', ['id' => 'eq.b1'])['status']);
        $this->assertSame('available', $this->truck()['status']);
        $this->assertSame('posted', $this->cargo()['status']);
    }

    public function test_release_for_cargo_frees_the_truck(): void
    {
        $this->seedBooking();
        $this->bookings->accept('owner-t', 'b1');

        $this->bookings->releaseForCargo($this->cargo());

        $this->assertSame('available', $this->truck()['status']);
        $this->assertNull($this->truck()['matched_cargo_id']);
        $this->assertNull($this->cargo()['matched_truck_id']);
    }

    public function test_release_for_truck_sends_the_load_back_to_the_market(): void
    {
        $this->seedBooking();
        $this->bookings->accept('owner-t', 'b1');

        $this->bookings->releaseForTruck($this->truck());

        $this->assertSame('posted', $this->cargo()['status']);
        $this->assertNull($this->cargo()['matched_truck_id']);
        $this->assertNull($this->truck()['matched_cargo_id']);
    }

    public function test_with_matched_trucks_attaches_the_counterpart(): void
    {
        $this->seedBooking();
        $this->bookings->accept('owner-t', 'b1');

        $rows = $this->bookings->withMatchedTrucks($this->supabase->select('cargo', []));

        $this->assertSame('T 123 ABC', $rows[0]['matched_truck']['registration_number']);
    }
}
