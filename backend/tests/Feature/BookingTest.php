<?php

namespace Tests\Feature;

use App\Services\SupabaseClient;
use Tests\Support\FakeSupabaseClient;

/**
 * Matching + booking requests (SRS §18–§22): role-aware results, the request →
 * accept/reject/cancel lifecycle, cross-owner rules and the atomic transaction
 * that stops a truck or load being booked twice.
 */
class BookingTest extends ApiTestCase
{
    public function test_a_cargo_owner_sees_available_trucks_ranked_for_their_load(): void
    {
        $cargoOwner = $this->seedUser();
        $truckOwner = $this->seedUser(['role' => 'truck_owner']);
        $token = $this->tokenFor($cargoOwner['id']);

        $this->seedCargo($cargoOwner['id'], [
            'pickup_location' => 'Dar es Salaam',
            'destination_location' => 'Nairobi',
            'weight_tons' => 10,
            'pickup_date' => '2026-10-10',
        ]);
        $this->seedTruck($truckOwner['id'], [
            'current_location' => 'Dar es Salaam',
            'capacity_tons' => 20,
            'availability_date' => '2026-10-01',
        ]);
        // Too small to carry the load — must be dropped, not ranked.
        $this->seedTruck($truckOwner['id'], [
            'registration_number' => 'T SMALL1',
            'capacity_tons' => 5,
            'availability_date' => '2026-10-01',
        ]);

        $response = $this->withHeaders($this->bearer($token))->getJson('/api/matches');

        $response->assertOk()
            ->assertJsonPath('ok', true)
            ->assertJsonPath('role', 'cargo_owner');

        $matches = $response->json('matches');
        $this->assertCount(1, $matches);
        $this->assertGreaterThanOrEqual(90, $matches[0]['score']);
        $this->assertSame('excellent', $matches[0]['category']);
    }

    public function test_match_details_are_scoped_to_the_callers_own_records(): void
    {
        $mine = $this->seedUser();
        $other = $this->seedUser();
        $token = $this->tokenFor($mine['id']);
        $foreignCargo = $this->seedCargo($other['id']);

        $this->withHeaders($this->bearer($token))
            ->getJson('/api/matches/cargo/'.$foreignCargo['id'])
            ->assertStatus(404)
            ->assertJsonPath('field', 'cargo');

        $this->withHeaders($this->bearer($token))
            ->getJson('/api/matches/truck/'.$foreignCargo['id'])
            ->assertStatus(404)
            ->assertJsonPath('field', 'truck');
    }

    public function test_a_party_can_request_a_booking_and_the_counterparty_owns_it(): void
    {
        $cargoOwner = $this->seedUser();
        $truckOwner = $this->seedUser(['role' => 'truck_owner']);
        $token = $this->tokenFor($cargoOwner['id']);

        $truck = $this->seedTruck($truckOwner['id']);
        $load = $this->seedCargo($cargoOwner['id']);

        $response = $this->withHeaders($this->bearer($token))->postJson('/api/bookings', [
            'truckId' => $truck['id'],
            'cargoId' => $load['id'],
            'message' => 'Please carry this load',
        ]);

        $response->assertStatus(201)
            ->assertJsonPath('ok', true)
            ->assertJsonPath('booking.status', 'pending')
            ->assertJsonPath('booking.direction', 'outgoing');

        $row = $this->db->selectOne('bookings', ['id' => 'eq.'.$response->json('booking.id')]);
        $this->assertSame($cargoOwner['id'], $row['requester_id']);
        $this->assertSame($truckOwner['id'], $row['responder_id']);
        // Nothing is reserved until the counterparty accepts.
        $this->assertSame('available', $this->db->selectOne('trucks', ['id' => 'eq.'.$truck['id']])['status']);
        $this->assertSame('posted', $this->db->selectOne('cargo', ['id' => 'eq.'.$load['id']])['status']);
    }

