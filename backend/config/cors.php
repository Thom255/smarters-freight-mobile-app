<?php

return [

    /*
    |---------------------------------------------------------------------------
    | Cross-Origin Resource Sharing (CORS)
    |---------------------------------------------------------------------------
    |
    | The Expo app runs on a different origin than the API when it is opened
    | on web (Metro serves http://localhost:8081 while the API listens on
    | http://localhost:8001), so preflighted JSON requests need these headers.
    | React Native on a device does not enforce CORS, but the browser does.
    |
    | The app authenticates with a Bearer token and never sends cookies
    | (`supports_credentials` is false), so any origin is safe to allow in
    | development — localhost, the LAN IP and phone browsers all work with no
    | configuration. Production must set CORS_ALLOWED_ORIGINS to its real
    | origins instead of relying on '*'.
    |
    | Paths are matched against the request path, so only the API is exposed.
    |
    */

    'paths' => ['api/*'],

    'allowed_methods' => ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],

    'allowed_origins' => array_values(array_filter(array_map(
        'trim',
        explode(',', (string) env(
            'CORS_ALLOWED_ORIGINS',
            env('APP_ENV') === 'production'
                ? 'http://localhost:8081,http://127.0.0.1:8081'
                : '*'
        ))
    ))),

    'allowed_origins_patterns' => [],

    'allowed_headers' => ['Accept', 'Authorization', 'Content-Type', 'X-Requested-With'],

    'exposed_headers' => [],

    // Preflights are cheap to cache: 0 meant every single POST paid an extra
    // round trip (a real second on a slow link) before the real request.
    'max_age' => 3600,

    'supports_credentials' => false,

];
