<?php

namespace Tests\Unit;

use App\Services\MatchingEngine;
use PHPUnit\Framework\TestCase;

/**
 * Unit tests for the pure matching engine (SRS §18–§21).
 * No Laravel app or Supabase needed — the engine is side-effect free.
 */
class MatchingEngineTest extends TestCase
{
    private MatchingEngine $engine;

    protected function setUp(): void
    {
        parent::setUp();
        $this->engine = new MatchingEngine();
    }

    /** @param array<string, mixed> $overrides @return array<string, mixed> */
    private function truck(array $overrides = []): array
    {
        return array_merge([
            'id' => 't1',
            'status' => 'available',
            'capacity_tons' => 20,
            'current_location' => 'Dar es Salaam',
            'availability_date' => '2026-10-01',
        ], $overrides);
    }

    /** @param array<string, mixed> $overrides @return array<string, mixed> */
    private function cargo(array $overrides = []): array
    {
        return array_merge([
            'id' => 'c1',
            'weight_tons' => 10,
            'pickup_location' => 'Dar es Salaam',
            'destination_location' => 'Nairobi',
            'pickup_date' => '2026-10-10',
        ], $overrides);
    }

    public function test_eligible_when_available_capacity_and_date_all_fit(): void
    {
        $this->assertTrue($this->engine->isEligible($this->truck(), $this->cargo()));
    }

    public function test_ineligible_when_truck_not_available(): void
    {
        $this->assertFalse($this->engine->isEligible($this->truck(['status' => 'booked']), $this->cargo()));
    }

    public function test_ineligible_when_capacity_is_too_small(): void
    {
        $this->assertFalse($this->engine->isEligible($this->truck(['capacity_tons' => 5]), $this->cargo()));
    }

    public function test_ineligible_when_truck_is_busy_after_the_pickup_day(): void
    {
        $truck = $this->truck(['availability_date' => '2026-10-20']);

        $this->assertFalse($this->engine->isEligible($truck, $this->cargo()));
    }

    public function test_route_score_full_when_truck_sits_at_pickup(): void
    {
        $scores = $this->engine->score($this->truck(), $this->cargo());

        $this->assertSame(30, $scores['route']);
    }

    public function test_route_score_zero_when_locations_differ(): void
    {
        $truck = $this->truck(['current_location' => 'Arusha']);

        $this->assertSame(0, $this->engine->score($truck, $this->cargo())['route']);
    }

    public function test_capacity_scores_full_at_half_utilization_or_more(): void
    {
        $scores = $this->engine->score($this->truck(['capacity_tons' => 20]), $this->cargo(['weight_tons' => 10]));

        $this->assertSame(25, $scores['capacity']);
    }

    public function test_capacity_scales_down_for_oversized_trucks(): void
    {
        // 5 / 40 = 12.5% utilization → 15 + 10 * (0.125 / 0.5) = 17.5 → 18.
        $scores = $this->engine->score($this->truck(['capacity_tons' => 40]), $this->cargo(['weight_tons' => 5]));

        $this->assertSame(18, $scores['capacity']);
    }

    public function test_date_score_buckets(): void
    {
        $this->assertSame(20, $this->engine->score(
            $this->truck(['availability_date' => '2026-10-10']),
            $this->cargo(['pickup_date' => '2026-10-10']),
        )['date']);

        $this->assertSame(18, $this->engine->score(
            $this->truck(['availability_date' => '2026-10-09']),
            $this->cargo(['pickup_date' => '2026-10-10']),
        )['date']);

        $this->assertSame(15, $this->engine->score(
            $this->truck(['availability_date' => '2026-10-05']),
            $this->cargo(['pickup_date' => '2026-10-10']),
        )['date']);

        $this->assertSame(10, $this->engine->score(
            $this->truck(['availability_date' => '2026-09-01']),
            $this->cargo(['pickup_date' => '2026-10-10']),
        )['date']);
    }

    public function test_location_score_needs_a_valid_point_to_point_route(): void
    {
        $this->assertSame(15, $this->engine->score($this->truck(), $this->cargo())['location']);
        $this->assertSame(0, $this->engine->score(
            $this->truck(),
            $this->cargo(['destination_location' => 'dar es salaam']),
        )['location']);
    }

    public function test_perfect_match_scores_100_and_categorises_excellent(): void
    {
        $cargo = $this->cargo(['weight_tons' => 20, 'pickup_date' => '2026-10-01']);
        $matches = $this->engine->matchCargo($cargo, [$this->truck()]);

        $this->assertCount(1, $matches);
        $this->assertSame(100, $matches[0]['total']);
        $this->assertSame('excellent', $matches[0]['category']);
    }

    public function test_match_cargo_drops_ineligible_trucks(): void
    {
        $matches = $this->engine->matchCargo($this->cargo(), [
            $this->truck(['id' => 'ok']),
            $this->truck(['id' => 'busy', 'status' => 'booked']),
            $this->truck(['id' => 'small', 'capacity_tons' => 1]),
        ]);

        $this->assertCount(1, $matches);
        $this->assertSame('ok', $matches[0]['truck']['id']);
    }

    public function test_match_cargo_ranks_best_first(): void
    {
        $matches = $this->engine->matchCargo($this->cargo(), [
            $this->truck(['id' => 'far', 'current_location' => 'Mwanza']),
            $this->truck(['id' => 'near']),
        ]);

        $this->assertSame('near', $matches[0]['truck']['id']);
        $this->assertSame('far', $matches[1]['truck']['id']);
        $this->assertGreaterThan($matches[1]['total'], $matches[0]['total']);
    }

    public function test_match_truck_evaluates_each_load(): void
    {
        $matches = $this->engine->matchTruck($this->truck(), [
            $this->cargo(['id' => 'a']),
            $this->cargo(['id' => 'b', 'pickup_date' => '2026-10-15']),
            $this->cargo(['id' => 'too-early', 'pickup_date' => '2026-09-01']),
        ]);

        $this->assertCount(2, $matches);
    }
}
