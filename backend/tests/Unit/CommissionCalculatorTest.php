<?php

namespace Tests\Unit;

use App\Services\CommissionCalculator;
use PHPUnit\Framework\TestCase;

/**
 * The 8% platform commission itself: TZS 1,000,000 must always split into a
 * TZS 80,000 platform commission and a TZS 920,000 provider net, computed in
 * integer cents so the result can never drift, invalid prices are refused
 * outright, and the two halves always add back up to the agreed price.
 */
class CommissionCalculatorTest extends TestCase
{
    public function test_the_documented_million_shilling_example_splits_exactly(): void
    {
        $split = CommissionCalculator::calculate(1000000);

        $this->assertSame(1000000.0, $split['cargo_price']);
        $this->assertSame(8.0, $split['commission_rate']);
        $this->assertSame(80000.0, $split['commission_amount']);
        $this->assertSame(920000.0, $split['provider_net_amount']);
        $this->assertSame(1000000.0, $split['commission_amount'] + $split['provider_net_amount']);
    }

    public function test_the_rate_is_eight_percent(): void
    {
        $this->assertSame(8.0, CommissionCalculator::rate());

        $split = CommissionCalculator::calculate(5000);

        $this->assertSame(400.0, $split['commission_amount']);
        $this->assertSame(4600.0, $split['provider_net_amount']);
    }

    public function test_the_two_halves_always_reconcile_to_the_agreed_price(): void
    {
        $prices = [1000000, 1, 999, 12345, 12345.67, 1999.99, 333333333.33, 777777777777, '1000000'];

        foreach ($prices as $price) {
            $split = CommissionCalculator::calculate($price);

            $this->assertEqualsWithDelta(
                $split['cargo_price'],
                $split['commission_amount'] + $split['provider_net_amount'],
                0.001,
                "Commission + provider net must equal the agreed price for {$price}.",
            );

            $this->assertEqualsWithDelta(
                round($split['cargo_price'] * 0.08, 2),
                $split['commission_amount'],
                0.001,
                "Commission must be 8% of the agreed price for {$price}.",
            );

            // Never negative, never more than the price the provider is owed.
            $this->assertGreaterThanOrEqual(0, $split['commission_amount']);
            $this->assertGreaterThan(0, $split['provider_net_amount']);
            $this->assertLessThanOrEqual($split['cargo_price'], $split['commission_amount']);
        }
    }

    public function test_amounts_never_drift_on_odd_cents(): void
    {
        $split = CommissionCalculator::calculate('12345.67');

        $this->assertSame(12345.67, $split['cargo_price']);
        $this->assertSame(987.65, $split['commission_amount']);
        $this->assertSame(11358.02, $split['provider_net_amount']);
        $this->assertSame(12345.67, $split['commission_amount'] + $split['provider_net_amount']);
    }

    public function test_invalid_prices_are_rejected(): void
    {
        $invalid = [
            'null' => null,
            'zero' => 0,
            'negative' => -1000000,
            'just below zero' => -0.01,
            'not a number' => 'abc',
            'empty string' => '',
            'blank string' => '   ',
            'not a finite float (NAN)' => NAN,
            'not a finite float (INF)' => INF,
            'absurdly large' => 2000000000000.0,
        ];

        foreach ($invalid as $label => $price) {
            try {
                CommissionCalculator::calculate($price);
                $this->fail("Price ({$label}) must not be accepted.");
            } catch (\InvalidArgumentException $e) {
                $this->assertNotSame('', $e->getMessage());
            }
        }
    }

    public function test_is_valid_price_answers_without_throwing(): void
    {
        $this->assertTrue(CommissionCalculator::isValidPrice(1000000));
        $this->assertTrue(CommissionCalculator::isValidPrice('1000000.50'));

        $this->assertFalse(CommissionCalculator::isValidPrice(0));
        $this->assertFalse(CommissionCalculator::isValidPrice(-1));
        $this->assertFalse(CommissionCalculator::isValidPrice(null));
        $this->assertFalse(CommissionCalculator::isValidPrice('free'));
    }

    public function test_a_tiny_price_never_produces_a_negative_or_oversized_split(): void
    {
        $split = CommissionCalculator::calculate(0.01);

        $this->assertSame(0.01, $split['cargo_price']);
        $this->assertSame(0.0, $split['commission_amount']);
        $this->assertSame(0.01, $split['provider_net_amount']);
    }
}
