<?php

namespace App\Services;

use Illuminate\Support\Carbon;

/**
 * Booking requests (SRS §22).
 *
 * Booking is no longer an instant "accept a match" write: a party sends an
 * explicit request for a truck↔cargo pairing, and the counterparty accepts,
 * rejects or either side cancels it. The multi-row state changes (reserving
 * both sides, auto-rejecting the competing requests, or releasing them again)
 * run inside the transactional Postgres functions `accept_booking` and
 * `cancel_booking`, so a truck/load can never be double-booked even under a
 * race. Partial unique indexes on `bookings` back that up at the schema level.
 *
 * Cross-owner rules: only a party to the pairing (their load OR their truck)
 * may request it; only the counterparty may accept/reject; either party may
 * cancel.
 */
class BookingService
{
    /** Statuses that keep a cargo/truck committed. */
    private const ACTIVE = ['pending', 'accepted'];

    public function __construct(
        private SupabaseClient $supabase,
        private MatchingEngine $engine,
    ) {}

    /**
     * Send a booking request for a truck↔cargo pairing.
     *
     * @return array{ok: true, booking: array<string, mixed>, cargo: array<string, mixed>, truck: array<string, mixed>}
     *                                                                                                                  |array{ok: false, status: int, field: string, message: string}
     */
    public function request(
        string $userId,
        string $truckId,
        string $cargoId,
        ?float $price = null,
        ?string $message = null
    ): array {
        $truck = $this->supabase->selectOne('trucks', ['id' => "eq.{$truckId}"]);
        $cargo = $this->supabase->selectOne('cargo', ['id' => "eq.{$cargoId}"]);

        if ($truck === null || $cargo === null) {
            return $this->failure(404, 'match', 'This match is no longer available');
        }

        $truckOwner = (string) ($truck['owner_id'] ?? '');
        $cargoOwner = (string) ($cargo['owner_id'] ?? '');

        if ($truckOwner !== $userId && $cargoOwner !== $userId) {
            return $this->failure(403, 'match', 'You can only book your own trucks or loads');
        }

        if (($truck['status'] ?? '') !== 'available') {
            return $this->failure(409, 'truck', 'That truck is no longer available');
        }

        if (($cargo['status'] ?? '') !== 'posted') {
            return $this->failure(409, 'cargo', 'That load has already been booked');
        }

        // Re-check the hard eligibility rules so a stale match can't be booked.
        if (! $this->engine->isEligible($truck, $cargo)) {
            return $this->failure(422, 'match', 'These no longer match — check the route, weight and dates');
        }

        // The responder is the counterparty the requester does not represent.
        $responderId = match (true) {
            $cargoOwner === $userId => $truckOwner,
            $truckOwner === $userId => $cargoOwner,
            default => $userId,
        };

        $currency = (string) ($cargo['currency'] ?? '') !== '' ? (string) $cargo['currency'] : 'TZS';
        $quoted = $price ?? $this->estimatePrice($truck, $cargo);
        $now = Carbon::now()->toIso8601String();

        try {
            $booking = $this->supabase->insert('bookings', [
                'cargo_id' => $cargoId,
                'truck_id' => $truckId,
                'requester_id' => $userId,
                'responder_id' => $responderId,
                'status' => 'pending',
                'price' => $quoted,
                'currency' => $currency,
                'message' => $message,
                'requested_at' => $now,
            ]);
        } catch (\RuntimeException $e) {
            if (str_contains($e->getMessage(), '23505') || str_contains($e->getMessage(), 'duplicate key')) {
                return $this->failure(409, 'match', 'You have already requested this booking');
            }

            throw $e;
        }

        return [
            'ok' => true,
            'booking' => $booking,
            'cargo' => $cargo,
            'truck' => $truck,
        ];
    }

