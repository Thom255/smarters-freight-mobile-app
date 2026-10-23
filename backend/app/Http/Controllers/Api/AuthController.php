<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\SupabaseClient;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * Auth endpoints consumed by the mobile app.
 *
 * Response contract mirrors src/lib/auth-core.ts so the existing screens keep
 * working unchanged:
 *   POST /api/auth/register  {name, identifier, password, confirm}
 *   POST /api/auth/login     {identifier, password}
 *   POST /api/auth/logout    (Bearer token)
 *   GET  /api/auth/me        (Bearer token)
 *
 * Success → { ok: true,  user: {id, identifier, name, createdAt} }
 * Failure → { ok: false, field, message }  (HTTP 422 / 401)
 */
class AuthController extends Controller
{
    public function __construct(private SupabaseClient $supabase)
    {
    }

    public function register(Request $request): JsonResponse
    {
        // Messages mirror src/lib/auth-core.ts so client- and server-side
        // validation always say exactly the same thing.
        $data = $request->validate([
            'name' => ['required', 'string', 'min:2', 'max:120'],
            'identifier' => ['required', 'string', 'max:255'],
            'password' => ['required', 'string', 'min:6', 'max:255'],
            'confirm' => ['nullable', 'string'],
            'role' => ['nullable', 'string', 'in:truck_owner,cargo_owner'],
            'companyName' => ['nullable', 'string', 'max:150'],
        ], [
            'name.required' => 'Enter your full name',
            'name.min' => 'Name looks too short',
            'identifier.required' => 'Enter your email or phone number',
            'password.required' => 'Enter a password',
            'password.min' => 'Password must be at least 6 characters',
            'role.in' => 'Choose whether you own trucks or cargo',
        ], [
            'name' => 'name',
            'identifier' => 'identifier',
            'password' => 'password',
            'role' => 'role',
            'companyName' => 'company_name',
        ]);

        $identifier = $this->normalizeIdentifier($data['identifier']);

        // Same rules the app applies client-side (src/lib/auth-core.ts).
        if (! $this->isValidIdentifier($identifier)) {
            return $this->fieldError('identifier', 'Enter a valid email address or phone number');
        }

        if (($data['confirm'] ?? null) !== null && $data['confirm'] !== $data['password']) {
            return $this->fieldError('confirm', 'Passwords do not match');
        }

        $existing = $this->supabase->selectOne('users', [
            'select' => 'id',
            'identifier' => "eq.{$identifier}",
        ]);

        if ($existing !== null) {
            return $this->fieldError('identifier', 'An account with that email or phone already exists');
        }

        try {
            $user = $this->supabase->insert('users', [
                'name' => trim($data['name']),
                'identifier' => $identifier,
                'password_hash' => Hash::make($data['password']),
                'role' => $data['role'] ?? 'cargo_owner',
                'company_name' => isset($data['companyName']) && trim($data['companyName']) !== ''
                    ? trim($data['companyName'])
                    : null,
            ]);
        } catch (\RuntimeException $e) {
            // Unique-violation race (two registers at once).
            if (str_contains($e->getMessage(), '23505') || str_contains($e->getMessage(), 'duplicate key')) {
                return $this->fieldError('identifier', 'An account with that email or phone already exists');
            }
            throw $e;
        }

        // Auto sign-in on register: issue a token immediately so the app can
        // create a session without a second round trip.
        return response()->json([
            'ok' => true,
            'user' => $this->presentUser($user),
            'token' => $this->issueToken((string) $user['id']),
        ], 201);
    }

    public function login(Request $request): JsonResponse
    {
        $data = $request->validate([
            'identifier' => ['required', 'string', 'max:255'],
            'password' => ['required', 'string'],
        ], [
            'identifier.required' => 'Enter your email or phone number',
            'password.required' => 'Enter a password',
        ], [
            'identifier' => 'identifier',
            'password' => 'password',
        ]);

        $identifier = $this->normalizeIdentifier($data['identifier']);

        $user = $this->supabase->selectOne('users', [
            'identifier' => "eq.{$identifier}",
        ]);

        if ($user === null) {
            return $this->fieldError('identifier', 'No account found with that email or phone', 401);
        }

        if (! Hash::check($data['password'], (string) $user['password_hash'])) {
            return $this->fieldError('password', 'Incorrect password. Try again', 401);
        }

        // Suspension is enforced server-side (users.status, supabase_admin.sql):
        // correct credentials are not enough while an account is suspended.
        // Absent column (migration not applied) reads as active.
        if ((string) ($user['status'] ?? 'active') === 'suspended') {
            return response()->json([
                'ok' => false,
                'field' => 'form',
                'message' => 'This account has been suspended. Please contact the platform administrator.',
            ], 403);
        }

        return response()->json([
            'ok' => true,
            'user' => $this->presentUser($user),
            'token' => $this->issueToken($user['id']),
        ]);
    }

    public function logout(Request $request): JsonResponse
    {
        $this->supabase->delete('api_tokens', 'id', 'eq.'.$request->attributes->get('token_id'));

        return response()->json(['ok' => true]);
    }

    public function me(Request $request): JsonResponse
    {
        return response()->json([
            'ok' => true,
            'user' => $this->presentUser($request->attributes->get('auth_user')),
        ]);
    }

    /** Stateless opaque bearer token; only its SHA-256 hash is stored. */
    private function issueToken(string $userId): string
    {
        $token = 'sf_'.Str::random(64);

        $this->supabase->insert('api_tokens', [
            'user_id' => $userId,
            'token_hash' => hash('sha256', $token),
            'expires_at' => now()->addDays(30)->toIso8601String(),
        ]);

        return $token;
    }

    private function normalizeIdentifier(string $value): string
    {
        return mb_strtolower(trim($value));
    }

    private function isValidIdentifier(string $value): bool
    {
        if ($value === '') {
            return false;
        }

        $isEmail = (bool) preg_match('/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/', $value);
        $isPhone = (bool) preg_match('/^\+?[\d\s()-]{7,15}$/', $value);

        return $isEmail || $isPhone;
    }

    /** @param array<string, mixed> $user */
    private function presentUser(array $user): array
    {
        return [
            'id' => $user['id'],
            'identifier' => $user['identifier'],
            'name' => $user['name'] ?? null,
            'role' => $user['role'] ?? 'cargo_owner',
            'companyName' => $user['company_name'] ?? null,
            'createdAt' => isset($user['created_at'])
                ? (int) strtotime($user['created_at']) * 1000
                : null,
        ];
    }

    private function fieldError(string $field, string $message, int $status = 422): JsonResponse
    {
        return response()->json([
            'ok' => false,
            'field' => $field,
            'message' => $message,
        ], $status);
    }
}
