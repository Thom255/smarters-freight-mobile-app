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
 *     stats:       { shipments, booked, inTransit, delivered, cancelled, orders },
 *     marketplace: { trucks, availableTrucks, cargo, postedCargo, matches },
 *     fleet:       { total, available, booked, inTransit, maintenance, inactive },
 *     loads:       { total, pending, confirmed, inTransit, completed, cancelled },
 *     bookings:    { active },
 *     activeShipment: { id, reference, origin, destination, status, createdAt } | null,
 *     upcomingDeliveries: [{ id, reference, origin, destination, status, createdAt }],
 *     recentActivity: [{ id, type, title, body, createdAt, reference }],
 *     alerts: [{ id, tone, title, body }]
 *   }
 *
 * Every number is derived from rows the caller is allowed to see — nothing is
 * fabricated or estimated. `fleet`/`loads` describe the caller's OWN records
 * (a cargo owner has no fleet, a truck owner has no loads), so the app only
 * renders the group that matches the signed-in role.
 *
 * All reads go out in ONE concurrent batch (SupabaseClient::selectMany): a
 * PostgREST round trip costs ~1s over the network, so serial reads made the
 * home screen take 5–10s to paint.
 */
class DashboardController extends Controller
{
    public function __construct(
        private SupabaseClient $supabase,
        private MatchingEngine $engine,
    ) {}

    public function __invoke(Request $request): JsonResponse
    {
        $user = $request->attributes->get('auth_user');
        $userId = (string) $user['id'];
        $role = $user['role'] ?? 'cargo_owner';
        $isTruckOwner = $role === 'truck_owner';

        $reads = [
            // The caller's own shipments drive the lifecycle counts and the
            // upcoming-deliveries queue.
            'shipments' => [
                'table' => 'shipments',
                'query' => [
                    'select' => 'id,reference,origin,destination,status,created_at',
                    'user_id' => "eq.{$userId}",
                    'order' => 'created_at.desc',
                    'limit' => 500,
                ],
            ],
            // Newest shipment still on the road (kept for the hero card).
            'active' => [
                'table' => 'shipments',
                'query' => [
                    'select' => 'id,reference,origin,destination,status,created_at',
                    'user_id' => "eq.{$userId}",
                    'status' => 'in.(booked,in_transit)',
                    'order' => 'created_at.desc',
                    'limit' => 1,
                ],
            ],
            'activity' => [
                'table' => 'shipment_events',
                'query' => [
                    'select' => 'id,type,title,body,created_at,shipments(reference)',
                    'user_id' => "eq.{$userId}",
                    'order' => 'created_at.desc',
                    'limit' => 8,
                ],
            ],
        ];

        if ($isTruckOwner) {
            // Own fleet (all statuses) + loads still open in the market.
            $reads['trucks'] = [
                'table' => 'trucks',
                'query' => ['owner_id' => "eq.{$userId}", 'limit' => 200],
            ];
            $reads['cargo'] = [
                'table' => 'cargo',
                'query' => ['status' => 'eq.posted', 'limit' => 500],
            ];
        } else {
            // Market supply + the caller's own loads.
            $reads['trucks'] = [
                'table' => 'trucks',
                'query' => ['status' => 'eq.available', 'limit' => 500],
            ];
            $reads['cargo'] = [
                'table' => 'cargo',
                'query' => ['owner_id' => "eq.{$userId}", 'limit' => 200],
            ];
        }

        $rows = $this->supabase->selectMany($reads);

        $shipmentRows = $rows['shipments'] ?? [];
        $truckRows = $rows['trucks'] ?? [];
        $cargoRows = $rows['cargo'] ?? [];

        $stats = $this->shipmentStats($shipmentRows);
        $fleet = $isTruckOwner ? $this->fleetStats($truckRows) : $this->emptyFleet();
        $loads = $isTruckOwner ? $this->emptyLoads() : $this->loadStats($cargoRows);

        return response()->json([
            'ok' => true,
            'role' => $role,
            'stats' => $stats,
            'marketplace' => $this->marketplace($role, $truckRows, $cargoRows),
            'fleet' => $fleet,
            'loads' => $loads,
            'bookings' => [
                'active' => $this->activeBookings($role, $cargoRows, $truckRows),
            ],
            'activeShipment' => $this->activeShipment($rows['active'] ?? []),
            'upcomingDeliveries' => $this->upcomingDeliveries($shipmentRows),
            'recentActivity' => $this->recentActivity($rows['activity'] ?? []),
            'alerts' => $this->alerts($role, $stats, $loads, $fleet, $cargoRows, $truckRows),
        ]);
    }

    /**
     * Lifecycle breakdown of the caller's shipments.
     *
     * @param  array<int, array<string, mixed>>  $shipments
     * @return array{shipments: int, booked: int, inTransit: int, delivered: int, cancelled: int, orders: int}
     */
    private function shipmentStats(array $shipments): array
    {
        $stats = [
            'shipments' => 0,
            'booked' => 0,
            'inTransit' => 0,
            'delivered' => 0,
            'cancelled' => 0,
            'orders' => 0,
        ];

        foreach ($shipments as $shipment) {
            $stats['shipments']++;
            switch ($shipment['status'] ?? '') {
                case 'booked':
                    $stats['booked']++;
                    break;
                case 'in_transit':
                    $stats['inTransit']++;
                    break;
                case 'delivered':
                    $stats['delivered']++;
                    break;
                case 'cancelled':
                    $stats['cancelled']++;
                    break;
            }
        }

        // `orders` predates the explicit breakdown (booked == awaiting pickup).
        $stats['orders'] = $stats['booked'];

        return $stats;
    }

