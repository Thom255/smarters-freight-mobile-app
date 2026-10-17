<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Mail\ResetPasswordMail;
use App\Services\SupabaseClient;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;

/**
 * Forgot-password / password-reset endpoints.
 *
 * The account store is Supabase (see AuthController), so this deliberately
 * mirrors that client rather than Laravel's session-based password broker.
 *
 *   POST /api/auth/forgot-password  { identifier }
 *   POST /api/auth/reset-password   { identifier, token, password, confirm }
 *
 * Response contract matches the rest of the mobile API so the screens can
 * render failures inline: success { ok:true, ... }, failure
 * { ok:false, field, message }. The forgot-password response is always a
 * neutral success, so an attacker cannot use it to enumerate accounts.
 */
class PasswordResetController extends Controller
{
    /** Reset link lifetime, in minutes (matches config('auth.passwords.users.expire')). */
    private int $expireMinutes;

    /** App deep-link scheme the reset link opens (app.json -> expo.scheme). */
    private const APP_SCHEME = 'smartersfreightmobileapp';

    public function __construct(private SupabaseClient $supabase)
    {
        $this->expireMinutes = (int) config('auth.passwords.users.expire', 60);
    }

    public function forgot(Request $request): JsonResponse
    {
        $data = $request->validate([
            'identifier' => ['required', 'string', 'max:255'],
        ], [
            'identifier.required' => 'Enter your email or phone number',
        ], [
            'identifier' => 'identifier',
        ]);

        $identifier = $this->normalizeIdentifier($data['identifier']);

        if (! $this->isValidIdentifier($identifier)) {
            return $this->fieldError('identifier', 'Enter a valid email address or phone number');
        }

        $user = $this->supabase->selectOne('users', [
            'select' => 'id, identifier',
            'identifier' => "eq.{$identifier}",
        ]);

        if ($user !== null) {
            $token = 'sfr_'.Str::random(48);

            // One active token per identifier: drop any previous request.
            try {
                $this->supabase->delete('password_reset_tokens', 'email', "eq.{$identifier}");
            } catch (\Throwable) {
                // A missing row is fine; a dead half-written one is replaced below.
            }

            $this->supabase->insert('password_reset_tokens', [
                'email' => $identifier,
                'token' => hash('sha256', $token),
                'created_at' => now()->toIso8601String(),
            ]);

            $this->sendResetLink($identifier, $token);
        }

        // Neutral message either way (no account enumeration).
        return response()->json([
            'ok' => true,
            'message' => 'If an account exists with that email or phone, we have sent reset instructions.',
        ]);
    }

    public function reset(Request $request): JsonResponse
    {
        $data = $request->validate([
            'identifier' => ['required', 'string', 'max:255'],
            'token' => ['required', 'string', 'max:255'],
            'password' => ['required', 'string', 'min:6', 'max:255'],
            'confirm' => ['nullable', 'string'],
        ], [
            'identifier.required' => 'Enter your email or phone number',
            'token.required' => 'This reset link is invalid. Request a new one.',
            'password.required' => 'Enter a password',
            'password.min' => 'Password must be at least 6 characters',
        ], [
            'identifier' => 'identifier',
            'token' => 'token',
            'password' => 'password',
        ]);

        $identifier = $this->normalizeIdentifier($data['identifier']);

        if (($data['confirm'] ?? null) !== null && $data['confirm'] !== $data['password']) {
            return $this->fieldError('confirm', 'Passwords do not match');
        }

        $reset = $this->supabase->selectOne('password_reset_tokens', [
            'email' => "eq.{$identifier}",
            'token' => 'eq.'.hash('sha256', $data['token']),
        ]);

        if ($reset === null) {
            return $this->fieldError('token', 'This reset link is invalid or has already been used. Request a new one.', 401);
        }

        $createdAt = isset($reset['created_at']) ? strtotime((string) $reset['created_at']) : 0;
        if ($createdAt > 0 && (time() - $createdAt) > $this->expireMinutes * 60) {
            try {
                $this->supabase->delete('password_reset_tokens', 'email', "eq.{$identifier}");
            } catch (\Throwable) {
            }

            return $this->fieldError('token', 'This reset link has expired. Request a new one.', 401);
        }

        $user = $this->supabase->selectOne('users', ['identifier' => "eq.{$identifier}"]);

        if ($user === null) {
            return $this->fieldError('identifier', 'No account found with that email or phone', 401);
        }

        $this->supabase->update('users', 'id', 'eq.'.$user['id'], [
            'password_hash' => Hash::make($data['password']),
        ]);

        // The token is single-use, and every existing session is invalidated
        // so a reset also logs the account out of any stolen device.
        try {
            $this->supabase->delete('password_reset_tokens', 'email', "eq.{$identifier}");
            $this->supabase->delete('api_tokens', 'user_id', 'eq.'.$user['id']);
        } catch (\Throwable) {
        }

        return response()->json([
            'ok' => true,
            'message' => 'Your password has been reset. Sign in with your new password.',
        ]);
    }

    /**
     * Emails the reset link when the identifier is an email address. Phone
     * identifiers are stored the same way; an SMS gateway would hook in here.
     */
    private function sendResetLink(string $identifier, string $token): void
    {
        if (! filter_var($identifier, FILTER_VALIDATE_EMAIL)) {
            return;
        }

        $query = http_build_query([
            'identifier' => $identifier,
            'token' => $token,
        ]);

        $appUrl = self::APP_SCHEME.'://reset-password?'.$query;
        $webUrl = rtrim((string) config('app.url'), '/').'/reset-password?'.$query;

        try {
            Mail::to($identifier)->send(new ResetPasswordMail($appUrl, $webUrl));
        } catch (\Throwable $e) {
            // Never leak delivery failures to the caller; log for operators.
            report($e);
        }
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

    private function fieldError(string $field, string $message, int $status = 422): JsonResponse
    {
        return response()->json([
            'ok' => false,
            'field' => $field,
            'message' => $message,
        ], $status);
    }
}
