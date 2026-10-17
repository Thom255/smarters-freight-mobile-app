<?php

namespace Tests\Support;

use App\Services\SupabaseClient;

/**
 * In-memory stand-in for SupabaseClient so controllers and services can be
 * exercised over real HTTP (feature tests) without touching the network or
 * the shared Supabase project.
 *
 * Supports the slice of PostgREST the app actually uses: eq./in. filters,
 * order=col.dir, limit, insert, PATCH with representation (single- and
 * multi-filter), DELETE, and HEAD counts.
 */
class FakeSupabaseClient extends SupabaseClient
{
    /** @var array<string, array<int, array<string, mixed>>> */
    public array $tables = [];

    /** Every request the fake served — handy for asserting N+1-free calls. */
    public int $queries = 0;

    /**
     * Columns covered by a unique index in supabase_setup.sql. Enforced here
     * the same way Postgres enforces them: a violation throws, which is what
     * the controllers' `23505` branches handle.
     */
    private const UNIQUE_INDEXES = [
        'users' => ['identifier'],
        'api_tokens' => ['token_hash'],
        'shipments' => ['reference'],
        'trucks' => ['registration_number'],
        'cargo' => ['reference'],
    ];

    public function __construct() {}

    /** @param array<string, mixed> $query */
    public function select(string $table, array $query = []): array
    {
        $this->queries++;

        $rows = array_values(array_filter(
            $this->tables[$table] ?? [],
            fn (array $row) => $this->matches($row, $query),
        ));

        if (isset($query['order'])) {
            $rows = $this->order($rows, (string) $query['order']);
        }

        if (isset($query['limit'])) {
            $rows = array_slice($rows, 0, (int) $query['limit']);
        }

        if (isset($query['offset'])) {
            $rows = array_slice($rows, (int) $query['offset']);
        }

        $select = (string) ($query['select'] ?? '');

        return array_map(fn (array $row) => $this->withEmbed($row, $select), $rows);
    }

    /** Relation name → the local column PostgREST joins on. */
    private const EMBEDS = [
        'users' => 'user_id',
    ];

    /**
     * Minimal PostgREST resource embedding (`select=…,users(name)`) so tests
     * exercise the same single-round-trip reads the app runs in production.
     *
     * @param  array<string, mixed>  $row
     * @return array<string, mixed>
     */
    private function withEmbed(array $row, string $select): array
    {
        if (! preg_match_all('/([a-z_]+)\(([^)]*)\)/', $select, $matches, PREG_SET_ORDER)) {
            return $row;
        }

        foreach ($matches as [, $relation, $columns]) {
            $column = self::EMBEDS[$relation] ?? null;
            if ($column === null || ! array_key_exists($column, $row)) {
                continue;
            }

            $related = $this->selectOne($relation, ['id' => 'eq.'.((string) $row[$column])]);

            if ($related !== null && $columns !== '*' && trim($columns) !== '') {
                $keep = array_filter(array_map('trim', explode(',', $columns)));
                $related = array_intersect_key($related, array_flip($keep));
            }

            $row[$relation] = $related;
        }

        return $row;
    }

    /** @param array<string, mixed> $query */
    public function selectOne(string $table, array $query = []): ?array
    {
        $query['limit'] = 1;

        return $this->select($table, $query)[0] ?? null;
    }

    /**
     * Mirrors SupabaseClient::selectMany — sequential here, concurrent there.
     *
     * @param  array<string, array{table: string, query?: array<string, string>}>  $reads
     * @return array<string, array<int, array<string, mixed>>>
     */
    public function selectMany(array $reads): array
    {
        $decoded = [];
        foreach ($reads as $key => $read) {
            $decoded[$key] = $this->select($read['table'], $read['query'] ?? []);
        }

        return $decoded;
    }

    /** @param array<string, mixed> $values */
    public function insert(string $table, array $values): array
    {
        $this->queries++;

        foreach (self::UNIQUE_INDEXES[$table] ?? [] as $column) {
            if (! array_key_exists($column, $values)) {
                continue;
            }

            $needle = strtolower(trim((string) $values[$column]));
            foreach ($this->tables[$table] ?? [] as $existing) {
                if (strtolower(trim((string) ($existing[$column] ?? ''))) === $needle) {
                    throw new \RuntimeException(
                        "duplicate key value violates unique constraint \"{$table}_{$column}_key\" (23505)",
                        500,
                    );
                }
            }
        }

        // bookings carry PARTIAL unique indexes (one active booking per pair,
        // per cargo and per truck) that the flat map above cannot express.
        if ($table === 'bookings') {
            $this->assertBookingActiveUnique($values);
        }

        $row = $values;
        $row['id'] ??= $table.'-'.(count($this->tables[$table] ?? []) + 1);
        $row['created_at'] ??= now()->toIso8601String();
        $row['updated_at'] ??= $row['created_at'];

        $this->tables[$table][] = $row;

        return $row;
    }

    /** @param array<string, mixed> $values */
    public function update(string $table, string $column, string $equals, array $values): array
    {
        return $this->updateMatching($table, [$column => $equals], $values);
    }

