<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\SupabaseClient;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

/**
 * Shipments endpoints backing the dashboard's "New shipment" / "See all":
 *
 *   GET  /api/shipments          → { ok, shipments: [...] }  newest first
 *   POST /api/shipments          → { ok, shipment }          (creates + books event)
 *   GET  /api/shipments/{id}     → { ok, shipment }          owner only
 */
class ShipmentController extends Controller
{
    public function __construct(private SupabaseClient $supabase)
    {
    }

    public function index(Request $request): JsonResponse
    {
        $userId = (string) $request->attributes->get('auth_user')['id'];

        $rows = $this->supabase->select('shipments', [
            'user_id' => "eq.{$userId}",
            'order' => 'created_at.desc',
            'limit' => 100,
        ]);

        return response()->json([
            'ok' => true,
            'shipments' => array_map(fn (array $row) => $this->present($row), $rows),
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'origin' => ['required', 'string', 'min:2', 'max:160'],
            'destination' => ['required', 'string', 'min:2', 'max:160'],
            'notes' => ['nullable', 'string', 'max:1000'],
        ]);

        $userId = (string) $request->attributes->get('auth_user')['id'];

        $shipment = $this->supabase->insert('shipments', [
            'user_id' => $userId,
            'reference' => $this->newReference(),
            'origin' => trim($data['origin']),
            'destination' => trim($data['destination']),
            'notes' => $data['notes'] ?? null,
            'status' => 'booked',
        ]);

        // Seed the activity timeline so the dashboard shows life immediately.
        try {
            $this->supabase->insert('shipment_events', [
                'shipment_id' => $shipment['id'],
                'user_id' => $userId,
                'type' => 'update',
                'title' => 'Shipment booked',
                'body' => sprintf('%s → %s', $shipment['origin'], $shipment['destination']),
            ]);
        } catch (\Throwable) {
            // Activity is best-effort; the shipment itself was created.
        }

        return response()->json([
            'ok' => true,
            'shipment' => $this->present($shipment),
        ], 201);
    }

    public function show(Request $request, string $id): JsonResponse
    {
        $userId = (string) $request->attributes->get('auth_user')['id'];

        $row = $this->supabase->selectOne('shipments', [
            'id' => "eq.{$id}",
            'user_id' => "eq.{$userId}",
        ]);

        if ($row === null) {
            return response()->json([
                'ok' => false,
                'field' => 'shipment',
                'message' => 'Shipment not found',
            ], 404);
        }

        return response()->json(['ok' => true, 'shipment' => $this->present($row)]);
    }

    private function newReference(): string
    {
        // e.g. SF-7K2QX9 — short, human-readable, unique enough with the DB
        // unique index as the final guard.
        return 'SF-'.strtoupper(Str::random(6));
    }

    /** @param array<string, mixed> $row */
    private function present(array $row): array
    {
        return [
            'id' => $row['id'],
            'reference' => $row['reference'],
            'origin' => $row['origin'],
            'destination' => $row['destination'],
            'status' => $row['status'] ?? 'booked',
            'notes' => $row['notes'] ?? null,
            'createdAt' => isset($row['created_at'])
                ? (int) strtotime($row['created_at']) * 1000
                : null,
        ];
    }
}
