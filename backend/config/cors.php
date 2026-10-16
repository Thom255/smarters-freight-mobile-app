<?php

return [

    /*
    |---------------------------------------------------------------------------
    | Cross-Origin Resource Sharing (CORS)
    |---------------------------------------------------------------------------
    |
    | The Expo app runs on a different origin than the API when it is opened
    | on web (Metro serves http://localhost:8081 while the API listens on
    | http://localhost:8000), so preflighted JSON requests need these headers.
    | React Native on a device does not enforce CORS, but the browser does.
    |
    | Paths are matched against the request path, so only the API is exposed.
    |
    */

    'paths' => ['api/*'],

    'allowed_methods' => ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],

    'allowed_origins' => array_values(array_filter(array_map(
        'trim',
        explode(',', (string) env('CORS_ALLOWED_ORIGINS', 'http://localhost:8081,http://127.0.0.1:8081'))
    ))),

    'allowed_origins_patterns' => [],

    'allowed_headers' => ['Accept', 'Authorization', 'Content-Type', 'X-Requested-With'],

    'exposed_headers' => [],

    'max_age' => 0,

    'supports_credentials' => false,

];