    /** @param array<string, string> $filters @param array<string, mixed> $values */
    public function updateMatching(string $table, array $filters, array $values): array
    {
        $this->queries++;

        $updated = [];
        foreach ($this->tables[$table] ?? [] as $index => $row) {
            if (! $this->matches($row, $filters)) {
                continue;
            }

            $this->tables[$table][$index] = array_merge($row, $values, ['updated_at' => now()->toIso8601String()]);
            $updated[] = $this->tables[$table][$index];
        }

        return $updated;
    }

    /** @param array<string, mixed> $query */
    public function delete(string $table, string $column, string $equals, array $query = []): void
    {
        $this->queries++;

        $this->tables[$table] = array_values(array_filter(
            $this->tables[$table] ?? [],
            fn (array $row) => ! $this->matchesColumn($row, $column, $equals),
        ));
    }

    public function count(string $table, array $query = []): int
    {
        return count($this->select($table, $query));
    }

    /**
     * Emulates the two transactional booking functions defined in
     * supabase_booking_requests.sql. Same JSON envelopes the SQL returns, so
     * the service/controller code path is identical in tests and production.
     *
     * @param  array<string, mixed>  $params
     * @return array<string, mixed>
     */
    public function rpc(string $function, array $params = []): array
    {
        $this->queries++;

        $bookingId = (string) ($params['p_booking'] ?? '');
        $userId = (string) ($params['p_user'] ?? '');

        return match ($function) {
            'accept_booking' => $this->rpcAcceptBooking($bookingId, $userId),
            'cancel_booking' => $this->rpcCancelBooking($bookingId, $userId),
            default => throw new \RuntimeException("Unknown RPC function: {$function}", 500),
        };
    }

    /** @return array<string, mixed> */
    private function rpcAcceptBooking(string $bookingId, string $userId): array
    {
        $booking = $this->findRow('bookings', $bookingId);
        if ($booking === null) {
            return $this->rpcError('not_found', 'booking', 'This booking request no longer exists');
        }

        $cargoId = (string) $booking['cargo_id'];
        $truckId = (string) $booking['truck_id'];
        $cargo = $this->findRow('cargo', $cargoId);
        $truck = $this->findRow('trucks', $truckId);

        if ($cargo === null || $truck === null) {
            return $this->rpcError('not_found', 'booking', 'This booking request no longer exists');
        }

        if ($userId !== (string) ($booking['responder_id'] ?? '')) {
            return $this->rpcError('forbidden', 'booking', 'Only the other party can respond to this request');
        }

        if (($booking['status'] ?? '') !== 'pending') {
            return $this->rpcError('conflict', 'booking', 'This request has already been answered');
        }

        if (($cargo['status'] ?? '') !== 'posted') {
            return $this->rpcError('conflict', 'cargo', 'That load has just been booked');
        }

        if (($truck['status'] ?? '') !== 'available') {
            return $this->rpcError('conflict', 'truck', 'That truck has just been booked');
        }

        $now = now()->toIso8601String();

        $this->patchRow('bookings', $bookingId, [
            'status' => 'accepted', 'decided_by' => $userId, 'decided_at' => $now,
        ]);
        $this->patchRow('cargo', $cargoId, [
            'status' => 'booked', 'matched_truck_id' => $truckId, 'matched_at' => $now,
        ]);
        $this->patchRow('trucks', $truckId, [
            'status' => 'booked', 'matched_cargo_id' => $cargoId, 'matched_at' => $now,
        ]);

        // Competing pending requests for the same load or truck are rejected.
        foreach ($this->tables['bookings'] ?? [] as $index => $row) {
            if ($row['id'] === $bookingId || ($row['status'] ?? '') !== 'pending') {
                continue;
            }
            if ($row['cargo_id'] === $cargoId || $row['truck_id'] === $truckId) {
                $this->tables['bookings'][$index] = array_merge($row, [
                    'status' => 'rejected', 'decided_by' => $userId, 'decided_at' => $now,
                    'updated_at' => $now,
                ]);
            }
        }

        return [
            'ok' => true,
            'booking' => $this->findRow('bookings', $bookingId),
            'cargo' => $this->findRow('cargo', $cargoId),
            'truck' => $this->findRow('trucks', $truckId),
        ];
    }

