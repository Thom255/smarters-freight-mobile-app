<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\BookingService;
use App\Services\CommissionService;
use App\Services\FreightPresenter;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Booking requests (SRS §22).
 *
 *   GET   /api/bookings              → every booking the caller is part of
 *   POST  /api/bookings              → request a truck↔cargo booking
 *   POST  /api/bookings/{id}/accept  → counterparty accepts (atomic)
 *   POST  /api/bookings/{id}/reject  → counterparty rejects
 *   POST  /api/bookings/{id}/cancel  → either party cancels (atomic)
 *
 * Accept/cancel run as Postgres functions so the load, the truck and the
 * competing requests all change in one transaction. An ACCEPT also records
 * the platform's 8% commission on the agreed price (the qualifying event),
 * and a CANCEL takes any unsettled commission back out of revenue.
 */
class BookingController extends Controller
{
    public function __construct(
        private BookingService $bookings,
        private CommissionService $commissions,
    ) {}

    public function index(Request $request): JsonResponse
    {
        $userId = (string) $request->attributes->get('auth_user')['id'];

        return response()->json([
            'ok' => true,
            'bookings' => array_map(
                fn (array $row) => FreightPresenter::booking($row),
                $this->bookings->forUser($userId),
            ),
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'truckId' => ['required', 'string', 'max:64'],
            'cargoId' => ['required', 'string', 'max:64'],
            'price' => ['nullable', 'numeric', 'gt:0', 'max:1000000000'],
            'message' => ['nullable', 'string', 'max:1000'],
        ], [
            'truckId.required' => 'Missing the truck to book',
            'cargoId.required' => 'Missing the load to book',
        ], [
            'truckId' => 'truck',
            'cargoId' => 'cargo',
        ]);

        $userId = (string) $request->attributes->get('auth_user')['id'];

        if (! $this->looksLikeId($data['truckId']) || ! $this->looksLikeId($data['cargoId'])) {
            return $this->error(404, 'match', 'This match is no longer available');
        }

        $result = $this->bookings->request(
            $userId,
            $data['truckId'],
            $data['cargoId'],
            isset($data['price']) ? (float) $data['price'] : null,
            $this->nullable($data['message'] ?? null),
        );

        if (($result['ok'] ?? false) !== true) {
            return $this->error($result['status'], $result['field'], $result['message']);
        }

        $booking = $result['booking'] + [
            'cargo' => $result['cargo'],
            'truck' => $result['truck'],
            'direction' => 'outgoing',
        ];

        return response()->json([
            'ok' => true,
            'booking' => FreightPresenter::booking($booking),
            'truck' => FreightPresenter::truck($result['truck']),
            'cargo' => FreightPresenter::cargo($result['cargo']),
        ], 201);
    }

    public function accept(Request $request, string $id): JsonResponse
    {
        if (! $this->looksLikeId($id)) {
            return $this->error(404, 'booking', 'This booking request no longer exists');
        }

        $userId = (string) $request->attributes->get('auth_user')['id'];
        $result = $this->bookings->accept($userId, $id);

        if (($result['ok'] ?? false) !== true) {
            return $this->error($result['status'], $result['field'], $result['message']);
        }

        $commission = $this->commissions->recordForBooking($result['booking'], $result['cargo']);

        return response()->json([
            'ok' => true,
            'booking' => $this->present($result, $userId),
            'truck' => FreightPresenter::truck($result['truck']),
            'cargo' => FreightPresenter::cargo($result['cargo']),
            'commission' => $commission === null ? null : FreightPresenter::commission($commission),
        ]);
    }

    public function reject(Request $request, string $id): JsonResponse
    {
        if (! $this->looksLikeId($id)) {
            return $this->error(404, 'booking', 'This booking request no longer exists');
        }

        $userId = (string) $request->attributes->get('auth_user')['id'];
        $result = $this->bookings->reject($userId, $id);

        if (($result['ok'] ?? false) !== true) {
            return $this->error($result['status'], $result['field'], $result['message']);
        }

        return response()->json([
            'ok' => true,
            'booking' => $this->present($result, $userId),
        ]);
    }

    public function cancel(Request $request, string $id): JsonResponse
    {
        if (! $this->looksLikeId($id)) {
            return $this->error(404, 'booking', 'This booking no longer exists');
        }

        $userId = (string) $request->attributes->get('auth_user')['id'];
        $result = $this->bookings->cancel($userId, $id);

        if (($result['ok'] ?? false) !== true) {
            return $this->error($result['status'], $result['field'], $result['message']);
        }

        // A cancelled booking no longer earns anything: any commission that
        // was not yet settled leaves the revenue totals (settled rows stay —
        // only an explicit admin refund takes collected money back out).
        $this->commissions->cancelForBooking($id);

        return response()->json([
            'ok' => true,
            'booking' => $this->present($result, $userId),
            'truck' => FreightPresenter::truck($result['truck']),
            'cargo' => FreightPresenter::cargo($result['cargo']),
        ]);
    }

    /**
     * @param  array<string, mixed>  $result
     * @return array<string, mixed>
     */
    private function present(array $result, string $userId): array
    {
        $row = $result['booking'];
        $row['direction'] = ((string) ($row['requester_id'] ?? '')) === $userId ? 'outgoing' : 'incoming';
        if (isset($result['cargo'])) {
            $row['cargo'] = $result['cargo'];
        }
        if (isset($result['truck'])) {
            $row['truck'] = $result['truck'];
        }

        return FreightPresenter::booking($row);
    }

    private function error(int $status, string $field, string $message): JsonResponse
    {
        return response()->json([
            'ok' => false,
            'field' => $field,
            'message' => $message,
        ], $status);
    }

    private function nullable(?string $value): ?string
    {
        $value = trim((string) $value);

        return $value === '' ? null : $value;
    }
}
