<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\BookingService;
use App\Services\FreightPresenter;
use App\Services\MatchingEngine;
use App\Services\SupabaseClient;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Matching engine endpoints (SRS §18–§22).
 *
 *   GET  /api/matches                → role-aware best matches for the caller
 *                                      truck owner → their trucks × posted cargo
 *                                      cargo owner → their cargo × available trucks
 *   GET  /api/matches/cargo/{id}     → available trucks for one of my loads
 *   GET  /api/matches/truck/{id}     → posted loads for one of my trucks
 *   POST /api/matches/accept         → book a truck↔cargo match (both sides)
 *
 * Matches are scored on the fly (stateless) so results are never stale.
 */
class MatchController extends Controller
{
    private const MAX_RESULTS = 50;

    public function __construct(
        private SupabaseClient $supabase,
        private MatchingEngine $engine,
        private BookingService $bookings,
    ) {
    }

    /** Book a match: reserve the truck and mark the load booked. */
    public function accept(Request $request): JsonResponse
    {
        $data = $request->validate([
            'truckId' => ['required', 'string', 'max:64'],
            'cargoId' => ['required', 'string', 'max:64'],
        ], [
            'truckId.required' => 'Missing the truck to book',
            'cargoId.required' => 'Missing the load to book',
        ], [
            'truckId' => 'truck',
            'cargoId' => 'cargo',
        ]);

        $userId = (string) $request->attributes->get('auth_user')['id'];
        $result = $this->bookings->accept($userId, $data['truckId'], $data['cargoId']);

        if (($result['ok'] ?? false) !== true) {
            return response()->json([
                'ok' => false,
                'field' => $result['field'],
                'message' => $result['message'],
            ], $result['status']);
        }

        return response()->json([
            'ok' => true,
            'truck' => FreightPresenter::truck($result['truck']),
            'cargo' => FreightPresenter::cargo($result['cargo']),
        ]);
    }

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
        $userId = (string) $request->attributes->get('auth_user')['id'];

        $cargo = $this->supabase->selectOne('cargo', [
            'id' => "eq.{$id}",
            'owner_id' => "eq.{$userId}",
        ]);

        if ($cargo === null) {
            return response()->json(['ok' => false, 'field' => 'cargo', 'message' => 'Cargo not found'], 404);
        }

        $trucks = $this->availableTrucks();

        return response()->json([
            'ok' => true,
            'cargo' => FreightPresenter::cargo($cargo),
            'matches' => array_map(
                fn (array $match) => FreightPresenter::match($match),
                $this->engine->matchCargo($cargo, $trucks),
            ),
        ]);
    }

    public function forTruck(Request $request, string $id): JsonResponse
    {
        $userId = (string) $request->attributes->get('auth_user')['id'];

        $truck = $this->supabase->selectOne('trucks', [
            'id' => "eq.{$id}",
            'owner_id' => "eq.{$userId}",
        ]);

        if ($truck === null) {
            return response()->json(['ok' => false, 'field' => 'truck', 'message' => 'Truck not found'], 404);
        }

        $cargo = $this->postedCargo();

        return response()->json([
            'ok' => true,
            'truck' => FreightPresenter::truck($truck),
            'matches' => array_map(
                fn (array $match) => FreightPresenter::match($match),
                $this->engine->matchTruck($truck, $cargo),
            ),
        ]);
    }

    /** @return array<int, array<string, mixed>> */
    private function matchesForFleet(string $userId): array
    {
        $trucks = $this->supabase->select('trucks', [
            'owner_id' => "eq.{$userId}",
            'status' => 'eq.available',
            'order' => 'created_at.desc',
        ]);
        $cargo = $this->postedCargo();

        $matches = [];
        foreach ($trucks as $truck) {
            foreach ($this->engine->matchTruck($truck, $cargo) as $match) {
                $matches[] = $match;
            }
        }

        return $matches;
    }

    /** @return array<int, array<string, mixed>> */
    private function matchesForLoads(string $userId): array
    {
        $cargo = $this->supabase->select('cargo', [
            'owner_id' => "eq.{$userId}",
            'status' => 'eq.posted',
            'order' => 'created_at.desc',
        ]);
        $trucks = $this->availableTrucks();

        $matches = [];
        foreach ($cargo as $load) {
            foreach ($this->engine->matchCargo($load, $trucks) as $match) {
                $matches[] = $match;
            }
        }

        return $matches;
    }

    /** @return array<int, array<string, mixed>> */
    private function availableTrucks(): array
    {
        return $this->supabase->select('trucks', [
            'status' => 'eq.available',
            'order' => 'created_at.desc',
            'limit' => 500,
        ]);
    }

    /** @return array<int, array<string, mixed>> */
    private function postedCargo(): array
    {
        return $this->supabase->select('cargo', [
            'status' => 'eq.posted',
            'order' => 'pickup_date.asc',
            'limit' => 500,
        ]);
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
}
