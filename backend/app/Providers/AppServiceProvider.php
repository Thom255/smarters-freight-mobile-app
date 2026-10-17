<?php

namespace App\Providers;

use App\Support\ApiRateLimit;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        //
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        // Brute-force protection for the public auth endpoints (SRS security
        // rules). Both limiters are keyed by client IP; the app only ever
        // calls these two routes, so a lockout costs the user one minute.
        RateLimiter::for('auth-login', function (Request $request) {
            return Limit::perMinute(10)
                ->by($request->ip())
                ->response(fn () => response()->json([
                    'ok' => false,
                    'field' => 'form',
                    'message' => 'Too many sign-in attempts. Please wait a minute and try again.',
                ], 429));
        });

        RateLimiter::for('auth-register', function (Request $request) {
            return Limit::perMinute(5)
                ->by($request->ip())
                ->response(fn () => response()->json([
                    'ok' => false,
                    'field' => 'form',
                    'message' => 'Too many sign-up attempts. Please wait a minute and try again.',
                ], 429));
        });

        RateLimiter::for('auth-password', function (Request $request) {
            return Limit::perMinute(5)
                ->by($request->ip())
                ->response(fn () => response()->json([
                    'ok' => false,
                    'field' => 'form',
                    'message' => 'Too many password reset attempts. Please wait a minute and try again.',
                ], 429));
        });

        // Authenticated surface (routes/api.php group). Without this a
        // compromised token — or a buggy screen looping on retries — could
        // hammer Supabase without bound, since PostgREST round trips are the
        // expensive part of every request. See ApiRateLimit for the keying.
        RateLimiter::for('api', function (Request $request) {
            return ApiRateLimit::for($request, ApiRateLimit::PER_MINUTE);
        });

        // The PHP built-in dev server (cli-server SAPI) inherits
        // max_execution_time=30 from php.ini and kills the whole request with
        // a fatal error when Supabase is slow — a single dashboard hit makes
        // several serial REST calls. SupabaseClient bounds each call to 10s
        // (with retries), so give the request enough headroom to finish them
        // instead of dying at 30s. CLI (tests, artisan, queue workers) keeps
        // its own limit, which is unlimited by default.
        if (PHP_SAPI !== 'cli') {
            set_time_limit(60);
        }
    }
}
