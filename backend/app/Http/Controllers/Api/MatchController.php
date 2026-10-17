<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\FreightPresenter;
use App\Services\MatchingEngine;
use App\Services\SupabaseClient;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Matching engine endpoints (SRS §18–§21).
 *
 *   GET  /api/matches                → role-aware best matches for the caller
 *                                      truck owner → their trucks × posted cargo
 *                                      cargo owner → their cargo × available trucks
 *   GET  /api/matches/cargo/{id}     → available trucks for one of my loads
 *   GET  /api/matches/truck/{id}     → posted loads for one of my trucks
 *
 * Matches are scored on the fly (stateless) so results are never stale.
 * Booking a match is a separate request lifecycle under /api/bookings.
 */
class MatchController extends Controller
{
    private const MAX_RESULTS = 50;

    public function __construct(
        private SupabaseClient $supabase,
        private MatchingEngine $engine,
    ) {}

    public function index(Request $request): JsonResponse
    {
        $user = $request->attributes->get('auth_user');
        $userId = (string) $user['id'];
        $role = $user['role'] ?? 'cargo_owner';

        $raw = $role === 'truck_owner'
            ? $this->matchesForFleet($userId)
            : $this->matchesForLoads($userId);

        return response()->json([
            'ok' => true,
            'role' => $role,
            'matches' => array_map(
                fn (array $match) => FreightPresenter::match($match),
                array_slice($this->rank($raw), 0, self::MAX_RESULTS),
            ),
        ]);
    }

    public function forCargo(Request $request, string $id): JsonResponse
    {
        if (! $this->looksLikeId($id)) {
            return $this->cargoNotFound();
        }

        $userId = (string) $request->attributes->get('auth_user')['id'];

        // The ownership check and the candidate-truck pool go out together —
        // one concurrent batch instead of two serial round trips.
        $rows = $this->supabase->selectMany([
            'cargo' => [
                'table' => 'cargo',
                'query' => ['id' => "eq.{$id}", 'owner_id' => "eq.{$userId}"],
            ],
            'trucks' => ['table' => 'trucks', 'query' => $this->availableTruckQuery()],
        ]);

        $cargo = $rows['cargo'][0] ?? null;

        if ($cargo === null) {
            return $this->cargoNotFound();
        }

        return response()->json([
            'ok' => true,
            'cargo' => FreightPresenter::cargo($cargo),
            'matches' => array_map(
                fn (array $match) => FreightPresenter::match($match),
                $this->engine->matchCargo($cargo, $rows['trucks'] ?? []),
            ),
        ]);
    }

    public function forTruck(Request $request, string $id): JsonResponse
    {
        if (! $this->looksLikeId($id)) {
            return $this->truckNotFound();
        }

        $userId = (string) $request->attributes->get('auth_user')['id'];

        $rows = $this->supabase->selectMany([
            'truck' => [
                'table' => 'trucks',
                'query' => ['id' => "eq.{$id}", 'owner_id' => "eq.{$userId}"],
            ],
            'cargo' => ['table' => 'cargo', 'query' => $this->postedCargoQuery()],
        ]);

        $truck = $rows['truck'][0] ?? null;

        if ($truck === null) {
            return $this->truckNotFound();
        }

        return response()->json([
            'ok' => true,
            'truck' => FreightPresenter::truck($truck),
            'matches' => array_map(
                fn (array $match) => FreightPresenter::match($match),
                $this->engine->matchTruck($truck, $rows['cargo'] ?? []),
            ),
        ]);
    }

    /** @return array<int, array<string, mixed>> */
    private function matchesForFleet(string $userId): array
    {
        $rows = $this->supabase->selectMany([
            'trucks' => [
                'table' => 'trucks',
                'query' => [
                    'owner_id' => "eq.{$userId}",
                    'status' => 'eq.available',
                    'order' => 'created_at.desc',
                ],
            ],
            'cargo' => ['table' => 'cargo', 'query' => $this->postedCargoQuery()],
        ]);

        $matches = [];
        foreach ($rows['trucks'] as $truck) {
            foreach ($this->engine->matchTruck($truck, $rows['cargo']) as $match) {
                $matches[] = $match;
            }
        }

        return $matches;
    }

    /** @return array<int, array<string, mixed>> */
    private function matchesForLoads(string $userId): array
    {
        $rows = $this->supabase->selectMany([
            'cargo' => [
                'table' => 'cargo',
                'query' => [
                    'owner_id' => "eq.{$userId}",
                    'status' => 'eq.posted',
                    'order' => 'created_at.desc',
                ],
            ],
            'trucks' => ['table' => 'trucks', 'query' => $this->availableTruckQuery()],
        ]);

        $matches = [];
        foreach ($rows['cargo'] as $load) {
            foreach ($this->engine->matchCargo($load, $rows['trucks']) as $match) {
                $matches[] = $match;
            }
        }

        return $matches;
    }

    /** @return array<string, string> */
    private function availableTruckQuery(): array
    {
        return [
            'status' => 'eq.available',
            'order' => 'created_at.desc',
            'limit' => 500,
        ];
    }

    /** @return array<string, string> */
    private function postedCargoQuery(): array
    {
        return [
            'status' => 'eq.posted',
            'order' => 'pickup_date.asc',
            'limit' => 500,
        ];
    }

    /**
     * @param  array<int, array<string, mixed>>  $matches
     * @return array<int, array<string, mixed>>
     */
    private function rank(array $matches): array
    {
        usort($matches, static function (array $a, array $b): int {
            return $b['total'] <=> $a['total'];
        });

        return $matches;
    }

    private function cargoNotFound(): JsonResponse
    {
        return response()->json([
            'ok' => false,
            'field' => 'cargo',
            'message' => 'Cargo not found',
        ], 404);
    }

    private function truckNotFound(): JsonResponse
    {
        return response()->json([
            'ok' => false,
            'field' => 'truck',
            'message' => 'Truck not found',
        ], 404);
    }
}
