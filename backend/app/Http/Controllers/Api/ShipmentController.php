<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\SupabaseClient;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

/**
 * Shipments endpoints backing the dashboard, the shipments list and the
 * shipment detail screen:
 *
 *   GET   /api/shipments         → { ok, shipments: [...] }  newest first
 *   POST  /api/shipments         → { ok, shipment }          creates + books event
 *   GET   /api/shipments/{id}    → { ok, shipment }          owner only, incl. events
 *   PATCH /api/shipments/{id}    → { ok, shipment, event }   owner only:
 *                                  • status transition, or
 *                                  • edit details while still active
 *
 * Lifecycle: booked → in_transit → delivered, with cancelled reachable from
 * either active state. Every state change is written to shipment_events with
 * the timestamp and the user who performed it, which is what the app's
 * progress timeline renders. Detail edits are recorded too, so the history is
 * a complete account of what happened to the load.
 *
 * Request bodies use camelCase (like the rest of the API); columns are
 * snake_case.
 */
class ShipmentController extends Controller
{
    /** @var array<string, list<string>> allowed status transitions */
    private const TRANSITIONS = [
        'booked' => ['in_transit', 'cancelled'],
        'in_transit' => ['delivered', 'cancelled'],
        'delivered' => [],
        'cancelled' => [],
    ];

    /**
     * Statuses in which the shipment's details can still be edited. Terminal
     * states (delivered / cancelled) are frozen.
     *
     * @var list<string>
     */
    private const EDITABLE_STATUSES = ['booked', 'in_transit'];

    /**
     * shipment_events.type is constrained by a CHECK in Supabase — 'cancelled'
     * is not one of the allowed values, so cancellations log as 'update'.
     *
     * @var array<string, array{type: string, title: string, body: string}>
     */
    private const EVENT_BY_STATUS = [
        'in_transit' => [
            'type' => 'in_transit',
            'title' => 'In transit',
            'body' => 'On the road to the destination.',
        ],
        'delivered' => [
            'type' => 'delivered',
            'title' => 'Delivered',
            'body' => 'Handed over at the destination.',
        ],
        'cancelled' => [
            'type' => 'update',
            'title' => 'Shipment cancelled',
            'body' => 'This shipment was called off.',
        ],
    ];

    /** camelCase request field → snake_case column. */
    private const FIELD_MAP = [
        'cargoType' => 'cargo_type',
        'cargoDescription' => 'cargo_description',
        'weightTons' => 'weight_tons',
        'dimensions' => 'dimensions',
        'pickupDate' => 'pickup_date',
        'deliveryDeadline' => 'delivery_deadline',
        'bookingReference' => 'booking_reference',
        'assignedTruckId' => 'assigned_truck_id',
    ];

    public function __construct(private SupabaseClient $supabase) {}

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
        $data = $request->validate($this->createRules(), $this->messages(), $this->attributes());

        if ($this->deadlineBeforePickup($data['pickupDate'] ?? null, $data['deliveryDeadline'] ?? null)) {
            return $this->validationError(
                'deliveryDeadline',
                'The delivery deadline must be on or after the pickup date.',
            );
        }

        if (isset($data['assignedTruckId']) && ! $this->truckExists((string) $data['assignedTruckId'])) {
            return $this->validationError('assignedTruckId', 'That truck could not be found.');
        }

        $userId = (string) $request->attributes->get('auth_user')['id'];

        $shipment = $this->supabase->insert('shipments', array_merge([
            'user_id' => $userId,
            'reference' => $this->newReference(),
            'origin' => trim($data['origin']),
            'destination' => trim($data['destination']),
            'status' => 'booked',
        ], $this->detailValues($data)));

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

        $presented = $this->withAssignedTruck($this->present($shipment));
        $presented['events'] = $this->events((string) $shipment['id']);

