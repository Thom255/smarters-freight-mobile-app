<?php

namespace App\Support;

use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;

/**
 * Rate limit for the authenticated API surface (routes/api.php group).
 *
 * Shared by AppServiceProvider, which registers it, and the feature tests,
 * which re-register the same rule with a lower ceiling so they do not have to
 * fire 121 real requests.
 *
 * Keyed by client IP on purpose. Laravel sorts ThrottleRequests ahead of
 * middleware that are not in its priority list, so this limiter runs BEFORE
 * auth.api and no user has been resolved yet — keying by user id here would
 * silently collapse to one shared bucket. The address is also the only key an
 * attacker cannot mint: rotating bogus bearer tokens would otherwise buy a
 * fresh budget per request while still paying for an auth lookup. Every
 * request from one address — valid token, stale token or none — draws from
 * the same budget, which is what actually bounds abuse.
 */
class ApiRateLimit
{
    /** Ceiling for the authenticated surface (routes/api.php group). */
    public const PER_MINUTE = 120;

    public static function for(Request $request, int $perMinute): Limit
    {
        return Limit::perMinute($perMinute)
            ->by($request->ip())
            ->response(fn () => response()->json([
                'ok' => false,
                'field' => 'form',
                'message' => 'Too many requests. Please wait a moment and try again.',
            ], 429));
    }
}
