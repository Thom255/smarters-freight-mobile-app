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
    public function __construct(private SupabaseClient $supabase) {}

    public function handle(Request $request, Closure $next): Response
    {
        $raw = $request->bearerToken();

        if (! $raw) {
            return $this->unauthorized('Missing bearer token');
        }

        // One round trip: the token row arrives with its user embedded
        // (PostgREST resource embedding). The serial fallback below keeps the
        // middleware working if the embed is ever unavailable.
        $token = $this->supabase->selectOne('api_tokens', [
            'select' => '*,users(*)',
            'token_hash' => 'eq.'.hash('sha256', $raw),
        ]);

        if ($token === null) {
            return $this->unauthorized('Invalid or revoked token');
        }

        if (! empty($token['expires_at']) && strtotime((string) $token['expires_at']) < time()) {
            return $this->unauthorized('Session expired, sign in again');
        }

        $user = is_array($token['users'] ?? null) && ! empty($token['users']['id'])
            ? $token['users']
            : $this->supabase->selectOne('users', [
                'id' => 'eq.'.$token['user_id'],
            ]);

        if ($user === null) {
            return $this->unauthorized('Account no longer exists');
        }

        $request->attributes->set('auth_user', $user);
        $request->attributes->set('token_id', $token['id']);

        // Activity stamp, written at most once every five minutes. It used to
        // run on every request, and this write is a whole extra round trip to
        // Supabase (~1s) in front of the endpoint the user is waiting for.
        $lastUsed = (int) strtotime((string) ($token['last_used_at'] ?? ''));

        if ($lastUsed <= 0 || (time() - $lastUsed) > 300) {
            try {
                $this->supabase->update('api_tokens', 'id', 'eq.'.$token['id'], [
                    'last_used_at' => now()->toIso8601String(),
                ]);
            } catch (\Throwable) {
                // Intentionally ignored — telemetry must never fail a request.
            }
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
