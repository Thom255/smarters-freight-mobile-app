<?php

namespace App\Http\Controllers\Api;

use App\Exceptions\DataStoreUnavailable;
use App\Http\Controllers\Controller;
use App\Services\BookingService;
use App\Services\FreightPresenter;
use App\Services\SupabaseClient;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;

/**
 * Admin system console (SRS §2/§9 admin surface): system-wide reads plus
 * user account management. Every route sits behind `auth.role:admin`, so a
 * cargo/truck owner holding a valid token gets 403 from the middleware
 * before this controller is ever reached — and nothing on the customer-facing
 * API can list other users' records at all.
 *
 *   GET   /api/admin/overview      → system-wide counts (users, cargo, trucks,
 *                                    bookings, shipments, commissions)
 *   GET   /api/admin/users         → every account with role + status
 *   PATCH /api/admin/users/{id}    → change a user's role and/or account
 *                                    status (suspend / reactivate)
 *   GET   /api/admin/cargo         → every load, with its owner
 *   GET   /api/admin/trucks        → every truck, with its owner
 *   GET   /api/admin/bookings      → every booking, both parties + pairing
 *   GET   /api/admin/shipments     → every shipment, with its owner
 *
 * Account status (`users.status` in supabase_admin.sql) is optional: while
 * that migration has not been applied, every account reads as `active` and
 * only the suspend/reactivate write reports that it is unavailable — the
 * reads never fail because of the missing column.
 *
 * Every administrative action is audit-logged (Log facade → laravel.log)
 * with the acting admin, the target and the change.
 */
class AdminConsoleController extends Controller
{
    /** users.status values, mirroring supabase_admin.sql's CHECK constraint. */
    private const ACCOUNT_STATUSES = ['active', 'suspended'];

    public function __construct(
        private SupabaseClient $supabase,
        private BookingService $bookings,
    ) {}

    public function overview(): JsonResponse
    {
        $rows = $this->supabase->selectMany([
            'users' => ['table' => 'users', 'query' => ['select' => '*', 'limit' => 10000]],
            'cargo' => ['table' => 'cargo', 'query' => ['select' => 'id,status', 'limit' => 10000]],
            'trucks' => ['table' => 'trucks', 'query' => ['select' => 'id,status', 'limit' => 10000]],
            'bookings' => ['table' => 'bookings', 'query' => ['select' => 'id,status', 'limit' => 10000]],
            'shipments' => ['table' => 'shipments', 'query' => ['select' => 'id,status', 'limit' => 10000]],
            'commissions' => ['table' => 'commissions', 'query' => ['select' => 'status,commission_amount,currency', 'limit' => 10000]],
        ]);

        $users = ['total' => 0, 'admins' => 0, 'cargoOwners' => 0, 'truckOwners' => 0, 'active' => 0, 'suspended' => 0];
        foreach ($rows['users'] ?? [] as $user) {
            $users['total']++;
            match ((string) ($user['role'] ?? 'cargo_owner')) {
                'admin' => $users['admins']++,
                'truck_owner' => $users['truckOwners']++,
                default => $users['cargoOwners']++,
            };
            // status is optional (supabase_admin.sql) — absent means active.
            if ((string) ($user['status'] ?? 'active') === 'suspended') {
                $users['suspended']++;
            } else {
                $users['active']++;
            }
        }

        // Commission revenue is derived from ledger statuses only, exactly
        // like CommissionService::summary() — mutually exclusive buckets, so
        // no amount is ever counted twice.
        $revenue = ['liveCommission' => 0.0, 'paidCommission' => 0.0, 'totalRecords' => 0];
        foreach ($rows['commissions'] ?? [] as $commission) {
            $revenue['totalRecords']++;
            $status = (string) ($commission['status'] ?? '');
            $amount = (float) ($commission['commission_amount'] ?? 0);
            if ($status === 'paid') {
                $revenue['paidCommission'] += $amount;
            }
            if (in_array($status, ['pending', 'earned', 'paid'], true)) {
                $revenue['liveCommission'] += $amount;
            }
        }
        $revenue['liveCommission'] = round($revenue['liveCommission'], 2);
        $revenue['paidCommission'] = round($revenue['paidCommission'], 2);

        return response()->json([
            'ok' => true,
            'users' => $users,
            'cargo' => $this->statusCounts($rows['cargo'] ?? []),
            'trucks' => $this->statusCounts($rows['trucks'] ?? []),
            'bookings' => $this->statusCounts($rows['bookings'] ?? []),
            'shipments' => $this->statusCounts($rows['shipments'] ?? []),
            'revenue' => $revenue,
        ]);
    }

