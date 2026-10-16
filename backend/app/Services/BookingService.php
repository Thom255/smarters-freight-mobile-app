<?php

namespace App\Services;

use Illuminate\Support\Carbon;

/**
 * Match booking (SRS §22).
 *
 * Accepting a truck↔cargo match reserves both sides at once: the load is
 * marked `booked` and the truck is taken off the market (`booked`). Both rows
 * keep a reference to their counterpart so the pairing stays visible after it
 * drops out of the stateless matching results.
 *
 * Cross-owner rules: a caller may only accept a match when they own at least
 * one side of it (their load OR their truck). Booking is deliberately a single
 * step here — the counterparty sees the reserved status on their own records.
 */
class BookingService
{
    public function __construct(
        private SupabaseClient $supabase,
        private MatchingEngine $engine,
    ) {
    }

    /**
     * Reserve a truck for a load (or vice-versa).
     *
     * @return array{ok: true, truck: array<string, mixed>, cargo: array<string, mixed>}
     *        |array{ok: false, status: int, field: string, message: string}
     */
    public function accept(string $userId, string $truckId, string $cargoId): array
    {
        $truck = $this->supabase->selectOne('trucks', ['id' => "eq.{$truckId}"]);
        $cargo = $this->supabase->selectOne('cargo', ['id' => "eq.{$cargoId}"]);

        if ($truck === null || $cargo === null) {
            return $this->failure(404, 'match', 'This match is no longer available');
        }

        if (
            (string) ($truck['owner_id'] ?? '') !== $userId
            && (string) ($cargo['owner_id'] ?? '') !== $userId
        ) {
            return $this->failure(403, 'match', 'You can only book your own trucks or loads');
        }

        if (($truck['status'] ?? '') !== 'available') {
            return $this->failure(409, 'truck', 'That truck has just been booked');
        }

        if (($cargo['status'] ?? '') !== 'posted') {
            return $this->failure(409, 'cargo', 'That load has just been booked');
        }

        // Re-check the hard eligibility rules so a stale match can't be booked.
        if (! $this->engine->isEligible($truck, $cargo)) {
            return $this->failure(422, 'match', 'These no longer match — check the route, weight and dates');
        }

        $matchedAt = Carbon::now()->toIso8601String();

        $updatedTruck = $this->supabase->update('trucks', 'id', "eq.{$truckId}", [
            'status' => 'booked',
            'matched_cargo_id' => $cargoId,
            'matched_at' => $matchedAt,
        ]);

        $updatedCargo = $this->supabase->update('cargo', 'id', "eq.{$cargoId}", [
            'status' => 'booked',
            'matched_truck_id' => $truckId,
            'matched_at' => $matchedAt,
        ]);

        return [
            'ok' => true,
            'truck' => $updatedTruck[0] ?? array_merge($truck, [
                'status' => 'booked',
                'matched_cargo_id' => $cargoId,
                'matched_at' => $matchedAt,
            ]),
            'cargo' => $updatedCargo[0] ?? array_merge($cargo, [
                'status' => 'booked',
                'matched_truck_id' => $truckId,
                'matched_at' => $matchedAt,
            ]),
        ];
    }

    /**
     * Free the truck linked to a cargo row (call after cancel/complete).
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
     * Free the cargo linked to a truck row (call when the truck is unbooked).
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
