<?php

namespace App\Providers;

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