    public function test_the_counterparty_accepts_and_both_sides_are_reserved(): void
    {
        $cargoOwner = $this->seedUser();
        $truckOwner = $this->seedUser(['role' => 'truck_owner']);
        $token = $this->tokenFor($truckOwner['id']);

        $truck = $this->seedTruck($truckOwner['id']);
        $load = $this->seedCargo($cargoOwner['id']);
        $booking = $this->seedBooking($cargoOwner['id'], $truckOwner['id'], $truck['id'], $load['id']);

        $response = $this->withHeaders($this->bearer($token))
            ->postJson('/api/bookings/'.$booking['id'].'/accept');

        $response->assertOk()
            ->assertJsonPath('booking.status', 'accepted')
            ->assertJsonPath('truck.status', 'booked')
            ->assertJsonPath('cargo.status', 'booked')
            ->assertJsonPath('truck.matchedCargoId', $load['id'])
            ->assertJsonPath('cargo.matchedTruckId', $truck['id']);

        $this->assertSame('booked', $this->db->selectOne('trucks', ['id' => 'eq.'.$truck['id']])['status']);
        $this->assertSame('booked', $this->db->selectOne('cargo', ['id' => 'eq.'.$load['id']])['status']);
    }

    public function test_the_requester_cannot_accept_their_own_request(): void
    {
        $cargoOwner = $this->seedUser();
        $truckOwner = $this->seedUser(['role' => 'truck_owner']);
        $token = $this->tokenFor($cargoOwner['id']);

        $truck = $this->seedTruck($truckOwner['id']);
        $load = $this->seedCargo($cargoOwner['id']);
        $booking = $this->seedBooking($cargoOwner['id'], $truckOwner['id'], $truck['id'], $load['id']);

        $this->withHeaders($this->bearer($token))
            ->postJson('/api/bookings/'.$booking['id'].'/accept')
            ->assertStatus(403)
            ->assertJsonPath('field', 'booking');

        $this->assertSame('available', $this->db->selectOne('trucks', ['id' => 'eq.'.$truck['id']])['status']);
    }

    public function test_only_a_party_may_request_a_booking(): void
    {
        $cargoOwner = $this->seedUser();
        $truckOwner = $this->seedUser(['role' => 'truck_owner']);
        $stranger = $this->seedUser();
        $token = $this->tokenFor($stranger['id']);

        $truck = $this->seedTruck($truckOwner['id']);
        $load = $this->seedCargo($cargoOwner['id']);

        $this->withHeaders($this->bearer($token))
            ->postJson('/api/bookings', ['truckId' => $truck['id'], 'cargoId' => $load['id']])
            ->assertStatus(403)
            ->assertJsonPath('field', 'match');

        $this->assertSame([], $this->db->select('bookings'));
    }

    public function test_a_duplicate_request_for_the_same_pair_is_rejected(): void
    {
        $cargoOwner = $this->seedUser();
        $truckOwner = $this->seedUser(['role' => 'truck_owner']);
        $token = $this->tokenFor($cargoOwner['id']);

        $truck = $this->seedTruck($truckOwner['id']);
        $load = $this->seedCargo($cargoOwner['id']);

        $this->withHeaders($this->bearer($token))
            ->postJson('/api/bookings', ['truckId' => $truck['id'], 'cargoId' => $load['id']])
            ->assertStatus(201);

        $this->withHeaders($this->bearer($token))
            ->postJson('/api/bookings', ['truckId' => $truck['id'], 'cargoId' => $load['id']])
            ->assertStatus(409)
            ->assertJsonPath('field', 'match');

        $this->assertCount(1, $this->db->select('bookings'));
    }

    public function test_accepting_one_request_rejects_the_competing_ones(): void
    {
        $cargoOwner = $this->seedUser();
        $truckOwner = $this->seedUser(['role' => 'truck_owner']);
        $token = $this->tokenFor($truckOwner['id']);

        $load = $this->seedCargo($cargoOwner['id']);
        $truckA = $this->seedTruck($truckOwner['id'], ['registration_number' => 'T A123']);
        $truckB = $this->seedTruck($truckOwner['id'], ['registration_number' => 'T B456']);
        $bookingA = $this->seedBooking($cargoOwner['id'], $truckOwner['id'], $truckA['id'], $load['id']);
        $bookingB = $this->seedBooking($cargoOwner['id'], $truckOwner['id'], $truckB['id'], $load['id']);

        $this->withHeaders($this->bearer($token))
            ->postJson('/api/bookings/'.$bookingA['id'].'/accept')
            ->assertOk();

        $this->assertSame('accepted', $this->db->selectOne('bookings', ['id' => 'eq.'.$bookingA['id']])['status']);
        $this->assertSame('rejected', $this->db->selectOne('bookings', ['id' => 'eq.'.$bookingB['id']])['status']);
    }