    public function users(): JsonResponse
    {
        $rows = $this->selectUsers();

        usort($rows, static fn (array $a, array $b): int => strcmp(
            (string) ($b['created_at'] ?? ''),
            (string) ($a['created_at'] ?? ''),
        ));

        return response()->json([
            'ok' => true,
            'users' => array_map(fn (array $row) => $this->presentUser($row), $rows),
        ]);
    }

    public function updateUser(Request $request, string $id): JsonResponse
    {
        if (! $this->looksLikeId($id)) {
            return $this->notFound();
        }

        $data = $request->validate([
            'role' => ['sometimes', 'string', 'in:truck_owner,cargo_owner,admin'],
            'status' => ['sometimes', 'string', 'in:active,suspended'],
        ], [
            'role.in' => 'Choose a valid account type',
            'status.in' => 'Choose a valid account status',
        ], [
            'role' => 'role',
            'status' => 'status',
        ]);

        if ($data === []) {
            return response()->json([
                'ok' => false,
                'field' => 'form',
                'message' => 'Nothing to update',
            ], 422);
        }

        $admin = $request->attributes->get('auth_user');

        // Never let an admin lock themselves out (or demote themselves) —
        // the change must target somebody else's account.
        if ((string) $admin['id'] === $id) {
            return response()->json([
                'ok' => false,
                'field' => 'form',
                'message' => 'You cannot change your own account.',
            ], 422);
        }

        $existing = $this->supabase->selectOne('users', ['id' => "eq.{$id}"]);
        if ($existing === null) {
            return $this->notFound();
        }

        $values = [];
        if (isset($data['role'])) {
            $values['role'] = $data['role'];
        }
        if (isset($data['status'])) {
            $values['status'] = $data['status'];
        }

        try {
            $updated = $this->supabase->update('users', 'id', "eq.{$id}", $values);
        } catch (DataStoreUnavailable $e) {
            // The suspend/reactivate write needs users.status
            // (supabase_admin.sql); role-only changes still work without it.
            if (array_key_exists('status', $values) && str_contains(strtolower($e->getMessage()), 'status')) {
                Log::error('admin.user.update_failed', [
                    'admin_id' => (string) $admin['id'],
                    'user_id' => $id,
                    'error' => $e->getMessage(),
                ]);

                return response()->json([
                    'ok' => false,
                    'field' => 'status',
                    'message' => 'Account status is not available yet — apply supabase_admin.sql first.',
                ], 500);
            }

            throw $e;
        }

        $row = $updated[0] ?? array_merge($existing, $values);

        Log::info('admin.user.updated', [
            'admin_id' => (string) $admin['id'],
            'user_id' => $id,
            'changes' => array_keys($values),
            'role' => (string) ($row['role'] ?? ''),
            'status' => (string) ($row['status'] ?? 'active'),
        ]);

        return response()->json([
            'ok' => true,
            'user' => $this->presentUser($row),
        ]);
    }

    public function cargo(): JsonResponse
    {
        $rows = $this->supabase->select('cargo', [
            'order' => 'created_at.desc',
            'limit' => 500,
        ]);

        $owners = $this->ownerSummaries($rows, 'owner_id');

        return response()->json([
            'ok' => true,
            'cargo' => array_map(fn (array $row) => FreightPresenter::cargo($row) + [
                'owner' => $owners[(string) ($row['owner_id'] ?? '')] ?? null,
            ], $rows),
        ]);
    }

    public function trucks(): JsonResponse
    {
        $rows = $this->supabase->select('trucks', [
            'order' => 'created_at.desc',
            'limit' => 500,
        ]);

        $owners = $this->ownerSummaries($rows, 'owner_id');

        return response()->json([
            'ok' => true,
            'trucks' => array_map(fn (array $row) => FreightPresenter::truck($row) + [
                'owner' => $owners[(string) ($row['owner_id'] ?? '')] ?? null,
            ], $rows),
        ]);
    }

    public function bookings(): JsonResponse
    {
        // Same relation-attaching read as the customer-facing screen, minus
        // the "my bookings" filter: both parties, the load and the truck ride
        // along on every row.
        $rows = $this->supabase->select('bookings', [
            'order' => 'created_at.desc',
            'limit' => 500,
        ]);

        return response()->json([
            'ok' => true,
            'bookings' => array_map(
                fn (array $row) => FreightPresenter::booking($row),
                $this->bookings->withRelationsForAdmin($rows),
            ),
        ]);
    }

