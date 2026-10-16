<?php

namespace App\Services;

/**
 * Turns raw Supabase rows into the camelCase payloads the mobile app expects.
 * Kept in one place so trucks/cargo are shaped identically everywhere
 * (controllers, matching results, dashboard).
 */
class FreightPresenter
{
    /**
     * @param  array<string, mixed>  $row
     * @param  array<string, mixed>|null  $matchedCargo  optional counterpart summary
     * @return array<string, mixed>
     */
    public static function truck(array $row, ?array $matchedCargo = null): array
    {
        return [
            'id' => $row['id'],
            'registrationNumber' => $row['registration_number'] ?? '',
            'truckType' => $row['truck_type'] ?? '',
            'capacityTons' => isset($row['capacity_tons']) ? (float) $row['capacity_tons'] : 0.0,
            'currentLocation' => $row['current_location'] ?? '',
            'availabilityDate' => self::toMillis($row['availability_date'] ?? null),
            'status' => $row['status'] ?? 'available',
            'verificationStatus' => $row['verification_status'] ?? 'pending',
            'matchedCargoId' => $row['matched_cargo_id'] ?? null,
            'matchedAt' => self::toMillis($row['matched_at'] ?? null),
            'matchedCargo' => $matchedCargo === null ? null : self::counterpartCargo($matchedCargo),
            'createdAt' => self::toMillis($row['created_at'] ?? null),
        ];
    }

    /**
     * @param  array<string, mixed>  $row
     * @param  array<string, mixed>|null  $matchedTruck  optional counterpart summary
     * @return array<string, mixed>
     */
    public static function cargo(array $row, ?array $matchedTruck = null): array
    {
        return [
            'id' => $row['id'],
            'reference' => $row['reference'] ?? '',
            'cargoType' => $row['cargo_type'] ?? '',
            'description' => $row['description'] ?? null,
            'weightTons' => isset($row['weight_tons']) ? (float) $row['weight_tons'] : 0.0,
            'pickupLocation' => $row['pickup_location'] ?? '',
            'destination' => $row['destination_location'] ?? '',
            'pickupDate' => self::toMillis($row['pickup_date'] ?? null),
            'preferredTruckType' => $row['preferred_truck_type'] ?? null,
            'budget' => isset($row['budget']) ? (float) $row['budget'] : null,
            'specialRequirements' => $row['special_requirements'] ?? null,
            'status' => $row['status'] ?? 'posted',
            'matchedTruckId' => $row['matched_truck_id'] ?? null,
            'matchedAt' => self::toMillis($row['matched_at'] ?? null),
            'matchedTruck' => $matchedTruck === null ? null : self::counterpartTruck($matchedTruck),
            'createdAt' => self::toMillis($row['created_at'] ?? null),
        ];
    }

    /**
     * Compact counterpart shapes used by the "Booked with …" rows in the app.
     *
     * @param  array<string, mixed>  $row
     * @return array<string, mixed>
     */
    private static function counterpartTruck(array $row): array
    {
        return [
            'id' => $row['id'],
            'registrationNumber' => $row['registration_number'] ?? '',
            'truckType' => $row['truck_type'] ?? '',
            'currentLocation' => $row['current_location'] ?? '',
        ];
    }

    /** @param array<string, mixed> $row @return array<string, mixed> */
    private static function counterpartCargo(array $row): array
    {
        return [
            'id' => $row['id'],
            'reference' => $row['reference'] ?? '',
            'cargoType' => $row['cargo_type'] ?? '',
            'pickupLocation' => $row['pickup_location'] ?? '',
            'destination' => $row['destination_location'] ?? '',
        ];
    }

    /**
     * Shapes one matching-engine result (truck × cargo + score) for the app.
     *
     * @param  array<string, mixed>  $match
     * @return array<string, mixed>
     */
    public static function match(array $match): array
    {
        $truck = self::truck($match['truck']);
        $cargo = self::cargo($match['cargo']);
        $scores = $match['scores'];

        return [
            'id' => $truck['id'].':'.$cargo['id'],
            'score' => (int) round($match['total']),
            'category' => $match['category'],
            'scores' => [
                'route' => $scores['route'],
                'capacity' => $scores['capacity'],
                'date' => $scores['date'],
                'location' => $scores['location'],
                'availability' => $scores['availability'],
            ],
            'truck' => $truck,
            'cargo' => $cargo,
        ];
    }

    private static function toMillis(mixed $value): ?int
    {
        if (! is_string($value) || trim($value) === '') {
            return null;
        }

        $timestamp = strtotime($value);

        return $timestamp === false ? null : $timestamp * 1000;
    }
}
