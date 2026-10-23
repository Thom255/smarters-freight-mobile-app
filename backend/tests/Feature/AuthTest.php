<?php

namespace Tests\Feature;

/**
 * Auth contract tests — every response must follow the mobile contract:
 * success { ok:true, user, token }, failure { ok:false, field, message }.
 */
class AuthTest extends ApiTestCase
{
    public function test_register_creates_an_account_and_signs_the_user_in(): void
    {
        $response = $this->postJson('/api/auth/register', [
            'name' => 'Amina Juma',
            'identifier' => 'Amina@Example.com ',
            'password' => 'secret123',
            'confirm' => 'secret123',
            'role' => 'cargo_owner',
        ]);

        $response->assertStatus(201)->assertJsonPath('ok', true);
        $this->assertNotEmpty($response->json('token'));
        $this->assertSame('cargo_owner', $response->json('user.role'));
        // Identifier is normalized: trimmed + lowercased.
        $this->assertSame('amina@example.com', $response->json('user.identifier'));

        $this->assertNotNull($this->db->selectOne('users', ['identifier' => 'eq.amina@example.com']));
    }

    public function test_register_rejects_a_duplicate_account(): void
    {
        $this->seedUser(['identifier' => 'taken@example.com']);

        $response = $this->postJson('/api/auth/register', [
            'name' => 'Someone Else',
            'identifier' => 'TAKEN@example.com',
            'password' => 'secret123',
        ]);

        $response->assertStatus(422)
            ->assertJsonPath('ok', false)
            ->assertJsonPath('field', 'identifier');
    }

    public function test_register_reports_the_first_failing_field(): void
    {
        $response = $this->postJson('/api/auth/register', [
            'name' => 'A',
            'identifier' => 'not-an-email-or-phone',
            'password' => 'short',
        ]);

        $response->assertStatus(422)->assertJsonPath('field', 'name');
    }

    public function test_register_cannot_grant_the_admin_role(): void
    {
        // Self-registration only ever creates cargo/truck owners — the admin
        // role can only be assigned by an existing admin through
        // PATCH /api/admin/users/{id}. Nobody may type themselves an admin.
        $response = $this->postJson('/api/auth/register', [
            'name' => 'Sneaky User',
            'identifier' => 'sneaky@example.com',
            'password' => 'secret123',
            'role' => 'admin',
        ]);

        $response->assertStatus(422)
            ->assertJsonPath('ok', false)
            ->assertJsonPath('field', 'role')
            ->assertJsonPath('message', 'Choose whether you own trucks or cargo');

        $this->assertNull($this->db->selectOne('users', ['identifier' => 'eq.sneaky@example.com']));

        // An unknown role value is rejected the same way.
        $this->postJson('/api/auth/register', [
            'name' => 'Sneaky Two',
            'identifier' => 'sneaky2@example.com',
            'password' => 'secret123',
            'role' => 'superuser',
        ])->assertStatus(422)->assertJsonPath('field', 'role');
    }

    public function test_login_returns_a_token_for_valid_credentials(): void
    {
        $user = $this->seedUser(['identifier' => 'amina@example.com']);

        $response = $this->postJson('/api/auth/login', [
            'identifier' => 'AMINA@example.com',
            'password' => $user['password'],
        ]);

        $response->assertOk()
            ->assertJsonPath('ok', true)
            ->assertJsonPath('user.identifier', 'amina@example.com');
        $this->assertNotEmpty($response->json('token'));
    }

    public function test_login_rejects_an_unknown_account_and_a_wrong_password(): void
    {
        $this->postJson('/api/auth/login', [
            'identifier' => 'ghost@example.com',
            'password' => 'secret123',
        ])->assertStatus(401)->assertJsonPath('field', 'identifier');

        $user = $this->seedUser(['identifier' => 'real@example.com']);

        $this->postJson('/api/auth/login', [
            'identifier' => $user['identifier'],
            'password' => 'wrong-password',
        ])->assertStatus(401)->assertJsonPath('field', 'password');
    }

    public function test_me_requires_a_valid_token(): void
    {
        $this->getJson('/api/auth/me')->assertStatus(401)->assertJsonPath('field', 'session');

        $user = $this->seedUser();
        $token = $this->tokenFor($user['id']);

        $this->withHeaders($this->bearer($token))
            ->getJson('/api/auth/me')
            ->assertOk()
            ->assertJsonPath('user.id', $user['id']);
    }

    public function test_a_token_whose_account_is_gone_is_rejected(): void
    {
        $user = $this->seedUser();
        $token = $this->tokenFor($user['id']);

        $this->db->tables['users'] = []; // account deleted upstream

        $this->withHeaders($this->bearer($token))
            ->getJson('/api/auth/me')
            ->assertStatus(401)
            ->assertJsonPath('message', 'Account no longer exists');
    }

    public function test_logout_revokes_the_token(): void
    {
        $user = $this->seedUser();
        $token = $this->tokenFor($user['id']);

        $this->withHeaders($this->bearer($token))
            ->postJson('/api/auth/logout')
            ->assertOk()
            ->assertJsonPath('ok', true);

        $this->withHeaders($this->bearer($token))
            ->getJson('/api/auth/me')
            ->assertStatus(401);
    }

    public function test_login_is_rate_limited_per_ip(): void
    {
        $payload = ['identifier' => 'nobody@example.com', 'password' => 'wrong'];

        for ($attempt = 0; $attempt < 10; $attempt++) {
            $this->postJson('/api/auth/login', $payload)->assertStatus(401);
        }

        $response = $this->postJson('/api/auth/login', $payload);

        $response->assertStatus(429)
            ->assertJsonPath('ok', false)
            ->assertJsonPath('field', 'form');

        $this->assertStringContainsString('Too many sign-in attempts', $response->json('message'));
    }
}
