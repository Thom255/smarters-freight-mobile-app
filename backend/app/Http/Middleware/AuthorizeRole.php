<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Backend-enforced role permissions.
 *
 * The app used to hide buttons by role in the mobile UI while every endpoint
 * stayed open to any signed-in user — a cargo owner could POST /api/trucks
 * with a modified client. Ownership checks (owner_id/user_id) stop cross-user
 * access, but they cannot stop a user acting outside their own role, so the
 * rule has to live here.
 *
 * Usage: ->middleware('auth.role:truck_owner') — repeat the parameter for
 * roles that share a permission: 'auth.role:truck_owner,cargo_owner'.
 *
 * `admin` always passes. Runs after auth.api, which guarantees `auth_user`.
 */
class AuthorizeRole
{
    public function handle(Request $request, Closure $next, string ...$roles): Response
    {
        $user = $request->attributes->get('auth_user');
        $role = (string) ($user['role'] ?? '');

        if ($role === 'admin' || in_array($role, $roles, true)) {
            return $next($request);
        }

        return response()->json([
            'ok' => false,
            'field' => 'role',
            'message' => 'Your account type does not allow that action.',
        ], 403);
    }
}
