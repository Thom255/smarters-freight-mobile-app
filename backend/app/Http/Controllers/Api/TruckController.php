<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\BookingService;
use App\Services\FreightPresenter;
use App\Services\SupabaseClient;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Truck management for truck owners (SRS §14).
 *
 *   GET   /api/trucks          → { ok, trucks: [...] }      owner's fleet
 *   POST  /api/trucks          → { ok, truck }              register a truck
 *   GET   /api/trucks/{id}     → { ok, truck }              owner only
 *   PATCH /api/trucks/{id}     → { ok, truck }              status / availability
 */
class TruckController extends Controller
{
    /** Statuses that keep a truck committed to a load. */
    private const COMMITTED_STATUSES = ['booked', 'in_transit'];

    public function __construct(
        private SupabaseClient $supabase,
        private BookingService $bookings,
    ) {
    }

    public function index(Request $request): JsonResponse
    {
        $userId = (string) $request->attributes->get('auth_user')['id'];

        $rows = $this->supabase->select('trucks', [
            'owner_id' => "eq.{$userId}",
            'order' => 'created_at.desc',
            'limit' => 200,
        ]);

        $rows = $this->bookings->withMatchedCargo($rows);

        return response()->json([
            'ok' => true,
            'trucks' => array_map(
                fn (array $row) => FreightPresenter::truck($row, $row['matched_cargo'] ?? null),
                $rows,
            ),
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'registrationNumber' => ['required', 'string', 'min:3', 'max:50'],
            'truckType' => ['required', 'string', 'min:2', 'max:100'],
            'capacityTons' => ['required', 'numeric', 'gt:0', 'max:1000'],
            'currentLocation' => ['required', 'string', 'min:2', 'max:150'],
            'availabilityDate' => ['required', 'date'],
        ], [
            'registrationNumber.required' => 'Enter the truck registration number',
            'truckType.required' => 'Enter the truck type',
            'capacityTons.required' => 'Enter the capacity in tons',
            'capacityTons.gt' => 'Capacity must be greater than zero',
            'currentLocation.required' => 'Enter the truck location',
            'availabilityDate.required' => 'Choose an availability date',
            'availabilityDate.date' => 'Enter a valid availability date',
        ], [
            'registrationNumber' => 'registration_number',
            'truckType' => 'truck_type',
            'capacityTons' => 'capacity_tons',
            'currentLocation' => 'current_location',
            'availabilityDate' => 'availability_date',
        ]);

        $userId = (string) $request->attributes->get('auth_user')['id'];

        $truck = $this->supabase->insert('trucks', [
            'owner_id' => $userId,
            'registration_number' => trim($data['registrationNumber']),
            'truck_type' => trim($data['truckType']),
            'capacity_tons' => (float) $data['capacityTons'],
            'current_location' => trim($data['currentLocation']),
            'availability_date' => $this->dateOnly($data['availabilityDate']),
            'status' => 'available',
        ]);

        return response()->json(['ok' => true, 'truck' => FreightPresenter::truck($truck)], 201);
    }

    public function show(Request $request, string $id): JsonResponse
    {
        $truck = $this->findOwned($request, $id);

        if ($truck === null) {
            return $this->notFound();
        }

        [$truck] = $this->bookings->withMatchedCargo([$truck]);

        return response()->json([
            'ok' => true,
            'truck' => FreightPresenter::truck($truck, $truck['matched_cargo'] ?? null),
        ]);
    }

    public function update(Request $request, string $id): JsonResponse
    {
        $truck = $this->findOwned($request, $id);

        if ($truck === null) {
            return $this->notFound();
        }

        $data = $request->validate([
            'status' => ['sometimes', 'string', 'in:available,booked,in_transit,maintenance,inactive'],
            'currentLocation' => ['sometimes', 'string', 'min:2', 'max:150'],
            'availabilityDate' => ['sometimes', 'date'],
        ]);

        $values = [];
        if (array_key_exists('status', $data)) {
            $values['status'] = $data['status'];
        }
        if (array_key_exists('currentLocation', $data)) {
            $values['current_location'] = trim($data['currentLocation']);
        }
        if (array_key_exists('availabilityDate', $data)) {
            $values['availability_date'] = $this->dateOnly($data['availabilityDate']);
        }

        if ($values === []) {
            return response()->json([
                'ok' => false,
                'field' => 'form',
                'message' => 'Nothing to update',
            ], 422);
        }

        $updated = $this->supabase->update('trucks', 'id', 'eq.'.$id, $values);
        $row = $updated[0] ?? array_merge($truck, $values);

        // Taking a truck off a load frees the load back to the market.
        if (
            isset($values['status'])
            && ! in_array($values['status'], self::COMMITTED_STATUSES, true)
            && ! empty($row['matched_cargo_id'])
        ) {
            $this->bookings->releaseForTruck($row);
            $row['matched_cargo_id'] = null;
            $row['matched_at'] = null;
        }

        [$row] = $this->bookings->withMatchedCargo([$row]);

        return response()->json([
            'ok' => true,
            'truck' => FreightPresenter::truck($row, $row['matched_cargo'] ?? null),
        ]);
    }

    /** @return array<string, mixed>|null */
    private function findOwned(Request $request, string $id): ?array
    {
        $userId = (string) $request->attributes->get('auth_user')['id'];

        return $this->supabase->selectOne('trucks', [
            'id' => "eq.{$id}",
            'owner_id' => "eq.{$userId}",
        ]);
    }

    private function notFound(): JsonResponse
    {
        return response()->json([
            'ok' => false,
            'field' => 'truck',
            'message' => 'Truck not found',
        ], 404);
    }

    private function dateOnly(string $value): string
    {
        return substr(trim($value), 0, 10);
    }
}