    public function shipments(): JsonResponse
    {
        $rows = $this->supabase->select('shipments', [
            'order' => 'created_at.desc',
            'limit' => 500,
        ]);

        $owners = $this->ownerSummaries($rows, 'user_id');

        return response()->json([
            'ok' => true,
            'shipments' => array_map(fn (array $row) => [
                'id' => $row['id'],
                'reference' => $row['reference'] ?? '',
                'origin' => $row['origin'] ?? '',
                'destination' => $row['destination'] ?? '',
                'status' => $row['status'] ?? 'booked',
                'notes' => $row['notes'] ?? null,
                'cargoType' => $row['cargo_type'] ?? null,
                'weightTons' => isset($row['weight_tons']) && $row['weight_tons'] !== null
                    ? (float) $row['weight_tons']
                    : null,
                'pickupDate' => $this->toMillis($row['pickup_date'] ?? null),
                'createdAt' => $this->toMillis($row['created_at'] ?? null),
                'owner' => $owners[(string) ($row['user_id'] ?? '')] ?? null,
            ], $rows),
        ]);
    }

    /**
     * users rows with the optional status column: the explicit column list
     * is retried without `status` when supabase_admin.sql has not been
     * applied, so the user list never fails on the missing migration.
     *
     * @return array<int, array<string, mixed>>
     */
    private function selectUsers(): array
    {
        $query = [
            'select' => 'id,identifier,name,role,company_name,created_at,status',
            'limit' => 1000,
        ];

        try {
            return $this->supabase->select('users', $query);
        } catch (DataStoreUnavailable $e) {
            if (! str_contains(strtolower($e->getMessage()), 'status')) {
                throw $e;
            }

            unset($query['select']);

            return $this->supabase->select('users', $query);
        }
    }

    /**
     * @param  array<string, mixed>  $row
     * @return array<string, mixed>
     */
    private function presentUser(array $row): array
    {
        return [
            'id' => $row['id'],
            'identifier' => $row['identifier'] ?? '',
            'name' => $row['name'] ?? null,
            'role' => $row['role'] ?? 'cargo_owner',
            'companyName' => $row['company_name'] ?? null,
            // Absent status (migration not applied) means the account is active.
            'status' => $this->accountStatus($row['status'] ?? null),
            'createdAt' => $this->toMillis($row['created_at'] ?? null),
        ];
    }

    /**
     * Normalised users.status: an absent column (migration not applied) or
     * an unknown value both read as `active`, so a row without the column can
     * never fatal on `$row['status']`.
     */
    private function accountStatus(mixed $value): string
    {
        $status = is_string($value) ? $value : 'active';

        return in_array($status, self::ACCOUNT_STATUSES, true) ? $status : 'active';
    }

    /**
     * Batch-load the owner summaries for a result set (one extra read, no N+1).
     *
     * @param  array<int, array<string, mixed>>  $rows
     * @return array<string, array{id: string, name: string|null, companyName: string|null}>
     */
    private function ownerSummaries(array $rows, string $column): array
    {
        $ids = [];
        foreach ($rows as $row) {
            $ownerId = $row[$column] ?? null;
            if (is_string($ownerId) && $ownerId !== '') {
                $ids[$ownerId] = $ownerId;
            }
        }

        if ($ids === []) {
            return [];
        }

        $users = $this->supabase->select('users', [
            'select' => 'id,name,company_name',
            'id' => 'in.('.implode(',', $ids).')',
            'limit' => 1000,
        ]);

        $summaries = [];
        foreach ($users as $user) {
            $summaries[(string) $user['id']] = [
                'id' => (string) $user['id'],
                'name' => isset($user['name']) ? (string) $user['name'] : null,
                'companyName' => isset($user['company_name']) ? (string) $user['company_name'] : null,
            ];
        }

        return $summaries;
    }

    /**
     * { total: n, byStatus: { status: count } } for one table's rows.
     *
     * @param  array<int, array<string, mixed>>  $rows
     * @return array{total: int, byStatus: array<string, int>}
     */
    private function statusCounts(array $rows): array
    {
        $counts = ['total' => count($rows), 'byStatus' => []];

        foreach ($rows as $row) {
            $status = (string) ($row['status'] ?? 'unknown');
            $counts['byStatus'][$status] = ($counts['byStatus'][$status] ?? 0) + 1;
        }

        ksort($counts['byStatus']);

        return $counts;
    }

    private function toMillis(mixed $value): ?int
    {
        if (! is_string($value) || trim($value) === '') {
            return null;
        }

        $timestamp = strtotime($value);

        return $timestamp === false ? null : $timestamp * 1000;
    }

    private function notFound(): JsonResponse
    {
        return response()->json([
            'ok' => false,
            'field' => 'user',
            'message' => 'User not found',
        ], 404);
    }
}