    /** @return array<string, mixed> */
    private function rpcCancelBooking(string $bookingId, string $userId): array
    {
        $booking = $this->findRow('bookings', $bookingId);
        if ($booking === null) {
            return $this->rpcError('not_found', 'booking', 'This booking no longer exists');
        }

        if (
            $userId !== (string) ($booking['requester_id'] ?? '')
            && $userId !== (string) ($booking['responder_id'] ?? '')
        ) {
            return $this->rpcError('forbidden', 'booking', 'You can only cancel your own bookings');
        }

        if (in_array((string) ($booking['status'] ?? ''), ['cancelled', 'rejected'], true)) {
            return $this->rpcError('conflict', 'booking', 'This booking is already closed');
        }

        $cargoId = (string) $booking['cargo_id'];
        $truckId = (string) $booking['truck_id'];
        $now = now()->toIso8601String();

        if (($booking['status'] ?? '') === 'accepted') {
            $cargo = $this->findRow('cargo', $cargoId);
            if ($cargo !== null && ($cargo['matched_truck_id'] ?? null) === $truckId) {
                $this->patchRow('cargo', $cargoId, [
                    'status' => 'posted', 'matched_truck_id' => null, 'matched_at' => null,
                ]);
            }

            $truck = $this->findRow('trucks', $truckId);
            if ($truck !== null && ($truck['matched_cargo_id'] ?? null) === $cargoId) {
                $this->patchRow('trucks', $truckId, [
                    'status' => 'available', 'matched_cargo_id' => null, 'matched_at' => null,
                ]);
            }
        }

        $this->patchRow('bookings', $bookingId, [
            'status' => 'cancelled', 'decided_by' => $userId, 'decided_at' => $now,
        ]);

        return [
            'ok' => true,
            'booking' => $this->findRow('bookings', $bookingId),
            'cargo' => $this->findRow('cargo', $cargoId),
            'truck' => $this->findRow('trucks', $truckId),
        ];
    }

    /** @param array<string, mixed> $row */
    private function assertBookingActiveUnique(array $row): void
    {
        $status = (string) ($row['status'] ?? 'pending');
        if (! in_array($status, ['pending', 'accepted'], true)) {
            return;
        }

        foreach ($this->tables['bookings'] ?? [] as $existing) {
            $existingStatus = (string) ($existing['status'] ?? 'pending');
            if (! in_array($existingStatus, ['pending', 'accepted'], true)) {
                continue;
            }

            $samePair = $existing['cargo_id'] === $row['cargo_id']
                && $existing['truck_id'] === $row['truck_id'];
            $bothAccepted = $status === 'accepted' && $existingStatus === 'accepted';
            $sameCargo = $existing['cargo_id'] === $row['cargo_id'];
            $sameTruck = $existing['truck_id'] === $row['truck_id'];

            if ($samePair || ($bothAccepted && ($sameCargo || $sameTruck))) {
                throw new \RuntimeException(
                    'duplicate key value violates unique constraint "bookings_active_unique" (23505)',
                    500,
                );
            }
        }
    }

    /** @return array<string, mixed>|null */
    private function findRow(string $table, string $id): ?array
    {
        foreach ($this->tables[$table] ?? [] as $row) {
            if ((string) ($row['id'] ?? '') === $id) {
                return $row;
            }
        }

        return null;
    }

    /** @param array<string, mixed> $values */
    private function patchRow(string $table, string $id, array $values): void
    {
        foreach ($this->tables[$table] ?? [] as $index => $row) {
            if ((string) ($row['id'] ?? '') === $id) {
                $this->tables[$table][$index] = array_merge(
                    $row,
                    $values,
                    ['updated_at' => now()->toIso8601String()],
                );

                return;
            }
        }
    }

    /** @return array<string, mixed> */
    private function rpcError(string $error, string $field, string $message): array
    {
        return ['ok' => false, 'error' => $error, 'field' => $field, 'message' => $message];
    }

    /** @param array<int, array<string, mixed>> $rows @return array<int, array<string, mixed>> */
    private function order(array $rows, string $spec): array
    {
        [$column, $direction] = array_pad(explode('.', $spec), 2, 'asc');

        usort($rows, function (array $a, array $b) use ($column, $direction): int {
            $left = $a[$column] ?? '';
            $right = $b[$column] ?? '';
            $cmp = is_numeric($left) && is_numeric($right)
                ? ((float) $left <=> (float) $right)
                : strcmp((string) $left, (string) $right);

            return $direction === 'desc' ? -$cmp : $cmp;
        });

        return $rows;
    }

    /** @param array<string, mixed> $row @param array<string, mixed> $query */
    private function matches(array $row, array $query): bool
    {
        foreach ($query as $column => $filter) {
            if (in_array((string) $column, ['select', 'order', 'limit', 'offset'], true)) {
                continue;
            }
            if (! $this->matchesColumn($row, (string) $column, (string) $filter)) {
                return false;
            }
        }

        return true;
    }

    /** @param array<string, mixed> $row */
    private function matchesColumn(array $row, string $column, string $filter): bool
    {
        $raw = $row[$column] ?? null;
        $value = is_bool($raw) ? ($raw ? 'true' : 'false') : (string) $raw;

        if (str_starts_with($filter, 'eq.')) {
            return $value === substr($filter, 3);
        }

        if (str_starts_with($filter, 'neq.')) {
            return $value !== substr($filter, 4);
        }

        if ($filter === 'is.null') {
            return $raw === null || $raw === '';
        }

        if ($filter === 'not.is.null') {
            return $raw !== null && $raw !== '';
        }

        if (str_starts_with($filter, 'in.(') && str_ends_with($filter, ')')) {
            return in_array($value, explode(',', substr($filter, 4, -1)), true);
        }

        if (str_starts_with($filter, 'ilike.')) {
            $pattern = '/^'.str_replace(['%', '_'], ['.*', '.'], preg_quote(substr($filter, 6), '/')).'$/i';

            return (bool) preg_match($pattern, $value);
        }

        return false;
    }
}