    /**
     * The caller's own fleet, broken down by status.
     *
     * @param  array<int, array<string, mixed>>  $trucks
     * @return array{total: int, available: int, booked: int, inTransit: int, maintenance: int, inactive: int}
     */
    private function fleetStats(array $trucks): array
    {
        $stats = $this->emptyFleet();

        foreach ($trucks as $truck) {
            $stats['total']++;
            switch ($truck['status'] ?? '') {
                case 'available':
                    $stats['available']++;
                    break;
                case 'booked':
                    $stats['booked']++;
                    break;
                case 'in_transit':
                    $stats['inTransit']++;
                    break;
                case 'maintenance':
                    $stats['maintenance']++;
                    break;
                case 'inactive':
                    $stats['inactive']++;
                    break;
            }
        }

        return $stats;
    }

    /**
     * The caller's own loads, grouped into the buckets the home screen shows.
     *
     * @param  array<int, array<string, mixed>>  $cargo
     * @return array{total: int, pending: int, confirmed: int, inTransit: int, completed: int, cancelled: int}
     */
    private function loadStats(array $cargo): array
    {
        $stats = $this->emptyLoads();

        foreach ($cargo as $load) {
            $stats['total']++;
            switch ($load['status'] ?? '') {
                case 'posted':
                    $stats['pending']++;
                    break;
                case 'matched':
                case 'booked':
                    $stats['confirmed']++;
                    break;
                case 'in_transit':
                    $stats['inTransit']++;
                    break;
                case 'delivered':
                case 'completed':
                    $stats['completed']++;
                    break;
                case 'cancelled':
                    $stats['cancelled']++;
                    break;
            }
        }

        return $stats;
    }

    /** @return array{total: int, available: int, booked: int, inTransit: int, maintenance: int, inactive: int} */
    private function emptyFleet(): array
    {
        return ['total' => 0, 'available' => 0, 'booked' => 0, 'inTransit' => 0, 'maintenance' => 0, 'inactive' => 0];
    }

    /** @return array{total: int, pending: int, confirmed: int, inTransit: int, completed: int, cancelled: int} */
    private function emptyLoads(): array
    {
        return ['total' => 0, 'pending' => 0, 'confirmed' => 0, 'inTransit' => 0, 'completed' => 0, 'cancelled' => 0];
    }

    /**
     * Count of live truck↔cargo pairings the caller is part of.
     *
     * @param  array<int, array<string, mixed>>  $cargo
     * @param  array<int, array<string, mixed>>  $trucks
     */
    private function activeBookings(string $role, array $cargo, array $trucks): int
    {
        if ($role === 'truck_owner') {
            return count(array_filter($trucks, fn (array $truck) => $this->isActiveTruckBooking($truck)));
        }

        return count(array_filter($cargo, fn (array $load) => $this->isActiveCargoBooking($load)));
    }

    /** @param array<string, mixed> $truck */
    private function isActiveTruckBooking(array $truck): bool
    {
        return ! empty($truck['matched_cargo_id'])
            && in_array($truck['status'] ?? '', ['booked', 'in_transit'], true);
    }

    /** @param array<string, mixed> $load */
    private function isActiveCargoBooking(array $load): bool
    {
        return ! empty($load['matched_truck_id'])
            && in_array($load['status'] ?? '', ['matched', 'booked', 'in_transit'], true);
    }

    /**
     * The caller's shipments that have not reached a terminal state yet
     * (booked or in transit), longest-waiting first — the delivery queue.
     *
     * @param  array<int, array<string, mixed>>  $shipments
     * @return array<int, array<string, mixed>>
     */
    private function upcomingDeliveries(array $shipments): array
    {
        $upcoming = array_values(array_filter(
            $shipments,
            fn (array $shipment) => in_array($shipment['status'] ?? '', ['booked', 'in_transit'], true),
        ));

        usort($upcoming, fn (array $a, array $b) => strcmp(
            (string) ($a['created_at'] ?? ''),
            (string) ($b['created_at'] ?? ''),
        ));

        return array_map(fn (array $shipment) => [
            'id' => $shipment['id'],
            'reference' => $shipment['reference'] ?? null,
            'origin' => $shipment['origin'] ?? '',
            'destination' => $shipment['destination'] ?? '',
            'status' => $shipment['status'] ?? 'booked',
            'createdAt' => isset($shipment['created_at'])
                ? (int) strtotime((string) $shipment['created_at']) * 1000
                : null,
        ], array_slice($upcoming, 0, 5));
    }

