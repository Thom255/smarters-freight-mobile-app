<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Supabase project (REST / PostgREST API)
    |--------------------------------------------------------------------------
    |
    | SUPABASE_URL          https://<project>.supabase.co
    | SUPABASE_ANON_KEY     public anon key (kept for parity / future use)
    | SUPABASE_SERVICE_KEY  service-role key — used server-side ONLY. It
    |                       bypasses Row Level Security, so it must never be
    |                       exposed to the mobile app.
    |
    */

    'url' => env('SUPABASE_URL'),
    'anon_key' => env('SUPABASE_ANON_KEY'),
    'service_key' => env('SUPABASE_SERVICE_KEY'),

];
