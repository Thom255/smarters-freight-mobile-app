<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\BookingService;
use App\Services\FreightPresenter;
use App\Services\SupabaseClient;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

/**
 * Cargo management for cargo owners (SRS §16–§17).
 *
 *   GET   /api/cargo          → { ok, cargo: [...] }    owner's loads
 *   POST  /api/cargo          → { ok, cargo }           post a load
 *   GET   /api/cargo/{id}     → { ok, cargo }           owner only
 *   PATCH /api/cargo/{id}     → { ok, cargo }           edit / change status
 */
class CargoController extends Controller
{
    /** Statuses that finish a load and therefore free any reserved truck. */
    private const TERMINAL_STATUSES = ['delivered', 'completed', 'cancelled'];

    public function __construct(
        private SupabaseClient $supabase,
        private BookingService $bookings,
    ) {}

    public function index(Request $request): JsonResponse
    {
        $userId = (string) $request->attributes->get('auth_user')['id'];

        $rows = $this->supabase->select('cargo', [
            'owner_id' => "eq.{$userId}",
            'order' => 'created_at.desc',
            'limit' => 200,
        ]);

        $rows = $this->bookings->withMatchedTrucks($rows);

        return response()->json([
            'ok' => true,
            'cargo' => array_map(
                fn (array $row) => FreightPresenter::cargo($row, $row['matched_truck'] ?? null),
                $rows,
            ),
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $this->validateCargo($request);
        $userId = (string) $request->attributes->get('auth_user')['id'];

        $cargo = $this->supabase->insert('cargo', [
            'owner_id' => $userId,
            'reference' => $this->newReference(),
            'cargo_type' => trim($data['cargoType']),
            'description' => $this->nullable($data['description'] ?? null),
            'weight_tons' => (float) $data['weightTons'],
            'pickup_location' => trim($data['pickupLocation']),
            'destination_location' => trim($data['destination']),
            'pickup_date' => $this->dateOnly($data['pickupDate']),
            'preferred_truck_type' => $this->nullable($data['preferredTruckType'] ?? null),
            'budget' => isset($data['budget']) && $data['budget'] !== null ? (float) $data['budget'] : null,
            'currency' => $this->currency($data['currency'] ?? null),
            'special_requirements' => $this->nullable($data['specialRequirements'] ?? null),
            'status' => 'posted',
        ]);

        return response()->json(['ok' => true, 'cargo' => FreightPresenter::cargo($cargo)], 201);
    }

    public function show(Request $request, string $id): JsonResponse
    {
        $cargo = $this->findOwned($request, $id);

        if ($cargo === null) {
            return $this->notFound();
        }

        [$cargo] = $this->bookings->withMatchedTrucks([$cargo]);

        return response()->json([
            'ok' => true,
            'cargo' => FreightPresenter::cargo($cargo, $cargo['matched_truck'] ?? null),
        ]);
    }

    public function update(Request $request, string $id): JsonResponse
    {
        $cargo = $this->findOwned($request, $id);

        if ($cargo === null) {
            return $this->notFound();
        }

        $data = $request->validate([
            'status' => ['sometimes', 'string', 'in:posted,matched,booked,in_transit,delivered,completed,cancelled'],
            'pickupDate' => ['sometimes', 'date'],
            'budget' => ['sometimes', 'nullable', 'numeric', 'min:0'],
            'currency' => ['sometimes', 'string', 'size:3'],
            'description' => ['sometimes', 'nullable', 'string', 'max:2000'],
            'specialRequirements' => ['sometimes', 'nullable', 'string', 'max:2000'],
        ]);

        $values = [];
        if (array_key_exists('status', $data)) {
            $values['status'] = $data['status'];
        }
        if (array_key_exists('pickupDate', $data)) {
            $values['pickup_date'] = $this->dateOnly($data['pickupDate']);
        }
        if (array_key_exists('budget', $data)) {
            $values['budget'] = $data['budget'] === null ? null : (float) $data['budget'];
        }
        if (array_key_exists('currency', $data)) {
            $values['currency'] = $this->currency($data['currency']);
        }
        if (array_key_exists('description', $data)) {
            $values['description'] = $this->nullable($data['description']);
        }
        if (array_key_exists('specialRequirements', $data)) {
            $values['special_requirements'] = $this->nullable($data['specialRequirements']);
        }

        if ($values === []) {
            return response()->json([
                'ok' => false,
                'field' => 'form',
                'message' => 'Nothing to update',
            ], 422);
        }

        $updated = $this->supabase->update('cargo', 'id', 'eq.'.$id, $values);
        $row = $updated[0] ?? array_merge($cargo, $values);

        // Finishing a load frees whichever truck was reserved for it.
        if (isset($values['status']) && in_array($values['status'], self::TERMINAL_STATUSES, true)) {
            $this->bookings->releaseForCargo($row);
            $row['matched_truck_id'] = null;
            $row['matched_at'] = null;
        }

        [$row] = $this->bookings->withMatchedTrucks([$row]);

        return response()->json([
            'ok' => true,
            'cargo' => FreightPresenter::cargo($row, $row['matched_truck'] ?? null),
        ]);
    }

    /** @return array<string, mixed> */
    private function validateCargo(Request $request): array
    {
        return $request->validate([
            'cargoType' => ['required', 'string', 'min:2', 'max:100'],
            'description' => ['nullable', 'string', 'max:2000'],
            'weightTons' => ['required', 'numeric', 'gt:0', 'max:1000'],
            'pickupLocation' => ['required', 'string', 'min:2', 'max:150'],
            'destination' => ['required', 'string', 'min:2', 'max:150'],
            'pickupDate' => ['required', 'date'],
            'preferredTruckType' => ['nullable', 'string', 'max:100'],
            'budget' => ['nullable', 'numeric', 'min:0'],
            'currency' => ['nullable', 'string', 'size:3'],
            'specialRequirements' => ['nullable', 'string', 'max:2000'],
        ], [
            'cargoType.required' => 'Enter the cargo type',
            'weightTons.required' => 'Enter the weight in tons',
            'weightTons.gt' => 'Weight must be greater than zero',
            'pickupLocation.required' => 'Enter the pickup location',
            'destination.required' => 'Enter the destination',
            'pickupDate.required' => 'Choose a pickup date',
            'pickupDate.date' => 'Enter a valid pickup date',
        ], [
            'cargoType' => 'cargo_type',
            'weightTons' => 'weight_tons',
            'pickupLocation' => 'pickup_location',
            'destination' => 'destination',
            'pickupDate' => 'pickup_date',
        ]);
    }

    /** @return array<string, mixed>|null */
    private function findOwned(Request $request, string $id): ?array
    {
        if (! $this->looksLikeId($id)) {
            return null;
        }

        $userId = (string) $request->attributes->get('auth_user')['id'];

        return $this->supabase->selectOne('cargo', [
            'id' => "eq.{$id}",
            'owner_id' => "eq.{$userId}",
        ]);
    }

    private function notFound(): JsonResponse
    {
        return response()->json([
            'ok' => false,
            'field' => 'cargo',
            'message' => 'Cargo not found',
        ], 404);
    }

    private function newReference(): string
    {
        return 'CG-'.strtoupper(Str::random(6));
    }

    private function dateOnly(string $value): string
    {
        return substr(trim($value), 0, 10);
    }

    private function nullable(?string $value): ?string
    {
        $value = trim((string) $value);

        return $value === '' ? null : $value;
    }

    private function currency(?string $value): string
    {
        $value = strtoupper(trim((string) $value));

        return $value === '' ? 'TZS' : $value;
    }
}
