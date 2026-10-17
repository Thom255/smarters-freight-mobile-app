<?php

namespace App\Http\Controllers;

abstract class Controller
{
    /**
     * Every primary key in the schema is a UUID (gen_random_uuid()). Anything
     * else can never match a row, and PostgREST answers a malformed `id=eq…`
     * filter with a 400 — so route-level id guards turn a would-be 500 into
     * the honest 404 the mobile contract expects.
     */
    protected function looksLikeId(string $value): bool
    {
        return (bool) preg_match(
            '/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i',
            $value,
        );
    }
}