    /**
     * Accept a pending request (counterparty only). Runs the atomic DB
     * function so both sides reserve together.
     *
     * @return array{ok: true, booking: array<string, mixed>, cargo: array<string, mixed>, truck: array<string, mixed>}
     *                                                                                                                  |array{ok: false, status: int, field: string, message: string}
     */
    public function accept(string $userId, string $bookingId): array
    {
        return $this->resolveRpc($this->supabase->rpc('accept_booking', [
            'p_booking' => $bookingId,
            'p_user' => $userId,
        ]));
    }

    /**
     * Reject a pending request (counterparty only).
     *
     * @return array{ok: true, booking: array<string, mixed>}|array{ok: false, status: int, field: string, message: string}
     */
    public function reject(string $userId, string $bookingId): array
    {
        $booking = $this->supabase->selectOne('bookings', ['id' => "eq.{$bookingId}"]);

        if ($booking === null) {
            return $this->failure(404, 'booking', 'This booking request no longer exists');
        }

        if ((string) ($booking['responder_id'] ?? '') !== $userId) {
            return $this->failure(403, 'booking', 'Only the other party can respond to this request');
        }

        if (($booking['status'] ?? '') !== 'pending') {
            return $this->failure(409, 'booking', 'This request has already been answered');
        }

        $updated = $this->supabase->updateMatching('bookings', [
            'id' => "eq.{$bookingId}",
            'status' => 'eq.pending',
        ], [
            'status' => 'rejected',
            'decided_by' => $userId,
            'decided_at' => Carbon::now()->toIso8601String(),
        ]);

        if ($updated === []) {
            return $this->failure(409, 'booking', 'This request has already been answered');
        }

        return ['ok' => true, 'booking' => $updated[0]];
    }

    /**
     * Cancel a pending or accepted booking (either party). Runs the atomic DB
     * function so an accepted booking also hands both sides back to the market.
     *
     * @return array{ok: true, booking: array<string, mixed>, cargo: array<string, mixed>, truck: array<string, mixed>}
     *                                                                                                                  |array{ok: false, status: int, field: string, message: string}
     */
    public function cancel(string $userId, string $bookingId): array
    {
        return $this->resolveRpc($this->supabase->rpc('cancel_booking', [
            'p_booking' => $bookingId,
            'p_user' => $userId,
        ]));
    }

    /**
     * Every booking the caller is involved in, newest first, enriched with the
     * counterpart load/truck and the two parties.
     *
     * @return array<int, array<string, mixed>>
     */
    public function forUser(string $userId): array
    {
        $rows = array_merge(
            $this->supabase->select('bookings', [
                'requester_id' => "eq.{$userId}",
                'order' => 'created_at.desc',
                'limit' => 200,
            ]),
            $this->supabase->select('bookings', [
                'responder_id' => "eq.{$userId}",
                'order' => 'created_at.desc',
                'limit' => 200,
            ]),
        );

        // Self-bookings appear on both sides — keep one row per booking.
        $byId = [];
        foreach ($rows as $row) {
            $byId[(string) $row['id']] = $row;
        }
        $rows = array_values($byId);

        usort($rows, static function (array $a, array $b): int {
            return strcmp((string) ($b['created_at'] ?? ''), (string) ($a['created_at'] ?? ''));
        });

        return $this->withRelations($rows, $userId);
    }

    /**
     * Same enrichment for the admin console, which sees bookings it is not a
     * party to: no viewer, so `direction` stays the neutral presenter default.
     *
     * @param  array<int, array<string, mixed>>  $rows
     * @return array<int, array<string, mixed>>
     */
    public function withRelationsForAdmin(array $rows): array
    {
        return $this->withRelations($rows, '');
    }

