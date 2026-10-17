<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Chrome's "Private Network Access" sends its own preflight header
 * (Access-Control-Request-Private-Network: true) when a page on one network
 * zone calls an API on a more private one — which is exactly the Expo web dev
 * case: http://localhost:8081 → http://192.168.x.x:8001. Without the matching
 * response header the browser blocks the request before it leaves the tab,
 * and the app can only report "Cannot reach the server".
 *
 * This middleware is PREPENDED so it wraps the framework's HandleCors: CORS
 * answers the preflight (and returns early), then this adds the header to
 * that response. Non-preflight requests pass through untouched.
 */
class AllowPrivateNetworkAccess
{
    public function handle(Request $request, Closure $next): Response
    {
        $response = $next($request);

        if (
            $request->isMethod('OPTIONS')
            && $request->headers->has('Access-Control-Request-Private-Network')
        ) {
            $response->headers->set('Access-Control-Allow-Private-Network', 'true');
        }

        return $response;
    }
}
