<?php

namespace Tests\Unit;

use App\Services\BookingService;
use App\Services\MatchingEngine;
use App\Services\SupabaseClient;
use PHPUnit\Framework\TestCase;

/**
 * In-memory stand-in for SupabaseClient so BookingService can be tested for
 * behaviour (not HTTP). Supports the tiny slice of PostgREST the service uses:
 * eq / in filters, PATCH with representation.
 */
class FakeSupabase extends SupabaseClient
{
    /** @var array<string, array<int, array<string, mixed>>> */
    public array $tables = [];

    public function __construct()
    {
    }

    /** @param array<string, mixed> $query */
    public function select(string $table, array $query = []): array
    {
        $rows = array_values(array_filter(
            $this->tables[$table] ?? [],
            fn (array $row) => $this->matches($row, $query),
        ));

        if (isset($query['limit'])) {
            $rows = array_slice($rows, 0, (int) $query['limit']);
        }

        return $rows;
    }

    /** @param array<string, mixed> $query */
    public function selectOne(string $table, array $query = []): ?array
    {
        $query['limit'] = 1;

        return $this->select($table, $query)[0] ?? null;
    }

    /** @param array<string, mixed> $values */
    public function insert(string $table, array $values): array
    {
        $row = $values + ['id' => 'row-'.count($this->tables[$table] ?? [])];
        $this->tables[$table][] = $row;

        return $row;
    }

    /** @param array<string, mixed> $values */
    public function update(string $table, string $column, string $equals, array $values): array
    {
        $updated = [];
        foreach ($this->tables[$table] ?? [] as $index => $row) {
            if ($this->matchesColumn($row, $column, $equals)) {
                $this->tables[$table][$index] = array_merge($row, $values);
                $updated[] = $this->tables[$table][$index];
            }
        }

        return $updated;
    }

    /** @param array<string, mixed> $row @param array<string, mixed> $query */
    private function matches(array $row, array $query): bool
    {
        foreach ($query as $column => $filter) {
            if (in_array($column, ['select', 'order', 'limit'], true)) {
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
        $value = (string) ($row[$column] ?? '');

        if (str_starts_with($filter, 'eq.')) {
            return $value === substr($filter, 3);
        }

        if (str_starts_with($filter, 'in.(') && str_ends_with($filter, ')')) {
            $list = explode(',', substr($filter, 4, -1));

            return in_array($value, $list, true);
        }

        return false;
    }
}

class BookingServiceTest extends TestCase
{
    private FakeSupabase $supabase;
    private BookingService $bookings;

    protected function setUp(): void
    {
        parent::setUp();

        $this->supabase = new FakeSupabase();
        $this->supabase->tables['trucks'] = [[
            'id' => 't1',
            'owner_id' => 'owner-t',
            'registration_number' => 'T 123 ABC',
            'truck_type' => 'Flatbed',
            'capacity_tons' => 20,
            'current_location' => 'Dar es Salaam',
            'availability_date' => '2026-10-01',
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
            'status' => 'posted',
            'matched_truck_id' => null,
            'matched_at' => null,
        ]];

        $this->bookings = new BookingService($this->supabase, new MatchingEngine());
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

    public function test_accept_reserves_both_sides_and_links_them(): void
    {
        $result = $this->bookings->accept('owner-c', 't1', 'c1');

        $this->assertTrue($result['ok']);
        $this->assertSame('booked', $this->truck()['status']);
        $this->assertSame('c1', $this->truck()['matched_cargo_id']);
        $this->assertSame('booked', $this->cargo()['status']);
        $this->assertSame('t1', $this->cargo()['matched_truck_id']);
        $this->assertNotNull($this->cargo()['matched_at']);
    }

    public function test_accept_is_allowed_for_the_truck_owner_too(): void
    {
        $result = $this->bookings->accept('owner-t', 't1', 'c1');

        $this->assertTrue($result['ok']);
    }

    public function test_accept_rejects_a_caller_who_owns_neither_side(): void
    {
        $result = $this->bookings->accept('stranger', 't1', 'c1');

        $this->assertFalse($result['ok']);
        $this->assertSame(403, $result['status']);
        $this->assertSame('available', $this->truck()['status']);
    }

    public function test_accept_rejects_a_truck_that_is_no_longer_available(): void
    {
        $this->supabase->update('trucks', 'id', 'eq.t1', ['status' => 'booked']);

        $result = $this->bookings->accept('owner-c', 't1', 'c1');

        $this->assertFalse($result['ok']);
        $this->assertSame(409, $result['status']);
        $this->assertSame('truck', $result['field']);
    }

    public function test_accept_rejects_a_load_that_is_no_longer_posted(): void
    {
        $this->supabase->update('cargo', 'id', 'eq.c1', ['status' => 'cancelled']);

        $result = $this->bookings->accept('owner-c', 't1', 'c1');

        $this->assertFalse($result['ok']);
        $this->assertSame(409, $result['status']);
        $this->assertSame('cargo', $result['field']);
    }

    public function test_accept_rejects_a_pair_that_no_longer_matches(): void
    {
        // Truck can't carry the load any more.
        $this->supabase->update('cargo', 'id', 'eq.c1', ['weight_tons' => 99]);

        $result = $this->bookings->accept('owner-c', 't1', 'c1');

        $this->assertFalse($result['ok']);
        $this->assertSame(422, $result['status']);
    }

    public function test_accept_returns_not_found_for_unknown_ids(): void
    {
        $result = $this->bookings->accept('owner-c', 'nope', 'c1');

        $this->assertFalse($result['ok']);
        $this->assertSame(404, $result['status']);
    }

    public function test_release_for_cargo_frees_the_truck(): void
    {
        $this->bookings->accept('owner-c', 't1', 'c1');

        $this->bookings->releaseForCargo($this->cargo());

        $this->assertSame('available', $this->truck()['status']);
        $this->assertNull($this->truck()['matched_cargo_id']);
        $this->assertNull($this->cargo()['matched_truck_id']);
    }

    public function test_release_for_truck_sends_the_load_back_to_the_market(): void
    {
        $this->bookings->accept('owner-c', 't1', 'c1');

        $this->bookings->releaseForTruck($this->truck());

        $this->assertSame('posted', $this->cargo()['status']);
        $this->assertNull($this->cargo()['matched_truck_id']);
        $this->assertNull($this->truck()['matched_cargo_id']);
    }

    public function test_with_matched_trucks_attaches_the_counterpart(): void
    {
        $this->bookings->accept('owner-c', 't1', 'c1');

        $rows = $this->bookings->withMatchedTrucks($this->supabase->select('cargo', []));

        $this->assertSame('T 123 ABC', $rows[0]['matched_truck']['registration_number']);
    }
}
