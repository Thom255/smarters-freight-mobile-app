<?php

namespace App\Services;

/**
 * Smarters Freight matching engine (SRS §18–§21).
 *
 * Pure, side-effect-free scoring so it can run inside any controller and be
 * unit-tested without Supabase. Given a cargo load and a candidate truck it
 * returns the weighted score breakdown and a human category.
 *
 * Weighted criteria (SRS §19):
 *   route (return-trip opportunity) ....... 30
 *   capacity fit .......................... 25
 *   date fit .............................. 20
 *   location / valid route ................ 15
 *   availability .......................... 10
 *   ------------------------------------------
 *   total ................................ 100
 *
 * Hard eligibility rules (a candidate that fails these is dropped entirely):
 *   * truck.status must be 'available'
 *   * truck.capacity_tons >= cargo.weight_tons
 *   * truck.availability_date <= cargo.pickup_date
 */
class MatchingEngine
{
    /** Largest load, as a fraction of capacity, that still scores full marks. */
    private const MIN_UTILIZATION = 0.5;

    /**
     * @param  array<string, mixed>  $cargo
     * @param  array<int, array<string, mixed>>  $trucks
     * @return array<int, array<string, mixed>>  matches, best first
     */
    public function matchCargo(array $cargo, array $trucks): array
    {
        $matches = [];

        foreach ($trucks as $truck) {
            if (! $this->isEligible($truck, $cargo)) {
                continue;
            }

            $scores = $this->score($truck, $cargo);

            $matches[] = [
                'truck' => $truck,
                'cargo' => $cargo,
                'scores' => $scores,
                'total' => array_sum($scores),
                'category' => $this->category(array_sum($scores)),
            ];
        }

        return $this->rank($matches);
    }

    /**
     * @param  array<string, mixed>  $truck
     * @param  array<int, array<string, mixed>>  $cargoList
     * @return array<int, array<string, mixed>>
     */
    public function matchTruck(array $truck, array $cargoList): array
    {
        $matches = [];

        foreach ($cargoList as $cargo) {
            if (! $this->isEligible($truck, $cargo)) {
                continue;
            }

            $scores = $this->score($truck, $cargo);

            $matches[] = [
                'truck' => $truck,
                'cargo' => $cargo,
                'scores' => $scores,
                'total' => array_sum($scores),
                'category' => $this->category(array_sum($scores)),
            ];
        }

        return $this->rank($matches);
    }

    /**
     * Weighted score breakdown for a truck/cargo pair.
     *
     * @return array{route: int, capacity: int, date: int, location: int, availability: int}
     */
    public function score(array $truck, array $cargo): array
    {
        return [
            'route' => $this->routeScore($truck, $cargo),
            'capacity' => $this->capacityScore($truck, $cargo),
            'date' => $this->dateScore($truck, $cargo),
            'location' => $this->locationScore($truck, $cargo),
            'availability' => $this->availabilityScore($truck),
        ];
    }

    /** @param array<string, mixed> $truck @param array<string, mixed> $cargo */
    public function isEligible(array $truck, array $cargo): bool
    {
        if (($truck['status'] ?? '') !== 'available') {
            return false;
        }

        if ((float) ($truck['capacity_tons'] ?? 0) < (float) ($cargo['weight_tons'] ?? 0)) {
            return false;
        }

        $available = $this->toTimestamp($truck['availability_date'] ?? null);
        $pickup = $this->toTimestamp($cargo['pickup_date'] ?? null);

        // Truck must already be free on (or before) the pickup day.
        return $available !== null && $pickup !== null && $available <= $pickup;
    }

    /** 30 — truck already sits where the cargo is: the empty-run killer. */
    private function routeScore(array $truck, array $cargo): int
    {
        return $this->samePlace($truck['current_location'] ?? null, $cargo['pickup_location'] ?? null)
            ? 30
            : 0;
    }

    /** 25 — right-sized trucks score higher than a barely-loadable one. */
    private function capacityScore(array $truck, array $cargo): int
    {
        $capacity = (float) ($truck['capacity_tons'] ?? 0);
        if ($capacity <= 0) {
            return 0;
        }

        $ratio = (float) ($cargo['weight_tons'] ?? 0) / $capacity;
        if ($ratio >= self::MIN_UTILIZATION) {
            return 25;
        }

        // 0..49% utilized scales 15..24 so oversized trucks are still usable.
        return (int) round(15 + 10 * ($ratio / self::MIN_UTILIZATION));
    }

    /** 20 — trucks free nearer the pickup day match better. */
    private function dateScore(array $truck, array $cargo): int
    {
        $available = $this->toTimestamp($truck['availability_date'] ?? null);
        $pickup = $this->toTimestamp($cargo['pickup_date'] ?? null);

        if ($available === null || $pickup === null) {
            return 0;
        }

        $days = (int) floor(($pickup - $available) / 86400);

        return match (true) {
            $days <= 0 => 20,
            $days <= 2 => 18,
            $days <= 7 => 15,
            default => 10,
        };
    }

    /** 15 — a valid point-to-point route (destination set, different pickup). */
    private function locationScore(array $truck, array $cargo): int
    {
        $pickup = $this->normalize($cargo['pickup_location'] ?? null);
        $destination = $this->normalize($cargo['destination_location'] ?? null);

        return $pickup !== null && $destination !== null && $pickup !== $destination
            ? 15
            : 0;
    }

    /** 10 — only AVAILABLE trucks receive new shipments (SRS §18). */
    private function availabilityScore(array $truck): int
    {
        return ($truck['status'] ?? '') === 'available' ? 10 : 0;
    }

    /** @param array<int, array<string, mixed>> $matches */
    private function rank(array $matches): array
    {
        usort($matches, static function (array $a, array $b): int {
            return $b['total'] <=> $a['total'];
        });

        return $matches;
    }

    private function category(float $total): string
    {
        return match (true) {
            $total >= 90 => 'excellent',
            $total >= 75 => 'good',
            $total >= 60 => 'possible',
            default => 'poor',
        };
    }

    private function samePlace(?string $a, ?string $b): bool
    {
        $a = $this->normalize($a);
        $b = $this->normalize($b);

        return $a !== null && $a === $b;
    }

    private function normalize(?string $value): ?string
    {
        $value = trim((string) $value);

        return $value === '' ? null : mb_strtolower($value);
    }

    /** Accepts 'YYYY-MM-DD' dates or ISO timestamps; returns a day-aligned epoch. */
    private function toTimestamp(mixed $value): ?int
    {
        if (! is_string($value) || trim($value) === '') {
            return null;
        }

        $timestamp = strtotime(substr(trim($value), 0, 10));

        return $timestamp === false ? null : $timestamp;
    }
}
