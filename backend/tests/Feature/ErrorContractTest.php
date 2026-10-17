<?php

namespace Tests\Feature;

use App\Services\SupabaseClient;
use Tests\Support\FakeSupabaseClient;

/**
 * Every failure — validation, auth, routing, or a crash — must come back as
 * { ok:false, field, message } with no stack traces or internals, because the
 * app renders `message` straight to the user.
 */
class ErrorContractTest extends ApiTestCase
{
    public function test_unknown_api_routes_use_the_mobile_contract(): void
    {
        $response = $this->getJson('/api/does-not-exist');

        $response->assertStatus(404)
            ->assertJsonPath('ok', false)
            ->assertJsonPath('field', 'form')
            ->assertJsonPath('message', 'Endpoint not found');
    }

    public function test_wrong_method_on_an_api_route_uses_the_mobile_contract(): void
    {
        $this->deleteJson('/api/auth/login')
            ->assertStatus(405)
            ->assertJsonPath('ok', false)
            ->assertJsonPath('field', 'form');
    }

    public function test_an_unexpected_server_error_never_leaks_internals(): void
    {
        $user = $this->seedUser();
        $token = $this->tokenFor($user['id']);

        // Supabase unreachable — the failure mode that used to produce a debug page.
        $broken = new class extends FakeSupabaseClient
        {
            public function select(string $table, array $query = []): array
            {
                throw new \RuntimeException('Cannot reach Supabase REST API: cURL error 28', 503);
            }
        };
        $this->app->instance(SupabaseClient::class, $broken);

        $response = $this->withHeaders($this->bearer($token))->getJson('/api/shipments');

        $response->assertStatus(500)
            ->assertJsonPath('ok', false)
            ->assertJsonPath('field', 'form')
            ->assertJsonPath('message', 'Something went wrong on our side. Please try again.');

        $body = $response->getContent();
        foreach (['trace', 'exception', 'Supabase', 'cURL', 'vendor', '.php'] as $leak) {
            $this->assertStringNotContainsString($leak, $body, "Response leaked \"{$leak}\".");
        }
    }

    public function test_missing_fields_keep_the_field_aware_error_shape(): void
    {
        $response = $this->postJson('/api/auth/login', []);

        $response->assertStatus(422)
            ->assertJsonPath('ok', false)
            ->assertJsonPath('field', 'identifier')
            ->assertJsonPath('message', 'Enter your email or phone number');
    }
}
