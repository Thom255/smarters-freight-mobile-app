<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\CommissionCalculator;
use App\Services\CommissionService;
use App\Services\FreightPresenter;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Admin revenue & commission settlement (8% platform commission).
 *
 * Every route here sits behind `auth.role:admin`, so a cargo owner or truck
 * owner with a valid token gets 403 — and nothing on the customer-facing API
 * can read or write the ledger at all.
 *
 *   GET  /api/admin/revenue                    → totals + commission records
 *   POST /api/admin/commissions/{id}/settle    → mark paid WITH evidence
 *   POST /api/admin/commissions/{id}/refund    → reverse a settled record
 *
 * `paid` is never asserted without a payment reference: settlement is a
 * human-backed reconciliation entry, not a fabricated transaction. Until a
 * payment gateway is wired in, no money is ever reported as received on its
 * own.
 */
class AdminCommissionController extends Controller
{
    public function __construct(private CommissionService $commissions) {}

    public function revenue(): JsonResponse
    {
        $summary = $this->commissions->summary();

        return response()->json([
            'ok' => true,
            'commissionRate' => CommissionCalculator::rate(),
            'currency' => 'TZS',
            'totals' => $summary['totals'],
            'counts' => $summary['counts'],
            'commissions' => array_map(
                fn (array $row) => FreightPresenter::commission($row),
                $summary['records'],
            ),
        ]);
    }

    public function settle(Request $request, string $id): JsonResponse
    {
        if (! $this->looksLikeId($id)) {
            return $this->error(404, 'commission', 'This commission record no longer exists');
        }

        $data = $request->validate([
            'paymentReference' => ['required', 'string', 'min:4', 'max:120'],
        ], [
            'paymentReference.required' => 'Enter the payment reference that proves the settlement',
            'paymentReference.min' => 'Enter the payment reference that proves the settlement',
        ]);

        $result = $this->commissions->settle($id, trim($data['paymentReference']));

        if (($result['ok'] ?? false) !== true) {
            return $this->error($result['status'], $result['field'], $result['message']);
        }

        return response()->json([
            'ok' => true,
            'commission' => FreightPresenter::commission($result['commission']),
        ]);
    }

    public function refund(Request $request, string $id): JsonResponse
    {
        if (! $this->looksLikeId($id)) {
            return $this->error(404, 'commission', 'This commission record no longer exists');
        }

        $data = $request->validate([
            'reason' => ['required', 'string', 'min:4', 'max:500'],
        ], [
            'reason.required' => 'Enter the reason this commission is being reversed',
            'reason.min' => 'Enter the reason this commission is being reversed',
        ]);

        $result = $this->commissions->refund($id, trim($data['reason']));

        if (($result['ok'] ?? false) !== true) {
            return $this->error($result['status'], $result['field'], $result['message']);
        }

        return response()->json([
            'ok' => true,
            'commission' => FreightPresenter::commission($result['commission']),
        ]);
    }

    private function error(int $status, string $field, string $message): JsonResponse
    {
        return response()->json([
            'ok' => false,
            'field' => $field,
            'message' => $message,
        ], $status);
    }
}