    /**
     * Attach the counterpart load/truck and the two parties to each booking.
     *
     * @param  array<int, array<string, mixed>>  $rows
     * @return array<int, array<string, mixed>>
     */
    private function withRelations(array $rows, string $viewerId): array
    {
        if ($rows === []) {
            return $rows;
        }

        $cargoById = $this->keyById($this->supabase->select('cargo', [
            'select' => 'id,reference,cargo_type,weight_tons,pickup_location,destination_location,pickup_date,status,owner_id,budget,currency',
            'id' => 'in.('.implode(',', $this->linkedIds($rows, 'cargo_id')).')',
        ]));

        $truckById = $this->keyById($this->supabase->select('trucks', [
            'select' => 'id,registration_number,truck_type,capacity_tons,current_location,availability_date,status,owner_id,driver_name,driver_phone,rate_per_ton',
            'id' => 'in.('.implode(',', $this->linkedIds($rows, 'truck_id')).')',
        ]));

        $userIds = array_values(array_unique(array_filter(array_merge(
            $this->linkedIds($rows, 'requester_id'),
            $this->linkedIds($rows, 'responder_id'),
        ))));

        $userById = $this->keyById($this->supabase->select('users', [
            'select' => 'id,name,company_name',
            'id' => 'in.('.implode(',', $userIds).')',
        ]));

        foreach ($rows as &$row) {
            $row['cargo'] = $cargoById[$row['cargo_id'] ?? ''] ?? null;
            $row['truck'] = $truckById[$row['truck_id'] ?? ''] ?? null;
            $row['requester'] = $userById[$row['requester_id'] ?? ''] ?? null;
            $row['responder'] = $userById[$row['responder_id'] ?? ''] ?? null;
            $row['direction'] = ((string) ($row['requester_id'] ?? '')) === $viewerId
                ? 'outgoing'
                : 'incoming';
        }
        unset($row);

        return $rows;
    }

    /**
     * Estimate a quote: rate × weight when the truck has a rate, otherwise the
     * load's budget. Null when neither is set.
     *
     * @param  array<string, mixed>  $truck
     * @param  array<string, mixed>  $cargo
     */
    public function estimatePrice(array $truck, array $cargo): ?float
    {
        $rate = $truck['rate_per_ton'] ?? null;
        if ($rate !== null && $rate !== '' && (float) $rate > 0) {
            return round((float) $rate * (float) ($cargo['weight_tons'] ?? 0), 2);
        }

        $budget = $cargo['budget'] ?? null;
        if ($budget !== null && $budget !== '') {
            return (float) $budget;
        }

        return null;
    }

    /**
     * Map the JSON envelope returned by accept_booking / cancel_booking to the
     * service result shape, translating the DB error into an HTTP status.
     *
     * @param  array<string, mixed>  $result
     * @return array<string, mixed>
     */
    private function resolveRpc(array $result): array
    {
        if (($result['ok'] ?? false) === true) {
            return $result;
        }

        $status = match ($result['error'] ?? 'conflict') {
            'not_found' => 404,
            'forbidden' => 403,
            default => 409,
        };

        return $this->failure(
            $status,
            (string) ($result['field'] ?? 'booking'),
            (string) ($result['message'] ?? 'This booking is no longer available'),
        );
    }

    /**
     * Free the truck linked to a cargo row (call after cancel/complete), and
     * cancel any still-open booking requests for it.
     *
     * @param  array<string, mixed>  $cargo
     */
    public function releaseForCargo(array $cargo): void
    {
        $truckId = $cargo['matched_truck_id'] ?? null;
        $cargoId = $cargo['id'] ?? null;

        if (! $truckId || ! $cargoId) {
            return;
        }

        $this->cancelActiveBookings('cargo_id', $cargoId);

        $this->supabase->update('cargo', 'id', "eq.{$cargoId}", [
            'matched_truck_id' => null,
            'matched_at' => null,
        ]);

        $truck = $this->supabase->selectOne('trucks', ['id' => "eq.{$truckId}"]);
        if ($truck !== null && ($truck['matched_cargo_id'] ?? null) === $cargoId) {
            $this->supabase->update('trucks', 'id', "eq.{$truckId}", [
                'status' => 'available',
                'matched_cargo_id' => null,
                'matched_at' => null,
            ]);
        }
    }