    public function test_the_counterparty_can_reject_a_request(): void
    {
        $cargoOwner = $this->seedUser();
        $truckOwner = $this->seedUser(['role' => 'truck_owner']);
        $token = $this->tokenFor($truckOwner['id']);

        $truck = $this->seedTruck($truckOwner['id']);
        $load = $this->seedCargo($cargoOwner['id']);
        $booking = $this->seedBooking($cargoOwner['id'], $truckOwner['id'], $truck['id'], $load['id']);

        $this->withHeaders($this->bearer($token))
            ->postJson('/api/bookings/'.$booking['id'].'/reject')
            ->assertOk()
            ->assertJsonPath('booking.status', 'rejected');

        $this->assertSame('rejected', $this->db->selectOne('bookings', ['id' => 'eq.'.$booking['id']])['status']);
    }

    public function test_the_requester_cannot_reject_their_own_request(): void
    {
        $cargoOwner = $this->seedUser();
        $truckOwner = $this->seedUser(['role' => 'truck_owner']);
        $token = $this->tokenFor($cargoOwner['id']);

        $truck = $this->seedTruck($truckOwner['id']);
        $load = $this->seedCargo($cargoOwner['id']);
        $booking = $this->seedBooking($cargoOwner['id'], $truckOwner['id'], $truck['id'], $load['id']);

        $this->withHeaders($this->bearer($token))
            ->postJson('/api/bookings/'.$booking['id'].'/reject')
            ->assertStatus(403)
            ->assertJsonPath('field', 'booking');
    }

    public function test_cancelling_a_pending_request_closes_it_for_either_party(): void
    {
        $cargoOwner = $this->seedUser();
        $truckOwner = $this->seedUser(['role' => 'truck_owner']);
        $token = $this->tokenFor($cargoOwner['id']);

        $truck = $this->seedTruck($truckOwner['id']);
        $load = $this->seedCargo($cargoOwner['id']);
        $booking = $this->seedBooking($cargoOwner['id'], $truckOwner['id'], $truck['id'], $load['id']);

        $this->withHeaders($this->bearer($token))
            ->postJson('/api/bookings/'.$booking['id'].'/cancel')
            ->assertOk()
            ->assertJsonPath('booking.status', 'cancelled');

        // Nothing was reserved, so the truck stays available.
        $this->assertSame('available', $this->db->selectOne('trucks', ['id' => 'eq.'.$truck['id']])['status']);
    }

    public function test_cancelling_an_accepted_booking_returns_both_to_the_marketplace(): void
    {
        $cargoOwner = $this->seedUser();
        $truckOwner = $this->seedUser(['role' => 'truck_owner']);
        $token = $this->tokenFor($cargoOwner['id']);

        $truck = $this->seedTruck($truckOwner['id']);
        $load = $this->seedCargo($cargoOwner['id']);
        $booking = $this->seedBooking($cargoOwner['id'], $truckOwner['id'], $truck['id'], $load['id'], ['status' => 'accepted']);
        $this->db->update('trucks', 'id', 'eq.'.$truck['id'], ['status' => 'booked', 'matched_cargo_id' => $load['id']]);
        $this->db->update('cargo', 'id', 'eq.'.$load['id'], ['status' => 'booked', 'matched_truck_id' => $truck['id']]);

        $this->withHeaders($this->bearer($token))
            ->postJson('/api/bookings/'.$booking['id'].'/cancel')
            ->assertOk()
            ->assertJsonPath('booking.status', 'cancelled');

        $this->assertSame('available', $this->db->selectOne('trucks', ['id' => 'eq.'.$truck['id']])['status']);
        $this->assertSame('posted', $this->db->selectOne('cargo', ['id' => 'eq.'.$load['id']])['status']);
        $this->assertNull($this->db->selectOne('trucks', ['id' => 'eq.'.$truck['id']])['matched_cargo_id']);
        $this->assertNull($this->db->selectOne('cargo', ['id' => 'eq.'.$load['id']])['matched_truck_id']);
    }

    public function test_an_ineligible_pair_cannot_be_requested(): void
    {
        $owner = $this->seedUser();
        $token = $this->tokenFor($owner['id']);
        $truck = $this->seedTruck($owner['id'], ['capacity_tons' => 5]);
        $load = $this->seedCargo($owner['id'], ['weight_tons' => 50]);

        $this->withHeaders($this->bearer($token))
            ->postJson('/api/bookings', ['truckId' => $truck['id'], 'cargoId' => $load['id']])
            ->assertStatus(422)
            ->assertJsonPath('field', 'match');
    }

