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
            'driverName' => $row['driver_name'] ?? null,
            'driverPhone' => $row['driver_phone'] ?? null,
            'ratePerTon' => isset($row['rate_per_ton']) ? (float) $row['rate_per_ton'] : null,
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
            'currency' => $row['currency'] ?? 'TZS',
            'specialRequirements' => $row['special_requirements'] ?? null,
            'status' => $row['status'] ?? 'posted',
            'matchedTruckId' => $row['matched_truck_id'] ?? null,
            'matchedAt' => self::toMillis($row['matched_at'] ?? null),
            'matchedTruck' => $matchedTruck === null ? null : self::counterpartTruck($matchedTruck),
            'createdAt' => self::toMillis($row['created_at'] ?? null),
        ];
    }

    /**
     * Shapes one commission ledger row (supabase_commissions.sql) for the
     * admin revenue API, together with the load and booking it belongs to.
     *
     * @param  array<string, mixed>  $row
     * @return array<string, mixed>
     */
    public static function commission(array $row): array
    {
        $cargo = $row['cargo'] ?? null;
        $booking = $row['booking'] ?? null;

        return [
            'id' => $row['id'] ?? null,
            'cargoId' => $row['cargo_id'] ?? null,
            'bookingId' => $row['booking_id'] ?? null,
            'cargoPrice' => isset($row['cargo_price']) ? (float) $row['cargo_price'] : null,
            'commissionRate' => isset($row['commission_rate']) ? (float) $row['commission_rate'] : null,
            'commissionAmount' => isset($row['commission_amount']) ? (float) $row['commission_amount'] : null,
            'providerNetAmount' => isset($row['provider_net_amount']) ? (float) $row['provider_net_amount'] : null,
            'currency' => $row['currency'] ?? 'TZS',
            'status' => $row['status'] ?? 'pending',
            'paymentReference' => $row['payment_reference'] ?? null,
            'refundReason' => $row['refund_reason'] ?? null,
            'earnedAt' => self::toMillis($row['earned_at'] ?? null),
            'paidAt' => self::toMillis($row['paid_at'] ?? null),
            'cancelledAt' => self::toMillis($row['cancelled_at'] ?? null),
            'refundedAt' => self::toMillis($row['refunded_at'] ?? null),
            'createdAt' => self::toMillis($row['created_at'] ?? null),
            'cargo' => is_array($cargo) ? self::commissionCargo($cargo) : null,
            'booking' => is_array($booking) ? self::commissionBooking($booking) : null,
        ];
    }

    /** Traceability: which load an amount belongs to.
     *
     * @param  array<string, mixed>  $row
     * @return array<string, mixed>
     */
    private static function commissionCargo(array $row): array
    {
        return [
            'id' => $row['id'],
            'reference' => $row['reference'] ?? '',
            'cargoType' => $row['cargo_type'] ?? '',
            'status' => $row['status'] ?? 'posted',
            'pickupLocation' => $row['pickup_location'] ?? '',
            'destination' => $row['destination_location'] ?? '',
        ];
    }

    /** Traceability: which booking the agreed price was preserved on.
     *
     * @param  array<string, mixed>  $row
     * @return array<string, mixed>
     */
    private static function commissionBooking(array $row): array
    {
        return [
            'id' => $row['id'],
            'status' => $row['status'] ?? 'pending',
            'price' => isset($row['price']) && $row['price'] !== null ? (float) $row['price'] : null,
            'currency' => $row['currency'] ?? 'TZS',
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
            'estimatedCost' => self::estimateCost($match['truck'], $match['cargo']),
        ];
    }

    /**
     * Shapes one booking request (with its counterpart load/truck and both
     * parties) for the app's Bookings screen.
     *
     * @param  array<string, mixed>  $row
     * @return array<string, mixed>
     */
    public static function booking(array $row): array
    {
        return [
            'id' => $row['id'],
            'status' => $row['status'] ?? 'pending',
            'direction' => $row['direction'] ?? 'outgoing',
            'price' => isset($row['price']) ? (float) $row['price'] : null,
            'currency' => $row['currency'] ?? 'TZS',
            'message' => $row['message'] ?? null,
            'requestedAt' => self::toMillis($row['requested_at'] ?? null),
            'decidedAt' => self::toMillis($row['decided_at'] ?? null),
            'cargo' => isset($row['cargo']) && is_array($row['cargo']) ? self::cargo($row['cargo']) : null,
            'truck' => isset($row['truck']) && is_array($row['truck']) ? self::truck($row['truck']) : null,
            'requester' => self::party($row['requester'] ?? null),
            'responder' => self::party($row['responder'] ?? null),
        ];
    }

    /**
     * @param  array<string, mixed>|null  $row
     * @return array<string, mixed>|null
     */
    private static function party(?array $row): ?array
    {
        if ($row === null) {
            return null;
        }

        return [
            'id' => $row['id'],
            'name' => $row['name'] ?? '',
            'companyName' => $row['company_name'] ?? null,
        ];
    }

    /**
     * Quote: rate × weight when the truck has a rate, otherwise the budget.
     *
     * @param  array<string, mixed>  $truck
     * @param  array<string, mixed>  $cargo
     */
    private static function estimateCost(array $truck, array $cargo): ?float
    {
        $rate = $truck['rate_per_ton'] ?? null;
        if ($rate !== null && $rate !== '' && (float) $rate > 0) {
            return round((float) $rate * (float) ($cargo['weight_tons'] ?? 0), 2);
        }

        $budget = $cargo['budget'] ?? null;

        return $budget !== null && $budget !== '' ? (float) $budget : null;
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
