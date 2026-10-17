<?php

namespace Tests\Feature;

/**
 * The Expo web build runs in a browser, so every login is a preflighted
 * cross-origin request. Getting these headers wrong shows up in the app as
 * "Cannot reach the server" even though the API is perfectly healthy — these
 * tests keep the headers honest.
 */
class CorsTest extends ApiTestCase
{
    public function test_a_preflight_from_any_origin_is_accepted(): void
    {
        foreach (['http://localhost:8081', 'http://192.168.1.102:8081', 'http://example.test'] as $origin) {
            $response = $this->sendPreflight($origin);

            $response->assertStatus(204);
            $this->assertNotEmpty(
                $response->headers->get('Access-Control-Allow-Origin'),
                "Preflight from {$origin} was not allowed.",
            );
        }
    }

    public function test_a_chrome_private_network_preflight_is_answered(): void
    {
        $response = $this->withHeaders([
            'Origin' => 'http://localhost:8081',
            'Access-Control-Request-Method' => 'POST',
            'Access-Control-Request-Headers' => 'content-type',
            'Access-Control-Request-Private-Network' => 'true',
        ])->options('/api/auth/login');

        $response->assertStatus(204);
        $this->assertSame('true', $response->headers->get('Access-Control-Allow-Private-Network'));
    }

    public function test_preflights_are_cached_instead_of_repeated(): void
    {
        $maxAge = $this->sendPreflight('http://localhost:8081')->headers->get('Access-Control-Max-Age');

        $this->assertNotSame('0', (string) $maxAge);
        $this->assertGreaterThan(0, (int) $maxAge);
    }

    private function sendPreflight(string $origin)
    {
        return $this->withHeaders([
            'Origin' => $origin,
            'Access-Control-Request-Method' => 'POST',
            'Access-Control-Request-Headers' => 'content-type,accept',
        ])->options('/api/auth/login');
    }
}
