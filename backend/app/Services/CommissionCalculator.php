<?php

namespace App\Services;

/**
 * The platform's 8% commission on the agreed cargo transportation price
 * (TZS 1,000,000 → commission 80,000 → provider net 920,000).
 *
 * This is the ONLY place the split is derived. No request body, mobile-app
 * payload or database column is ever trusted as the commission amount: values
 * are recomputed from the agreed price on the server, and the same arithmetic
 * is re-checked by the `commissions_active` CHECK constraints in
 * supabase_commissions.sql, so a wrong figure cannot be stored by any writer.
 *
 * All arithmetic happens in integer cents — float multiplication of the
 * minor unit cannot drift, and with an 8% rate the product can never land on
 * a half-cent, so the rounding direction is never ambiguous.
 */
class CommissionCalculator
{
    /** Platform commission, in percent of the agreed transportation price. */
    public const RATE_PERCENT = 8.0;

    /** Percent → minor-unit divisor. Kept as a float so every derived amount
     *  comes back as a float instead of a silently truncated integer. */
    private const HUNDRED = 100.0;

    /**
     * Sanity ceiling for a single load's agreed price, well inside
     * numeric(15, 2) and far past anything a freight quote realises.
     */
    private const MAX_PRICE = 1_000_000_000_000.0;

    public static function rate(): float
    {
        return self::RATE_PERCENT;
    }

    /**
     * Split an agreed transportation price into the platform's share and the
     * transport provider's net.
     *
     * @param  int|float|string|null  $agreedPrice  the agreed transportation price (TZS)
     * @return array{cargo_price: float, commission_rate: float, commission_amount: float, provider_net_amount: float}
     *
     * @throws \InvalidArgumentException when the price is missing, not numeric,
     *                                   negative, zero, non-finite or absurd
     */
    public static function calculate(int|float|string|null $agreedPrice): array
    {
        $price = self::assertValidPrice($agreedPrice);

        $priceCents = (int) round($price * self::HUNDRED);
        $commissionCents = (int) round($priceCents * self::RATE_PERCENT / self::HUNDRED);
        $netCents = $priceCents - $commissionCents;

        return [
            'cargo_price' => $priceCents / self::HUNDRED,
            'commission_rate' => self::RATE_PERCENT,
            'commission_amount' => $commissionCents / self::HUNDRED,
            'provider_net_amount' => $netCents / self::HUNDRED,
        ];
    }

    /**
     * True when a price can legally carry a commission.
     */
    public static function isValidPrice(mixed $agreedPrice): bool
    {
        try {
            self::assertValidPrice($agreedPrice);
        } catch (\InvalidArgumentException) {
            return false;
        }

        return true;
    }

    /**
     * @return float the price reduced to two decimal places
     *
     * @throws \InvalidArgumentException
     */
    private static function assertValidPrice(int|float|string|null $agreedPrice): float
    {
        if (is_string($agreedPrice)) {
            $agreedPrice = trim($agreedPrice);
            if ($agreedPrice === '' || ! is_numeric($agreedPrice)) {
                throw new \InvalidArgumentException('The agreed transportation price must be a number.');
            }
            $agreedPrice = (float) $agreedPrice;
        }

        if ($agreedPrice === null || ! is_int($agreedPrice) && ! is_float($agreedPrice)) {
            throw new \InvalidArgumentException('The agreed transportation price is required.');
        }

        $price = (float) $agreedPrice;

        if (! is_finite($price)) {
            throw new \InvalidArgumentException('The agreed transportation price must be a finite amount.');
        }

        if ($price < 0.0) {
            throw new \InvalidArgumentException('The agreed transportation price cannot be negative.');
        }

        if ($price <= 0.0) {
            throw new \InvalidArgumentException('The agreed transportation price must be greater than zero.');
        }

        if ($price > self::MAX_PRICE) {
            throw new \InvalidArgumentException('The agreed transportation price is out of range.');
        }

        return round($price, 2);
    }
}