    /**
     * Free the cargo linked to a truck row (call when the truck is unbooked),
     * and cancel any still-open booking requests for it.
     *
     * @param  array<string, mixed>  $truck
     */
    public function releaseForTruck(array $truck): void
    {
        $cargoId = $truck['matched_cargo_id'] ?? null;
        $truckId = $truck['id'] ?? null;

        if (! $cargoId || ! $truckId) {
            return;
        }

        $this->cancelActiveBookings('truck_id', $truckId);

        $this->supabase->update('trucks', 'id', "eq.{$truckId}", [
            'matched_cargo_id' => null,
            'matched_at' => null,
        ]);

        $cargo = $this->supabase->selectOne('cargo', ['id' => "eq.{$cargoId}"]);
        if ($cargo !== null && ($cargo['matched_truck_id'] ?? null) === $truckId && ($cargo['status'] ?? '') === 'booked') {
            $this->supabase->update('cargo', 'id', "eq.{$cargoId}", [
                'status' => 'posted',
                'matched_truck_id' => null,
                'matched_at' => null,
            ]);
        }
    }

    /** Cancel every pending/accepted booking on one side of a pairing. */
    private function cancelActiveBookings(string $column, string $id): void
    {
        try {
            $this->supabase->updateMatching('bookings', [
                $column => "eq.{$id}",
                'status' => 'in.('.implode(',', self::ACTIVE).')',
            ], [
                'status' => 'cancelled',
                'decided_at' => Carbon::now()->toIso8601String(),
            ]);
        } catch (\Throwable) {
            // Best effort — never mask the caller's primary operation.
        }
    }

    /**
     * Attach the counterpart truck to each cargo row (`matched_truck`).
     *
     * @param  array<int, array<string, mixed>>  $rows
     * @return array<int, array<string, mixed>>
     */
    public function withMatchedTrucks(array $rows): array
    {
        $ids = $this->linkedIds($rows, 'matched_truck_id');
        if ($ids === []) {
            return $rows;
        }

        $byId = $this->keyById($this->supabase->select('trucks', [
            'select' => 'id,registration_number,truck_type,current_location',
            'id' => 'in.('.implode(',', $ids).')',
        ]));

        foreach ($rows as &$row) {
            $row['matched_truck'] = $byId[$row['matched_truck_id'] ?? ''] ?? null;
        }
        unset($row);

        return $rows;
    }

    /**
     * Attach the counterpart load to each truck row (`matched_cargo`).
     *
     * @param  array<int, array<string, mixed>>  $rows
     * @return array<int, array<string, mixed>>
     */
    public function withMatchedCargo(array $rows): array
    {
        $ids = $this->linkedIds($rows, 'matched_cargo_id');
        if ($ids === []) {
            return $rows;
        }

        $byId = $this->keyById($this->supabase->select('cargo', [
            'select' => 'id,reference,cargo_type,pickup_location,destination_location',
            'id' => 'in.('.implode(',', $ids).')',
        ]));

        foreach ($rows as &$row) {
            $row['matched_cargo'] = $byId[$row['matched_cargo_id'] ?? ''] ?? null;
        }
        unset($row);

        return $rows;
    }

    /**
     * @param  array<int, array<string, mixed>>  $rows
     * @return array<int, string>
     */
    private function linkedIds(array $rows, string $column): array
    {
        $ids = [];
        foreach ($rows as $row) {
            $id = $row[$column] ?? null;
            if (is_string($id) && $id !== '') {
                $ids[$id] = $id;
            }
        }

        return array_values($ids);
    }

    /**
     * @param  array<int, array<string, mixed>>  $rows
     * @return array<string, array<string, mixed>>
     */
    private function keyById(array $rows): array
    {
        $byId = [];
        foreach ($rows as $row) {
            if (isset($row['id'])) {
                $byId[(string) $row['id']] = $row;
            }
        }

        return $byId;
    }

    /** @return array{ok: false, status: int, field: string, message: string} */
    private function failure(int $status, string $field, string $message): array
    {
        return ['ok' => false, 'status' => $status, 'field' => $field, 'message' => $message];
    }
}