        return response()->json([
            'ok' => true,
            'shipment' => $presented,
        ], 201);
    }

    public function show(Request $request, string $id): JsonResponse
    {
        if (! $this->looksLikeId($id)) {
            return $this->notFound();
        }

        $userId = (string) $request->attributes->get('auth_user')['id'];

        $row = $this->supabase->selectOne('shipments', [
            'id' => "eq.{$id}",
            'user_id' => "eq.{$userId}",
        ]);

        if ($row === null) {
            return $this->notFound();
        }

        $shipment = $this->withAssignedTruck($this->present($row));
        $shipment['events'] = $this->events($id);

        return response()->json(['ok' => true, 'shipment' => $shipment]);
    }

    /**
     * Either moves a shipment along its lifecycle, or edits its details while
     * it is still active. Both paths record who did it in the timeline.
     */
    public function update(Request $request, string $id): JsonResponse
    {
        $data = $request->validate($this->updateRules(), $this->messages(), $this->attributes());

        if (! $this->looksLikeId($id)) {
            return $this->notFound();
        }

        $user = $request->attributes->get('auth_user');
        $userId = (string) $user['id'];

        $row = $this->supabase->selectOne('shipments', [
            'id' => "eq.{$id}",
            'user_id' => "eq.{$userId}",
        ]);

        if ($row === null) {
            return $this->notFound();
        }

        return array_key_exists('status', $data)
            ? $this->transition($row, (string) $data['status'], $data, $userId, $user['name'] ?? null)
            : $this->edit($row, $data, $userId, $user['name'] ?? null);
    }

    /**
     * @param  array<string, mixed>  $row
     * @param  array<string, mixed>  $data
     */
    private function transition(array $row, string $next, array $data, string $userId, mixed $actorName): JsonResponse
    {
        $current = (string) ($row['status'] ?? 'booked');

        if (! in_array($next, self::TRANSITIONS[$current] ?? [], true)) {
            return $this->validationError('status', sprintf(
                'A %s shipment cannot move to %s.',
                str_replace('_', ' ', $current),
                str_replace('_', ' ', $next),
            ));
        }

        $values = ['status' => $next];
        if (array_key_exists('notes', $data)) {
            $values['notes'] = $this->nullIfBlank($data['notes']);
        }

        $updated = $this->supabase->update('shipments', 'id', "eq.{$row['id']}", $values);
        $row = $updated[0] ?? array_merge($row, $values);

        $event = $this->recordEvent($row, $next, $userId, $actorName);

        return $this->updated($row, $event);
    }

    /**
     * Applies detail edits while the shipment is still active, and logs an
     * entry when anything actually changed.
     *
     * @param  array<string, mixed>  $row
     * @param  array<string, mixed>  $data
     */
    private function edit(array $row, array $data, string $userId, mixed $actorName): JsonResponse
    {
        $values = $this->detailValues($data);

        if ($values === []) {
            return $this->validationError('form', 'Change at least one field to save.');
        }

        $current = (string) ($row['status'] ?? 'booked');
        if (! in_array($current, self::EDITABLE_STATUSES, true)) {
            return $this->validationError(
                'status',
                'This shipment has already been '.str_replace('_', ' ', $current).' and can no longer be edited.',
            );
        }

        $pickup = $values['pickup_date'] ?? ($row['pickup_date'] ?? null);
        $deadline = $values['delivery_deadline'] ?? ($row['delivery_deadline'] ?? null);
        if ($this->deadlineBeforePickup($pickup, $deadline)) {
            return $this->validationError(
                'deliveryDeadline',
                'The delivery deadline must be on or after the pickup date.',
            );
        }

        if (! empty($values['assigned_truck_id']) && ! $this->truckExists((string) $values['assigned_truck_id'])) {
            return $this->validationError('assignedTruckId', 'That truck could not be found.');
        }

        $changed = $this->changedValues($values, $row);

        $updated = $this->supabase->update('shipments', 'id', "eq.{$row['id']}", $values);
        $row = $updated[0] ?? array_merge($row, $values);

        $event = $changed === [] ? null : $this->recordEditEvent($row, $userId, $actorName);

        return $this->updated($row, $event);
    }

    /** @param array<string, mixed> $row @param array<string, mixed>|null $event */
    private function updated(array $row, ?array $event): JsonResponse
    {
        $shipment = $this->withAssignedTruck($this->present($row));
        $shipment['events'] = $this->events((string) $row['id']);

        $payload = ['ok' => true, 'shipment' => $shipment];
        if ($event !== null) {
            $payload['event'] = $event;
        }

        return response()->json($payload);
    }

    /**
     * Writes the timeline entry for a status change. Best-effort: the status
     * itself is already saved, so a failed history write must not fail the
     * request.
     *
     * @param  array<string, mixed>  $row
     * @return array<string, mixed>|null
     */
    private function recordEvent(array $row, string $status, string $userId, mixed $actorName): ?array
    {
        $spec = self::EVENT_BY_STATUS[$status] ?? null;
        if ($spec === null) {
            return null;
        }

        $body = $spec['body'];
        if ($status === 'in_transit') {
            $body = sprintf('%s → %s', $row['origin'] ?? 'Origin', $row['destination'] ?? 'destination');
        } elseif ($status === 'cancelled') {
            $body = isset($row['notes']) && trim((string) $row['notes']) !== ''
                ? trim((string) $row['notes'])
                : $body;
        }

        return $this->writeEvent($row, $userId, $spec['type'], $spec['title'], $body, $actorName);
    }

    /**
     * Timeline entry for a details edit (best-effort, like recordEvent).
     *
     * @param  array<string, mixed>  $row
     * @return array<string, mixed>|null
     */
    private function recordEditEvent(array $row, string $userId, mixed $actorName): ?array
    {
        return $this->writeEvent(
            $row,
            $userId,
            'update',
            'Shipment details updated',
            'The cargo and route details were changed.',
            $actorName,
        );
    }

    /**
     * @param  array<string, mixed>  $row
     * @return array<string, mixed>|null
     */
    private function writeEvent(array $row, string $userId, string $type, string $title, ?string $body, mixed $actorName): ?array
    {
        try {
            $inserted = $this->supabase->insert('shipment_events', [
                'shipment_id' => $row['id'],
                'user_id' => $userId,
                'type' => $type,
                'title' => $title,
                'body' => $body,
            ]);
        } catch (\Throwable) {
            return null;
        }

        return $inserted === [] ? null : $this->presentEvent($inserted, $actorName);
    }

    /**
     * Full timeline for a shipment, oldest first, with the actor's display
     * name resolved in one extra query (no N+1).
     *
     * @return array<int, array<string, mixed>>
     */
    private function events(string $id): array
    {
        try {
            // The actor rides along on the same query (users(name) embed) so
            // the detail screen does not pay a second round trip for names.
            $rows = $this->supabase->select('shipment_events', [
                'select' => 'id,type,title,body,created_at,user_id,users(name)',
                'shipment_id' => "eq.{$id}",
                'order' => 'created_at.asc',
                'limit' => 100,
            ]);
        } catch (\Throwable) {
            return [];
        }

        $embedded = array_filter(array_map(
            fn (array $event) => is_array($event['users'] ?? null) ? $event['users'] : null,
            $rows,
        ));

        // Fallback for setups where the embed is unavailable.
        $names = $embedded === [] ? $this->actorNames($rows) : [];

        return array_map(
            fn (array $event) => $this->presentEvent(
                $event,
                $names[(string) ($event['user_id'] ?? '')] ?? (is_array($event['users'] ?? null) ? trim((string) ($event['users']['name'] ?? '')) : null),
            ),
            $rows,
        );
    }

    /** @param array<int, array<string, mixed>> $events @return array<string, string> */
    private function actorNames(array $events): array
    {
        $ids = [];
        foreach ($events as $event) {
            $userId = $event['user_id'] ?? null;
            if (is_string($userId) && $userId !== '') {
                $ids[$userId] = $userId;
            }
        }

        if ($ids === []) {
            return [];
        }

        try {
            $users = $this->supabase->select('users', [
                'select' => 'id,name',
                'id' => 'in.('.implode(',', $ids).')',
                'limit' => 100,
            ]);
        } catch (\Throwable) {
            return [];
        }

        $names = [];
        foreach ($users as $user) {
            $names[(string) $user['id']] = trim((string) ($user['name'] ?? ''));
        }

        return $names;
    }

    /** @param array<string, mixed> $event @return array<string, mixed> */
    private function presentEvent(array $event, ?string $actorName): array
    {
        return [
            'id' => $event['id'],
            'type' => $event['type'] ?? 'update',
            'title' => $event['title'] ?? 'Shipment update',
            'body' => $event['body'] ?? null,
            'createdAt' => isset($event['created_at'])
                ? (int) strtotime((string) $event['created_at']) * 1000
                : null,
            'actor' => $actorName !== null && $actorName !== '' ? $actorName : null,
        ];
    }

    private function newReference(): string
    {
        // e.g. SF-7K2QX9 — short, human-readable, unique enough with the DB
        // unique index as the final guard.
        return 'SF-'.strtoupper(Str::random(6));
    }

    /**
     * Maps the request's camelCase detail fields to their shipment columns,
     * normalising blanks to NULL and casting typed fields. Only keys present in
     * the request are returned, so PATCH can distinguish "not sent" from
     * "cleared".
     *
     * @param  array<string, mixed>  $data
     * @return array<string, mixed>
     */
    private function detailValues(array $data): array
    {
        $values = [];

        foreach (['origin', 'destination'] as $field) {
            if (array_key_exists($field, $data) && $data[$field] !== null) {
                $values[$field] = trim((string) $data[$field]);
            }
        }

        if (array_key_exists('notes', $data)) {
            $values['notes'] = $this->nullIfBlank($data['notes']);
        }

        foreach (['cargoType', 'cargoDescription', 'dimensions', 'bookingReference'] as $field) {
            if (array_key_exists($field, $data)) {
                $values[self::FIELD_MAP[$field]] = $this->nullIfBlank($data[$field]);
            }
        }

        if (array_key_exists('weightTons', $data)) {
            $values['weight_tons'] = $this->nullIfBlank($data['weightTons']) === null
                ? null
                : (float) $data['weightTons'];
        }

        foreach (['pickupDate', 'deliveryDeadline'] as $field) {
            if (array_key_exists($field, $data)) {
                $values[self::FIELD_MAP[$field]] = $this->toDate($data[$field]);
            }
        }

        if (array_key_exists('assignedTruckId', $data)) {
            $values['assigned_truck_id'] = $this->nullIfBlank($data['assignedTruckId']);
        }

        return $values;
    }

    /**
     * The subset of $values that differs from the stored row, so we only log
     * an edit event when something really changed.
     *
     * @param  array<string, mixed>  $values
     * @param  array<string, mixed>  $row
     * @return array<string, mixed>
     */
    private function changedValues(array $values, array $row): array
    {
        $changed = [];
        foreach ($values as $key => $value) {
            if ($this->normalize($value) !== $this->normalize($row[$key] ?? null)) {
                $changed[$key] = $value;
            }
        }

        return $changed;
    }

    private function normalize(mixed $value): ?string
    {
        if ($value === null) {
            return null;
        }

        if (is_string($value)) {
            $trimmed = trim($value);
            if ($trimmed === '') {
                return null;
            }

            // Compare weights/dates numerically where they look numeric.
            return is_numeric($trimmed) ? (string) (float) $trimmed : $trimmed;
        }

        if (is_float($value) || is_int($value)) {
            return (string) (float) $value;
        }

        return (string) $value;
    }

    /** @param array<string, mixed> $shipment @return array<string, mixed> */
    private function withAssignedTruck(array $shipment): array
    {
        $truckId = $shipment['assignedTruckId'] ?? null;
        if (! is_string($truckId) || $truckId === '') {
            $shipment['assignedTruck'] = null;

            return $shipment;
        }

        try {
            $truck = $this->supabase->selectOne('trucks', ['id' => "eq.{$truckId}"]);
        } catch (\Throwable) {
            $truck = null;
        }

        $shipment['assignedTruck'] = $truck === null ? null : [
            'id' => $truck['id'],
            'registrationNumber' => $truck['registration_number'] ?? '',
            'truckType' => $truck['truck_type'] ?? '',
            'currentLocation' => $truck['current_location'] ?? '',
        ];

        return $shipment;
    }

    private function truckExists(string $id): bool
    {
        try {
            return $this->supabase->selectOne('trucks', ['id' => "eq.{$id}"]) !== null;
        } catch (\Throwable) {
            return false;
        }
    }

    private function deadlineBeforePickup(mixed $pickup, mixed $deadline): bool
    {
        $from = $this->toDate($pickup);
        $to = $this->toDate($deadline);

        if ($from === null || $to === null) {
            return false;
        }

        return strtotime($to) < strtotime($from);
    }

    private function toDate(mixed $value): ?string
    {
        $value = $this->nullIfBlank($value);
        if ($value === null) {
            return null;
        }

        $timestamp = strtotime($value);

        return $timestamp === false ? null : date('Y-m-d', $timestamp);
    }

    private function toMillis(mixed $value): ?int
    {
        $value = $this->nullIfBlank($value);
        if ($value === null) {
            return null;
        }

        $timestamp = strtotime($value);

        return $timestamp === false ? null : $timestamp * 1000;
    }

    private function nullIfBlank(mixed $value): ?string
    {
        if ($value === null) {
            return null;
        }

        $string = trim((string) $value);

        return $string === '' ? null : $string;
    }

    private function notFound(): JsonResponse
    {
        return response()->json([
            'ok' => false,
            'field' => 'shipment',
            'message' => 'Shipment not found',
        ], 404);
    }

    private function validationError(string $field, string $message): JsonResponse
    {
        return response()->json([
            'ok' => false,
            'field' => $field,
            'message' => $message,
        ], 422);
    }

    /** @return array<string, array<int, string>> */
    private function createRules(): array
    {
        return [
            'origin' => ['required', 'string', 'min:2', 'max:160'],
            'destination' => ['required', 'string', 'min:2', 'max:160'],
            'notes' => ['nullable', 'string', 'max:1000'],
            'cargoType' => ['nullable', 'string', 'max:80'],
            'cargoDescription' => ['nullable', 'string', 'max:1000'],
            'weightTons' => ['nullable', 'numeric', 'gt:0', 'max:1000'],
            'dimensions' => ['nullable', 'string', 'max:80'],
            'pickupDate' => ['nullable', 'date'],
            'deliveryDeadline' => ['nullable', 'date'],
            'bookingReference' => ['nullable', 'string', 'max:80'],
            'assignedTruckId' => ['nullable', 'uuid'],
        ];
    }

    /** @return array<string, array<int, string>> */
    private function updateRules(): array
    {
        return [
            'status' => ['sometimes', 'string', 'in:in_transit,delivered,cancelled'],
            'origin' => ['sometimes', 'string', 'min:2', 'max:160'],
            'destination' => ['sometimes', 'string', 'min:2', 'max:160'],
            'notes' => ['sometimes', 'nullable', 'string', 'max:1000'],
            'cargoType' => ['sometimes', 'nullable', 'string', 'max:80'],
            'cargoDescription' => ['sometimes', 'nullable', 'string', 'max:1000'],
            'weightTons' => ['sometimes', 'nullable', 'numeric', 'gt:0', 'max:1000'],
            'dimensions' => ['sometimes', 'nullable', 'string', 'max:80'],
            'pickupDate' => ['sometimes', 'nullable', 'date'],
            'deliveryDeadline' => ['sometimes', 'nullable', 'date'],
            'bookingReference' => ['sometimes', 'nullable', 'string', 'max:80'],
            'assignedTruckId' => ['sometimes', 'nullable', 'uuid'],
        ];
    }

    /** @return array<string, string> */
    private function messages(): array
    {
        return [
            'status.in' => 'That is not a valid shipment status',
            'weightTons.numeric' => 'Enter the weight in tons',
            'weightTons.gt' => 'Enter a weight greater than zero',
            'pickupDate.date' => 'Enter a valid pickup date',
            'deliveryDeadline.date' => 'Enter a valid delivery deadline',
            'assignedTruckId.uuid' => 'Choose a valid truck',
        ];
    }

    /** @return array<string, string> */
    private function attributes(): array
    {
        return [
            'status' => 'status',
            'notes' => 'notes',
            'cargoType' => 'cargo_type',
            'cargoDescription' => 'cargo_description',
            'weightTons' => 'weight_tons',
            'dimensions' => 'dimensions',
            'pickupDate' => 'pickup_date',
            'deliveryDeadline' => 'delivery_deadline',
            'bookingReference' => 'booking_reference',
            'assignedTruckId' => 'assigned_truck_id',
        ];
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
            'cargoType' => $row['cargo_type'] ?? null,
            'cargoDescription' => $row['cargo_description'] ?? null,
            'weightTons' => isset($row['weight_tons']) && $row['weight_tons'] !== null
                ? (float) $row['weight_tons']
                : null,
            'dimensions' => $row['dimensions'] ?? null,
            'pickupDate' => $this->toMillis($row['pickup_date'] ?? null),
            'deliveryDeadline' => $this->toMillis($row['delivery_deadline'] ?? null),
            'bookingReference' => $row['booking_reference'] ?? null,
            'assignedTruckId' => $row['assigned_truck_id'] ?? null,
            'createdAt' => isset($row['created_at'])
                ? (int) strtotime($row['created_at']) * 1000
                : null,
            'updatedAt' => isset($row['updated_at'])
                ? (int) strtotime($row['updated_at']) * 1000
                : null,
        ];
    }
}