    public function test_a_request_needs_a_free_truck_and_an_open_load(): void
    {
        $cargoOwner = $this->seedUser();
        $truckOwner = $this->seedUser(['role' => 'truck_owner']);
        $token = $this->tokenFor($cargoOwner['id']);

        $truck = $this->seedTruck($truckOwner['id'], ['status' => 'booked']);
        $load = $this->seedCargo($cargoOwner['id']);

        $this->withHeaders($this->bearer($token))
            ->postJson('/api/bookings', ['truckId' => $truck['id'], 'cargoId' => $load['id']])
            ->assertStatus(409)
            ->assertJsonPath('field', 'truck');
    }

    public function test_accepting_a_request_for_a_taken_truck_reports_a_conflict(): void
    {
        $cargoOwner = $this->seedUser();
        $truckOwner = $this->seedUser(['role' => 'truck_owner']);
        $token = $this->tokenFor($truckOwner['id']);

        $truck = $this->seedTruck($truckOwner['id'], ['status' => 'booked']);
        $load = $this->seedCargo($cargoOwner['id']);
        $booking = $this->seedBooking($cargoOwner['id'], $truckOwner['id'], $truck['id'], $load['id']);

        $this->withHeaders($this->bearer($token))
            ->postJson('/api/bookings/'.$booking['id'].'/accept')
            ->assertStatus(409)
            ->assertJsonPath('field', 'truck');
    }

    public function test_pricing_is_quoted_from_the_truck_rate(): void
    {
        $cargoOwner = $this->seedUser();
        $truckOwner = $this->seedUser(['role' => 'truck_owner']);
        $token = $this->tokenFor($cargoOwner['id']);

        $truck = $this->seedTruck($truckOwner['id'], ['rate_per_ton' => 1000]);
        $load = $this->seedCargo($cargoOwner['id'], ['weight_tons' => 10, 'currency' => 'TZS']);

        $this->withHeaders($this->bearer($token))
            ->postJson('/api/bookings', ['truckId' => $truck['id'], 'cargoId' => $load['id']])
            ->assertStatus(201)
            ->assertJsonPath('booking.price', 10000)
            ->assertJsonPath('booking.currency', 'TZS');
    }

    public function test_bookings_index_lists_incoming_and_outgoing_requests(): void
    {
        $cargoOwner = $this->seedUser();
        $truckOwner = $this->seedUser(['role' => 'truck_owner']);

        $truck = $this->seedTruck($truckOwner['id']);
        $load = $this->seedCargo($cargoOwner['id']);
        $booking = $this->seedBooking($cargoOwner['id'], $truckOwner['id'], $truck['id'], $load['id']);

        $incoming = $this->withHeaders($this->bearer($this->tokenFor($truckOwner['id'])))->getJson('/api/bookings');
        $incoming->assertOk()->assertJsonPath('bookings.0.id', $booking['id']);
        $incoming->assertJsonPath('bookings.0.direction', 'incoming');
        $incoming->assertJsonPath('bookings.0.cargo.id', $load['id']);

        $outgoing = $this->withHeaders($this->bearer($this->tokenFor($cargoOwner['id'])))->getJson('/api/bookings');
        $outgoing->assertOk()->assertJsonPath('bookings.0.direction', 'outgoing');
    }

    public function test_request_and_accept_require_valid_ids(): void
    {
        $owner = $this->seedUser();
        $token = $this->tokenFor($owner['id']);

        $this->withHeaders($this->bearer($token))
            ->postJson('/api/bookings', [])
            ->assertStatus(422)
            ->assertJsonPath('field', 'truckId');

        $this->withHeaders($this->bearer($token))
            ->postJson('/api/bookings', ['truckId' => 'nope', 'cargoId' => 'nope'])
            ->assertStatus(404)
            ->assertJsonPath('field', 'match');

        $this->withHeaders($this->bearer($token))
            ->postJson('/api/bookings/whatever/accept')
            ->assertStatus(404)
            ->assertJsonPath('field', 'booking');
    }