    /**
     * Alerts computed from the rows already in hand — never invented.
     *
     * @param  array{shipments: int, booked: int, inTransit: int, delivered: int, cancelled: int, orders: int}  $stats
     * @param  array{total: int, pending: int, confirmed: int, inTransit: int, completed: int, cancelled: int}  $loads
     * @param  array{total: int, available: int, booked: int, inTransit: int, maintenance: int, inactive: int}  $fleet
     * @param  array<int, array<string, mixed>>  $cargo
     * @param  array<int, array<string, mixed>>  $trucks
     * @return array<int, array{id: string, tone: string, title: string, body: string}>
     */
    private function alerts(string $role, array $stats, array $loads, array $fleet, array $cargo, array $trucks): array
    {
        $alerts = [];

        if ($stats['booked'] > 0) {
            $alerts[] = [
                'id' => 'awaiting-pickup',
                'tone' => 'info',
                'title' => sprintf('%d %s awaiting pickup', $stats['booked'], $this->noun($stats['booked'], 'shipment')),
                'body' => 'Booked shipments have not started transit yet.',
            ];
        }

        if ($stats['inTransit'] > 0) {
            $alerts[] = [
                'id' => 'in-transit',
                'tone' => 'primary',
                'title' => sprintf('%d %s on the road', $stats['inTransit'], $this->noun($stats['inTransit'], 'shipment')),
                'body' => 'Track them from the shipments list.',
            ];
        }

        if ($role === 'truck_owner') {
            if ($fleet['maintenance'] > 0) {
                $alerts[] = [
                    'id' => 'maintenance',
                    'tone' => 'warning',
                    'title' => sprintf('%d %s in maintenance', $fleet['maintenance'], $this->noun($fleet['maintenance'], 'truck')),
                    'body' => 'These trucks are not bookable until they are back on the road.',
                ];
            }

            $unverified = count(array_filter(
                $trucks,
                fn (array $truck) => ($truck['verification_status'] ?? '') === 'pending',
            ));
            if ($unverified > 0) {
                $alerts[] = [
                    'id' => 'verification',
                    'tone' => 'warning',
                    'title' => sprintf('%d %s awaiting verification', $unverified, $this->noun($unverified, 'truck')),
                    'body' => 'Verification keeps your fleet eligible for matching.',
                ];
            }

            return $alerts;
        }

        if ($loads['pending'] > 0) {
            $alerts[] = [
                'id' => 'unmatched-loads',
                'tone' => 'info',
                'title' => sprintf('%d %s waiting for a truck', $loads['pending'], $this->noun($loads['pending'], 'load')),
                'body' => 'Open the matches screen to review available trucks.',
            ];
        }

        $today = now()->toDateString();
        $overdue = count(array_filter(
            $cargo,
            fn (array $load) => ($load['status'] ?? '') === 'posted'
                && isset($load['pickup_date'])
                && (string) $load['pickup_date'] < $today,
        ));
        if ($overdue > 0) {
            $alerts[] = [
                'id' => 'overdue-pickups',
                'tone' => 'warning',
                'title' => sprintf('%d %s past their pickup date', $overdue, $this->noun($overdue, 'load')),
                'body' => 'Update the pickup date or book them before they go stale.',
            ];
        }

        return $alerts;
    }

    /** 'truck' / 'trucks' — keeps the alert copy grammatical. */
    private function noun(int $count, string $singular): string
    {
        return $count === 1 ? $singular : $singular.'s';
    }

    /**
     * Role-aware marketplace summary.
     *
     * truck_owner → `$trucks` is the owner's fleet and `$cargo` the posted loads
     * cargo_owner → `$trucks` are the available trucks and `$cargo` the owner's loads
     *
     * @param  array<int, array<string, mixed>>  $trucks
     * @param  array<int, array<string, mixed>>  $cargo
     * @return array{trucks: int, availableTrucks: int, cargo: int, postedCargo: int, matches: int}
     */
    private function marketplace(string $role, array $trucks, array $cargo): array
    {
        $available = array_values(array_filter($trucks, fn (array $t) => ($t['status'] ?? '') === 'available'));
        $posted = array_values(array_filter($cargo, fn (array $c) => ($c['status'] ?? '') === 'posted'));

        $matches = 0;

        if ($role === 'truck_owner') {
            foreach ($available as $truck) {
                $matches += count($this->engine->matchTruck($truck, $posted));
            }

            return [
                'trucks' => count($trucks),
                'availableTrucks' => count($available),
                'cargo' => count($posted),
                'postedCargo' => count($posted),
                'matches' => $matches,
            ];
        }

        foreach ($posted as $load) {
            $matches += count($this->engine->matchCargo($load, $available));
        }

        return [
            'trucks' => count($available),
            'availableTrucks' => count($available),
            'cargo' => count($cargo),
            'postedCargo' => count($posted),
            'matches' => $matches,
        ];
    }

    /**
     * @param  array<int, array<string, mixed>>  $rows
     * @return array<string, mixed>|null
     */
    private function activeShipment(array $rows): ?array
    {
        $row = $rows[0] ?? null;

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

    /**
     * @param  array<int, array<string, mixed>>  $rows
     * @return array<int, array<string, mixed>>
     */
    private function recentActivity(array $rows): array
    {
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
