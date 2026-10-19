<?php

namespace App\Services;

use App\Exceptions\DataStoreUnavailable;
use Illuminate\Support\Carbon;

/**
 * The 8% platform commission ledger (supabase_commissions.sql).
 *
 * A commission row is recorded on the server the moment a booking request is
 * ACCEPTED — the qualifying event for an agreed transportation price — using
 * the price preserved on the booking (`bookings.price`) and, failing that,
 * the load's posted price (`cargo.budget`). The amounts themselves always
 * come from CommissionCalculator; nothing a client sends is ever read.
 *
 * Lifecycle (one row per booking, enforced by a partial unique index):
 *
 *   pending   → created with the accepted booking
 *   earned    → the load reached delivered/completed (the work was performed)
 *   paid      → settled to the platform WITH a payment reference as evidence
 *   cancelled → the booking/load was called off before it was settled
 *   refunded  → a settled commission was reversed
 *
 * Cancelled/refunded rows stay for the audit trail but never enter a revenue
 * total, every transition is a compare-and-set on `status` so two requests
 * cannot both win, and a settled row is never melted away implicitly — money
 * that was actually collected only leaves the books through an explicit,
 * admin-only refund.
 */
class CommissionService
{
    /** Statuses that represent live, countable platform revenue. */
    public const REVENUE_STATUSES = ['pending', 'earned', 'paid'];

    /** Statuses an unsettled commission may still move to. */
    public const ACTIVE_STATUSES = ['pending', 'earned'];

    /** Every status the ledger supports. */
    public const ALL_STATUSES = ['pending', 'earned', 'paid', 'cancelled', 'refunded'];

    public function __construct(private SupabaseClient $supabase) {}

    /**
     * Record the 8% commission for a just-accepted booking.
     *
     * Idempotent: the unique index on `booking_id` means a repeated call (a
     * retry, a replayed request, a race) returns the row that already exists
     * instead of minting a second one.
     *
     * @param  array<string, mixed>  $booking
     * @param  array<string, mixed>  $cargo
     * @return array<string, mixed>|null the stored row, or null when no
     *                                   positive agreed price exists yet
     */
    public function recordForBooking(array $booking, array $cargo): ?array
    {
        $bookingId = trim((string) ($booking['id'] ?? ''));
        $cargoId = trim((string) ($cargo['id'] ?? ''));

        if ($bookingId === '' || $cargoId === '') {
            return null;
        }

        $price = $this->agreedPrice($booking, $cargo);

        if (! CommissionCalculator::isValidPrice($price)) {
            // Nothing valid to commission (price missing, zero or negative):
            // never invent an agreed amount after the fact.
            return null;
        }

        $amounts = CommissionCalculator::calculate($price);
        $currency = strtoupper(trim((string) ($cargo['currency'] ?? '')));

        $row = [
            'cargo_id' => $cargoId,
            'booking_id' => $bookingId,
            'cargo_price' => $amounts['cargo_price'],
            'commission_rate' => $amounts['commission_rate'],
            'commission_amount' => $amounts['commission_amount'],
            'provider_net_amount' => $amounts['provider_net_amount'],
            'currency' => $currency === '' ? 'TZS' : $currency,
            'status' => 'pending',
        ];

        $attempt = 0;

        while (true) {
            $attempt++;

            try {
                return $this->supabase->insert('commissions', $row);
            } catch (\RuntimeException $e) {
                if ($this->isDuplicate($e)) {
                    // Already recorded — return the existing ledger row.
                    return $this->forBooking($bookingId);
                }

                // An unreachable data store (503) is retried exactly ONCE: an
                // accepted booking must not lose its commission to a dropped
                // connection, and the unique index on booking_id makes the
                // retry safe even when the first write did land (it becomes a
                // duplicate, resolved above). Schema errors and 4xx are
                // rethrown immediately — they never heal on a retry.
                if ($attempt === 1 && $e instanceof DataStoreUnavailable && $e->status() === 503) {
                    continue;
                }

                throw $e;
            }
        }
    }

    /** The commission raised for one booking, when any. */
    public function forBooking(string $bookingId): ?array
    {
        if ($bookingId === '') {
            return null;
        }

        return $this->supabase->selectOne('commissions', ['booking_id' => "eq.{$bookingId}"]);
    }