    public function test_a_stale_accept_is_reported_as_a_conflict(): void
    {
        $cargoOwner = $this->seedUser();
        $truckOwner = $this->seedUser(['role' => 'truck_owner']);
        $token = $this->tokenFor($truckOwner['id']);

        $truck = $this->seedTruck($truckOwner['id']);
        $load = $this->seedCargo($cargoOwner['id']);
        $booking = $this->seedBooking($cargoOwner['id'], $truckOwner['id'], $truck['id'], $load['id']);

        // Simulates another writer winning the race inside the DB function.
        $racing = new class extends FakeSupabaseClient
        {
            public function rpc(string $function, array $params = []): array
            {
                if ($function === 'accept_booking') {
                    return ['ok' => false, 'error' => 'conflict', 'field' => 'truck',
                        'message' => 'That truck has just been booked'];
                }

                return parent::rpc($function, $params);
            }
        };
        $racing->tables = $this->db->tables;
        $this->app->instance(SupabaseClient::class, $racing);

        $this->withHeaders($this->bearer($token))
            ->postJson('/api/bookings/'.$booking['id'].'/accept')
            ->assertStatus(409)
            ->assertJsonPath('field', 'truck');
    }

    public function test_accepting_the_same_booking_twice_returns_a_conflict(): void
    {
        $cargoOwner = $this->seedUser();
        $truckOwner = $this->seedUser(['role' => 'truck_owner']);
        $token = $this->tokenFor($truckOwner['id']);

        $truck = $this->seedTruck($truckOwner['id']);
        $load = $this->seedCargo($cargoOwner['id']);
        $booking = $this->seedBooking($cargoOwner['id'], $truckOwner['id'], $truck['id'], $load['id']);

        $this->withHeaders($this->bearer($token))
            ->postJson('/api/bookings/'.$booking['id'].'/accept')
            ->assertOk()
            ->assertJsonPath('booking.status', 'accepted');

        // The second attempt must not re-reserve anything; it is a conflict.
        $this->withHeaders($this->bearer($token))
            ->postJson('/api/bookings/'.$booking['id'].'/accept')
            ->assertStatus(409)
            ->assertJsonPath('field', 'booking');

        $this->assertSame('accepted', $this->db->selectOne('bookings', ['id' => 'eq.'.$booking['id']])['status']);
        $this->assertSame('booked', $this->db->selectOne('cargo', ['id' => 'eq.'.$load['id']])['status']);
        $this->assertSame('booked', $this->db->selectOne('trucks', ['id' => 'eq.'.$truck['id']])['status']);
    }

    public function test_a_second_accept_for_the_same_load_cannot_also_succeed(): void
    {
        $cargoOwner = $this->seedUser();
        $truckOwner = $this->seedUser(['role' => 'truck_owner']);
        $token = $this->tokenFor($truckOwner['id']);

        $load = $this->seedCargo($cargoOwner['id']);
        $truckA = $this->seedTruck($truckOwner['id'], ['registration_number' => 'T WIN1']);
        $truckB = $this->seedTruck($truckOwner['id'], ['registration_number' => 'T LOSE2']);
        $bookingA = $this->seedBooking($cargoOwner['id'], $truckOwner['id'], $truckA['id'], $load['id']);
        $bookingB = $this->seedBooking($cargoOwner['id'], $truckOwner['id'], $truckB['id'], $load['id']);

        $this->withHeaders($this->bearer($token))
            ->postJson('/api/bookings/'.$bookingA['id'].'/accept')
            ->assertOk();

        // The competing request for the same load must not also reserve it.
        $this->withHeaders($this->bearer($token))
            ->postJson('/api/bookings/'.$bookingB['id'].'/accept')
            ->assertStatus(409);

        $cargo = $this->db->selectOne('cargo', ['id' => 'eq.'.$load['id']]);
        $this->assertSame('booked', $cargo['status']);
        $this->assertSame($truckA['id'], $cargo['matched_truck_id']);
        // The losing truck stays on the market and its request is closed.
        $this->assertSame('available', $this->db->selectOne('trucks', ['id' => 'eq.'.$truckB['id']])['status']);
        $this->assertSame('rejected', $this->db->selectOne('bookings', ['id' => 'eq.'.$bookingB['id']])['status']);
    }

