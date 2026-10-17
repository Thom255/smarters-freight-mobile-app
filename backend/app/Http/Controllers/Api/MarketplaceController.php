<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\FreightPresenter;
use App\Services\SupabaseClient;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Marketplace browse (SRS §14, §16–§17).
 *
 * Unlike the owner-scoped /api/trucks and /api/cargo collections, these
 * endpoints show the whole open marketplace to any signed-in user:
 *
 *   GET /api/marketplace/trucks        → every available truck
 *   GET /api/marketplace/trucks/{id}   → one truck
 *   GET /api/marketplace/cargo         → every posted load
 *   GET /api/marketplace/cargo/{id}    → one load
 *
 * Narrowing by location/type is left to the client (the app already filters
 * listing results locally), so the payload stays a single round trip.
 */
class MarketplaceController extends Controller
{
    private const LIMIT = 200;

    public function __construct(private SupabaseClient $supabase) {}

    public function trucks(Request $request): JsonResponse
    {
        $rows = $this->supabase->select('trucks', [
            'status' => 'eq.available',
            'order' => 'created_at.desc',
            'limit' => self::LIMIT,
        ]);

        return response()->json([
            'ok' => true,
            'trucks' => array_map(
                fn (array $row) => FreightPresenter::truck($row),
                $rows,
            ),
        ]);
    }

    public function truck(Request $request, string $id): JsonResponse
    {
        if (! $this->looksLikeId($id)) {
            return $this->notFound('truck', 'Truck not found');
        }

        $truck = $this->supabase->selectOne('trucks', ['id' => "eq.{$id}"]);

        if ($truck === null) {
            return $this->notFound('truck', 'Truck not found');
        }

        return response()->json(['ok' => true, 'truck' => FreightPresenter::truck($truck)]);
    }

    public function cargo(Request $request): JsonResponse
    {
        $rows = $this->supabase->select('cargo', [
            'status' => 'eq.posted',
            'order' => 'pickup_date.asc',
            'limit' => self::LIMIT,
        ]);

        return response()->json([
            'ok' => true,
            'cargo' => array_map(
                fn (array $row) => FreightPresenter::cargo($row),
                $rows,
            ),
        ]);
    }

    public function cargoShow(Request $request, string $id): JsonResponse
    {
        if (! $this->looksLikeId($id)) {
            return $this->notFound('cargo', 'Cargo not found');
        }

        $cargo = $this->supabase->selectOne('cargo', ['id' => "eq.{$id}"]);

        if ($cargo === null) {
            return $this->notFound('cargo', 'Cargo not found');
        }

        return response()->json(['ok' => true, 'cargo' => FreightPresenter::cargo($cargo)]);
    }

    private function notFound(string $field, string $message): JsonResponse
    {
        return response()->json([
            'ok' => false,
            'field' => $field,
            'message' => $message,
        ], 404);
    }
}
