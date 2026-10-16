<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\MatchingEngine;
use App\Services\SupabaseClient;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Dashboard payload for src/app/(tabs)/index.tsx.
 *
 *   GET /api/dashboard
 *   {
 *     ok: true,
 *     role: 'truck_owner' | 'cargo_owner' | 'admin',
 *     stats: { shipments, inTransit, orders },
 *     marketplace: { trucks, availableTrucks, cargo, postedCargo, matches },
 *     activeShipment: { id, reference, origin, destination, status, createdAt } | null,
 *     recentActivity: [{ id, type, title, body, createdAt, reference }]
 *   }
 *
 * `stats` keeps the legacy shipment tracker alive; `marketplace` is the
 * role-aware freight-marketplace summary (SRS §10–§13).
 */
class DashboardController extends Controller
{
    public function __construct(
        private SupabaseClient $supabase,
        private MatchingEngine $engine,
    ) {
    }

    public function __invoke(Request $request): JsonResponse
    {
        $user = $request->attributes->get('auth_user');
        $userId = (string) $user['id'];
        $role = $user['role'] ?? 'cargo_owner';

        return response()->json([
            'ok' => true,
            'role' => $role,
            'stats' => $this->shipmentStats($userId),
            'marketplace' => $this->marketplace($userId, $role),
            'activeShipment' => $this->activeShipment($userId),
            'recentActivity' => $this->recentActivity($userId),
        ]);
    }

    /** @return array{shipments: int, inTransit: int, orders: int} */
    private function shipmentStats(string $userId): array
    {
        $shipments = $this->supabase->select('shipments', [
            'select' => 'id,status',
            'user_id' => "eq.{$userId}",
            'limit' => 500,
        ]);

        $stats = ['shipments' => 0, 'inTransit' => 0, 'orders' => 0];
        foreach ($shipments as $shipment) {
            $stats['shipments']++;
            if ($shipment['status'] === 'in_transit') {
                $stats['inTransit']++;
            } elseif ($shipment['status'] === 'booked') {
                $stats['orders']++;
            }
        }

        return $stats;
    }

    /**
     * @return array{trucks: int, availableTrucks: int, cargo: int, postedCargo: int, matches: int}
     */
    private function marketplace(string $userId, string $role): array
    {
        $summary = ['trucks' => 0, 'availableTrucks' => 0, 'cargo' => 0, 'postedCargo' => 0, 'matches' => 0];

        if ($role === 'truck_owner') {
            $myTrucks = $this->supabase->select('trucks', ['owner_id' => "eq.{$userId}", 'limit' => 200]);
            $available = array_values(array_filter($myTrucks, fn (array $t) => ($t['status'] ?? '') === 'available'));
            $posted = $this->supabase->select('cargo', ['status' => 'eq.posted', 'limit' => 500]);

            $matches = 0;
            foreach ($available as $truck) {
                $matches += count($this->engine->matchTruck($truck, $posted));
            }

            return [
                'trucks' => count($myTrucks),
                'availableTrucks' => count($available),
                'cargo' => count($posted),
                'postedCargo' => count($posted),
                'matches' => $matches,
            ];
        }

        $myCargo = $this->supabase->select('cargo', ['owner_id' => "eq.{$userId}", 'limit' => 200]);
        $postedMine = array_values(array_filter($myCargo, fn (array $c) => ($c['status'] ?? '') === 'posted'));
        $availableTrucks = $this->supabase->select('trucks', ['status' => 'eq.available', 'limit' => 500]);

        $matches = 0;
        foreach ($postedMine as $cargo) {
            $matches += count($this->engine->matchCargo($cargo, $availableTrucks));
        }

        return [
            'trucks' => count($availableTrucks),
            'availableTrucks' => count($availableTrucks),
            'cargo' => count($myCargo),
            'postedCargo' => count($postedMine),
            'matches' => $matches,
        ];
    }

    /** @return array<string, mixed>|null */
    private function activeShipment(string $userId): ?array
    {
        $row = $this->supabase->selectOne('shipments', [
            'select' => 'id,reference,origin,destination,status,created_at',
            'user_id' => "eq.{$userId}",
            'status' => 'in.(booked,in_transit)',
            'order' => 'created_at.desc',
        ]);

        if ($row === null) {
            return null;
        }

        return [
            'id' => $row['id'],
            'reference' => $row['reference'],
            'origin' => $row['origin'],
            'destination' => $row['destination'],
            'status' => $row['status'],
            'createdAt' => isset($row['created_at'])
                ? (int) strtotime($row['created_at']) * 1000
                : null,
        ];
    }

    /** @return array<int, array<string, mixed>> */
    private function recentActivity(string $userId): array
    {
        $rows = $this->supabase->select('shipment_events', [
            'select' => 'id,type,title,body,created_at,shipments(reference)',
            'user_id' => "eq.{$userId}",
            'order' => 'created_at.desc',
            'limit' => 8,
        ]);

        return array_map(function (array $row) {
            return [
                'id' => $row['id'],
                'type' => $row['type'] ?? 'update',
                'title' => $row['title'] ?? 'Shipment update',
                'body' => $row['body'] ?? null,
                'createdAt' => isset($row['created_at'])
                    ? (int) strtotime($row['created_at']) * 1000
                    : null,
                'reference' => $row['shipments']['reference'] ?? null,
            ];
        }, $rows);
    }
}
