<?php

namespace Tests\Feature;

use App\Mail\ResetPasswordMail;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;

/**
 * Forgot-password / reset-password contract.
 *
 * Same envelope as AuthTest: success { ok:true, ... }, failure
 * { ok:false, field, message }. The forgot endpoint must never reveal whether
 * an account exists, and a completed reset must revoke existing sessions.
 */
class PasswordResetTest extends ApiTestCase
{
    /** Seeds a reset-token row and returns the raw (unhashed) token. */
    private function seedResetToken(string $identifier, ?string $createdAt = null): string
    {
        $token = 'sfr_'.Str::random(48);

        $this->db->insert('password_reset_tokens', [
            'email' => $identifier,
            'token' => hash('sha256', $token),
            'created_at' => $createdAt ?? now()->toIso8601String(),
        ]);

        return $token;
    }

    public function test_forgot_sends_a_reset_link_for_a_known_account(): void
    {
        Mail::fake();
        $this->seedUser(['identifier' => 'amina@example.com']);

        $response = $this->postJson('/api/auth/forgot-password', [
            'identifier' => 'AMINA@example.com ',
        ]);

        $response->assertOk()->assertJsonPath('ok', true);

        // Pull the raw token out of the link the user receives.
        $sent = null;
        Mail::assertSent(ResetPasswordMail::class, function (ResetPasswordMail $mail) use (&$sent): bool {
            $sent = $mail;

            return true;
        });

        $this->assertNotNull($sent);
        $this->assertStringStartsWith('smartersfreightmobileapp://reset-password?', $sent->appUrl);
        $this->assertStringContainsString('identifier=amina%40example.com', $sent->appUrl);

        parse_str((string) parse_url($sent->appUrl, PHP_URL_QUERY), $query);
        $rawToken = (string) ($query['token'] ?? '');
        $this->assertStringStartsWith('sfr_', $rawToken);

        // The database stores only the SHA-256 hash of that raw token.
        $stored = $this->db->selectOne('password_reset_tokens', [
            'email' => 'eq.amina@example.com',
        ]);
        $this->assertNotNull($stored);
        $this->assertSame(hash('sha256', $rawToken), $stored['token']);
        $this->assertNotSame($rawToken, $stored['token']);
    }

    public function test_forgot_is_neutral_for_an_unknown_account_and_sends_nothing(): void
    {
        Mail::fake();

        $response = $this->postJson('/api/auth/forgot-password', [
            'identifier' => 'ghost@example.com',
        ]);

        // Same success envelope as a real account — no enumeration signal.
        $response->assertOk()->assertJsonPath('ok', true);
        Mail::assertNothingSent();
        $this->assertSame([], $this->db->select('password_reset_tokens'));
    }

    public function test_forgot_rejects_an_invalid_identifier(): void
    {
        Mail::fake();

        $this->postJson('/api/auth/forgot-password', ['identifier' => 'not-valid'])
            ->assertStatus(422)
            ->assertJsonPath('ok', false)
            ->assertJsonPath('field', 'identifier');

        Mail::assertNothingSent();
    }

    public function test_reset_with_a_valid_token_changes_the_password(): void
    {
        $user = $this->seedUser(['identifier' => 'amina@example.com']);
        $token = $this->seedResetToken('amina@example.com');

        $response = $this->postJson('/api/auth/reset-password', [
            'identifier' => 'amina@example.com',
            'token' => $token,
            'password' => 'brand-new-secret',
            'confirm' => 'brand-new-secret',
        ]);

        $response->assertOk()->assertJsonPath('ok', true);

        $updated = $this->db->selectOne('users', ['id' => 'eq.'.$user['id']]);
        $this->assertTrue(Hash::check('brand-new-secret', (string) $updated['password_hash']));

        // Single use: the token row is gone.
        $this->assertSame([], $this->db->select('password_reset_tokens'));

        // The new password signs in.
        $this->postJson('/api/auth/login', [
            'identifier' => 'amina@example.com',
            'password' => 'brand-new-secret',
        ])->assertOk()->assertJsonPath('ok', true);
    }

    public function test_reset_revokes_every_existing_session(): void
    {
        $user = $this->seedUser(['identifier' => 'amina@example.com']);
        $oldToken = $this->tokenFor($user['id']);
        $resetToken = $this->seedResetToken('amina@example.com');

        $this->postJson('/api/auth/reset-password', [
            'identifier' => 'amina@example.com',
            'token' => $resetToken,
            'password' => 'brand-new-secret',
        ])->assertOk();

        // A token minted before the reset no longer works.
        $this->withHeaders($this->bearer($oldToken))
            ->getJson('/api/auth/me')
            ->assertStatus(401);
    }

    public function test_reset_rejects_an_invalid_or_used_token(): void
    {
        $this->seedUser(['identifier' => 'amina@example.com']);

        $this->postJson('/api/auth/reset-password', [
            'identifier' => 'amina@example.com',
            'token' => 'sfr_does-not-exist',
            'password' => 'brand-new-secret',
        ])->assertStatus(401)
            ->assertJsonPath('ok', false)
            ->assertJsonPath('field', 'token');
    }

    public function test_reset_rejects_an_expired_token(): void
    {
        $this->seedUser(['identifier' => 'amina@example.com']);
        $token = $this->seedResetToken('amina@example.com', now()->subHours(2)->toIso8601String());

        $this->postJson('/api/auth/reset-password', [
            'identifier' => 'amina@example.com',
            'token' => $token,
            'password' => 'brand-new-secret',
        ])->assertStatus(401)
            ->assertJsonPath('field', 'token');

        // An expired token is cleaned up so it can never be retried.
        $this->assertSame([], $this->db->select('password_reset_tokens'));
    }

    public function test_reset_requires_matching_passwords(): void
    {
        $this->seedUser(['identifier' => 'amina@example.com']);
        $token = $this->seedResetToken('amina@example.com');

        $this->postJson('/api/auth/reset-password', [
            'identifier' => 'amina@example.com',
            'token' => $token,
            'password' => 'brand-new-secret',
            'confirm' => 'different-secret',
        ])->assertStatus(422)
            ->assertJsonPath('field', 'confirm');
    }

    public function test_reset_rejects_a_short_password(): void
    {
        $this->seedUser(['identifier' => 'amina@example.com']);
        $token = $this->seedResetToken('amina@example.com');

        $this->postJson('/api/auth/reset-password', [
            'identifier' => 'amina@example.com',
            'token' => $token,
            'password' => 'short',
        ])->assertStatus(422)
            ->assertJsonPath('field', 'password');
    }
}
