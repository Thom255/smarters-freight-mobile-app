<?php

namespace App\Http\Middleware;

use App\Services\SupabaseClient;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Resolves the Bearer token (Authorization: Bearer sf_...) to a user row and
 * the token row, exposing them on the request:
 *   $request->attributes->get('auth_user')  → user array
 *   $request->attributes->get('token_id')   → api_tokens.id (for logout)
 *
 * Invalid / expired / missing tokens → 401 { ok:false, field:'token', ... }.
 */
class AuthenticateApi
{
    public function __construct(private SupabaseClient $supabase)
    {
    }

    public function handle(Request $request, Closure $next): Response
    {
        $raw = $request->bearerToken();

        if (! $raw) {
            return $this->unauthorized('Missing bearer token');
        }

        $token = $this->supabase->selectOne('api_tokens', [
            'select' => '*',
            'token_hash' => 'eq.'.hash('sha256', $raw),
        ]);

        if ($token === null) {
            return $this->unauthorized('Invalid or revoked token');
        }

        if (! empty($token['expires_at']) && strtotime((string) $token['expires_at']) < time()) {
            return $this->unauthorized('Session expired, sign in again');
        }

        $user = $this->supabase->selectOne('users', [
            'id' => 'eq.'.$token['user_id'],
        ]);

        if ($user === null) {
            return $this->unauthorized('Account no longer exists');
        }

        $request->attributes->set('auth_user', $user);
        $request->attributes->set('token_id', $token['id']);

        // Fire-and-forget activity stamp; failures must not break the request.
        try {
            $this->supabase->update('api_tokens', 'id', 'eq.'.$token['id'], [
                'last_used_at' => now()->toIso8601String(),
            ]);
        } catch (\Throwable) {
            // Intentionally ignored.
        }

        return $next($request);
    }

    private function unauthorized(string $message): Response
    {
        return response()->json([
            'ok' => false,
            'field' => 'session',
            'message' => $message,
        ], 401);
    }
}