    /** One commission record (admin endpoints). */
    public function find(string $commissionId): ?array
    {
        if ($commissionId === '') {
            return null;
        }

        return $this->supabase->selectOne('commissions', ['id' => "eq.{$commissionId}"]);
    }

    /**
     * The load was delivered/completed → the business rule for earning the
     * commission has been satisfied.
     */
    public function markEarnedForCargo(string $cargoId): void
    {
        if ($cargoId === '') {
            return;
        }

        $this->supabase->updateMatching('commissions', [
            'cargo_id' => "eq.{$cargoId}",
            'status' => 'eq.pending',
        ], [
            'status' => 'earned',
            'earned_at' => $this->now(),
        ]);
    }

    /** The booking was cancelled → an UNSETTLED commission stops counting. */
    public function cancelForBooking(string $bookingId): void
    {
        if ($bookingId === '') {
            return;
        }

        $this->supabase->updateMatching('commissions', [
            'booking_id' => "eq.{$bookingId}",
            'status' => 'in.('.implode(',', self::ACTIVE_STATUSES).')',
        ], [
            'status' => 'cancelled',
            'cancelled_at' => $this->now(),
        ]);
    }

    /** The load was cancelled → an UNSETTLED commission stops counting. */
    public function cancelForCargo(string $cargoId): void
    {
        if ($cargoId === '') {
            return;
        }

        $this->supabase->updateMatching('commissions', [
            'cargo_id' => "eq.{$cargoId}",
            'status' => 'in.('.implode(',', self::ACTIVE_STATUSES).')',
        ], [
            'status' => 'cancelled',
            'cancelled_at' => $this->now(),
        ]);
    }

    /**
     * Admin settlement: nothing counts as paid without verified payment
     * evidence, so this endpoint is admin-only and demands a reference.
     *
     * @return array{ok: true, commission: array<string, mixed>}|array{ok: false, status: int, field: string, message: string}
     */
    public function settle(string $commissionId, string $paymentReference): array
    {
        return $this->adminTransition(
            $commissionId,
            'in.('.implode(',', self::ACTIVE_STATUSES).')',
            ['status' => 'paid', 'paid_at' => $this->now(), 'payment_reference' => $paymentReference],
            'Only a pending or earned commission can be settled.',
        );
    }

    /**
     * Admin reversal of a settled commission: the amount leaves the paid
     * total, while the settlement evidence stays for the audit trail.
     *
     * @return array{ok: true, commission: array<string, mixed>}|array{ok: false, status: int, field: string, message: string}
     */
    public function refund(string $commissionId, string $reason): array
    {
        return $this->adminTransition(
            $commissionId,
            'eq.paid',
            ['status' => 'refunded', 'refunded_at' => $this->now(), 'refund_reason' => $reason],
            'Only a settled commission can be refunded.',
        );
    }

    /**
     * Admin revenue summary, computed from ledger rows only. The status
     * buckets are mutually exclusive, so no record can contribute to two of
     * them and no amount can be double-counted.
     *
     * @return array{totals: array<string, float|int>, counts: array<string, int>, records: array<int, array<string, mixed>>}
     */
    public function summary(): array
    {
        $rows = $this->supabase->selectMany([
            'commissions' => [
                'table' => 'commissions',
                'query' => ['order' => 'created_at.desc', 'limit' => 500],
            ],
            // Completed shipments: a real count of loads that reached a
            // terminal success state, not a figure derived from commissions.
            'completed' => [
                'table' => 'cargo',
                'query' => [
                    'select' => 'id',
                    'status' => 'in.(delivered,completed)',
                    'limit' => 10000,
                ],
            ],
        ]);

        $sums = [
            'cargoValue' => 0.0,
            'pending' => 0.0,
            'earned' => 0.0,
            'paid' => 0.0,
            'cancelled' => 0.0,
            'refunded' => 0.0,
        ];
        $counts = array_fill_keys(self::ALL_STATUSES, 0);

        foreach ($rows['commissions'] ?? [] as $row) {
            $status = (string) ($row['status'] ?? '');

            if (! array_key_exists($status, $sums)) {
                continue;
            }

            $counts[$status]++;
            $sums[$status] += (float) ($row['commission_amount'] ?? 0);

            // Cancelled/refunded work never counts as cargo value — only a
            // load with a live commission ever did transport for the platform.
            if (in_array($status, self::REVENUE_STATUSES, true)) {
                $sums['cargoValue'] += (float) ($row['cargo_price'] ?? 0);
            }
        }

        $totals = [
            'cargoValue' => round($sums['cargoValue'], 2),
            'pendingCommission' => round($sums['pending'], 2),
            'earnedCommission' => round($sums['earned'], 2),
            'paidCommission' => round($sums['paid'], 2),
            'cancelledCommission' => round($sums['cancelled'], 2),
            'refundedCommission' => round($sums['refunded'], 2),
            // Everything still owed to / held by the platform (excludes
            // cancelled and refunded amounts by construction).
            'liveCommission' => round($sums['pending'] + $sums['earned'] + $sums['paid'], 2),
            'completedShipments' => count($rows['completed'] ?? []),
        ];

        $records = $this->withRelations($rows['commissions'] ?? []);
        $counts['total'] = count($records);

        return [
            'totals' => $totals,
            'counts' => $counts,
            'records' => $records,
        ];
    }