    public function test_accepting_an_already_closed_booking_is_a_conflict(): void
    {
        $cargoOwner = $this->seedUser();
        $truckOwner = $this->seedUser(['role' => 'truck_owner']);
        $token = $this->tokenFor($truckOwner['id']);

        $truck = $this->seedTruck($truckOwner['id']);
        $load = $this->seedCargo($cargoOwner['id']);
        $booking = $this->seedBooking($cargoOwner['id'], $truckOwner['id'], $truck['id'], $load['id'], [
            'status' => 'cancelled',
        ]);

        $this->withHeaders($this->bearer($token))
            ->postJson('/api/bookings/'.$booking['id'].'/accept')
            ->assertStatus(409)
            ->assertJsonPath('field', 'booking');

        $this->assertSame('available', $this->db->selectOne('trucks', ['id' => 'eq.'.$truck['id']])['status']);
        $this->assertSame('posted', $this->db->selectOne('cargo', ['id' => 'eq.'.$load['id']])['status']);
    }

    public function test_cancelling_an_already_closed_booking_is_a_conflict(): void
    {
        $cargoOwner = $this->seedUser();
        $truckOwner = $this->seedUser(['role' => 'truck_owner']);
        $token = $this->tokenFor($cargoOwner['id']);

        $truck = $this->seedTruck($truckOwner['id']);
        $load = $this->seedCargo($cargoOwner['id']);
        $booking = $this->seedBooking($cargoOwner['id'], $truckOwner['id'], $truck['id'], $load['id'], [
            'status' => 'rejected',
        ]);

        $this->withHeaders($this->bearer($token))
            ->postJson('/api/bookings/'.$booking['id'].'/cancel')
            ->assertStatus(409)
            ->assertJsonPath('field', 'booking');

        $this->assertSame('rejected', $this->db->selectOne('bookings', ['id' => 'eq.'.$booking['id']])['status']);
    }

    public function test_a_stranger_cannot_cancel_a_booking(): void
    {
        $cargoOwner = $this->seedUser();
        $truckOwner = $this->seedUser(['role' => 'truck_owner']);
        $stranger = $this->seedUser();
        $token = $this->tokenFor($stranger['id']);

        $truck = $this->seedTruck($truckOwner['id']);
        $load = $this->seedCargo($cargoOwner['id']);
        $booking = $this->seedBooking($cargoOwner['id'], $truckOwner['id'], $truck['id'], $load['id']);

        $this->withHeaders($this->bearer($token))
            ->postJson('/api/bookings/'.$booking['id'].'/cancel')
            ->assertStatus(403)
            ->assertJsonPath('field', 'booking');

        $this->assertSame('pending', $this->db->selectOne('bookings', ['id' => 'eq.'.$booking['id']])['status']);
    }

    public function test_cancel_does_not_free_a_truck_that_is_no_longer_assigned_to_the_booking(): void
    {
        $cargoOwner = $this->seedUser();
        $truckOwner = $this->seedUser(['role' => 'truck_owner']);
        $token = $this->tokenFor($cargoOwner['id']);

        $truck = $this->seedTruck($truckOwner['id']);
        $load = $this->seedCargo($cargoOwner['id']);
        $otherLoad = $this->seedCargo($cargoOwner['id'], ['reference' => 'CG-OTHER']);
        $booking = $this->seedBooking($cargoOwner['id'], $truckOwner['id'], $truck['id'], $load['id'], [
            'status' => 'accepted',
        ]);

        // The booking committed this truck to $load...
        $this->db->update('trucks', 'id', 'eq.'.$truck['id'], ['status' => 'booked', 'matched_cargo_id' => $load['id']]);
        $this->db->update('cargo', 'id', 'eq.'.$load['id'], ['status' => 'booked', 'matched_truck_id' => $truck['id']]);
        // ...but the truck has since been re-pointed at a different load.
        $this->db->update('trucks', 'id', 'eq.'.$truck['id'], ['matched_cargo_id' => $otherLoad['id']]);

        $this->withHeaders($this->bearer($token))
            ->postJson('/api/bookings/'.$booking['id'].'/cancel')
            ->assertOk();

        // The cancelled booking must not steal a truck now assigned elsewhere.
        $truckAfter = $this->db->selectOne('trucks', ['id' => 'eq.'.$truck['id']]);
        $this->assertSame('booked', $truckAfter['status']);
        $this->assertSame($otherLoad['id'], $truckAfter['matched_cargo_id']);
    }
}