    /**
     * Attach the load and the booking behind every commission record so an
     * admin can always trace an amount back to its source.
     *
     * @param  array<int, array<string, mixed>>  $rows
     * @return array<int, array<string, mixed>>
     */
    private function withRelations(array $rows): array
    {
        if ($rows === []) {
            return $rows;
        }

        $cargoIds = $this->linkedIds($rows, 'cargo_id');
        $bookingIds = $this->linkedIds($rows, 'booking_id');

        $reads = [];

        if ($cargoIds !== []) {
            $reads['cargo'] = [
                'table' => 'cargo',
                'query' => [
                    'select' => 'id,reference,cargo_type,status,pickup_location,destination_location,owner_id',
                    'id' => 'in.('.implode(',', $cargoIds).')',
                ],
            ];
        }

        if ($bookingIds !== []) {
            $reads['bookings'] = [
                'table' => 'bookings',
                'query' => [
                    'select' => 'id,status,price,currency,requested_at,decided_at',
                    'id' => 'in.('.implode(',', $bookingIds).')',
                ],
            ];
        }

        $related = $this->supabase->selectMany($reads);
        $cargoById = $this->keyById($related['cargo'] ?? []);
        $bookingById = $this->keyById($related['bookings'] ?? []);

        foreach ($rows as &$row) {
            $row['cargo'] = $cargoById[(string) ($row['cargo_id'] ?? '')] ?? null;
            $row['booking'] = $bookingById[(string) ($row['booking_id'] ?? '')] ?? null;
        }
        unset($row);

        return $rows;
    }

    /**
     * Compare-and-set status change guarded by the current status. An empty
     * result means the row was not in the expected state — a stale or
     * concurrent writer already won, so history is never overwritten twice.
     *
     * @param  array<string, mixed>  $values
     * @return array{ok: true, commission: array<string, mixed>}|array{ok: false, status: int, field: string, message: string}
     */
    private function adminTransition(string $commissionId, string $expectedStatuses, array $values, string $conflict): array
    {
        if ($this->find($commissionId) === null) {
            return [
                'ok' => false,
                'status' => 404,
                'field' => 'commission',
                'message' => 'This commission record no longer exists',
            ];
        }

        $updated = $this->supabase->updateMatching('commissions', [
            'id' => "eq.{$commissionId}",
            'status' => $expectedStatuses,
        ], $values);

        if ($updated === []) {
            return ['ok' => false, 'status' => 409, 'field' => 'status', 'message' => $conflict];
        }

        return ['ok' => true, 'commission' => $updated[0]];
    }

    /**
     * The agreed transportation price: the booking's preserved quote first,
     * then the load's posted price. Null when neither exists.
     *
     * @param  array<string, mixed>  $booking
     * @param  array<string, mixed>  $cargo
     */
    private function agreedPrice(array $booking, array $cargo): int|float|string|null
    {
        $price = $booking['price'] ?? null;

        if ($price === null || $price === '') {
            $price = $cargo['budget'] ?? null;
        }

        if (! is_int($price) && ! is_float($price) && ! is_string($price)) {
            return null;
        }

        return $price;
    }

    private function isDuplicate(\RuntimeException $e): bool
    {
        return str_contains($e->getMessage(), '23505') || str_contains($e->getMessage(), 'duplicate key');
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

    private function now(): string
    {
        return Carbon::now()->toIso8601String();
    }
}
