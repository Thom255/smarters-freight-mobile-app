<?php

namespace Tests\Unit;

use App\Exceptions\DataStoreUnavailable;
use App\Services\SupabaseClient;
use Illuminate\Http\Client\RequestException;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * The real Supabase REST client (not the in-memory double the feature tests
 * use) has to turn every PostgREST failure into a DataStoreUnavailable.
 *
 * The reads are issued through Laravel's `retry()` helper, which converts any
 * non-2xx response into a RequestException before the response can be
 * inspected. Without an explicit unwrap the client let that exception escape,
 * so a 400 from PostgREST (for example selecting a column that does not
 * exist) became an unhandled 500 instead of the mapped, actionable failure —
 * and every `catch (DataStoreUnavailable)` fallback in the app was dead code.
 */
class SupabaseClientTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        config([
            'supabase.url' => 'https://fake-project.supabase.test',
            'supabase.service_key' => 'test-service-key',
        ]);
    }

    public function test_a_successful_read_returns_the_rows(): void
    {
        Http::fake([
            'https://fake-project.supabase.test/rest/v1/users*' => Http::response([
                ['id' => 'u1', 'identifier' => 'a@example.com'],
                ['id' => 'u2', 'identifier' => 'b@example.com'],
            ]),
        ]);

        $rows = app(SupabaseClient::class)->select('users', ['select' => 'id,identifier']);

        $this->assertCount(2, $rows);
        $this->assertSame('a@example.com', $rows[0]['identifier']);
    }

    public function test_a_rejected_read_becomes_a_data_store_failure(): void
    {
        Http::fake([
            'https://fake-project.supabase.test/rest/v1/users*' => Http::response([
                'code' => '42703',
                'message' => 'column users.status does not exist',
            ], 400),
        ]);

        try {
            app(SupabaseClient::class)->select('users', ['select' => 'id,status']);
            $this->fail('Expected a DataStoreUnavailable.');
        } catch (DataStoreUnavailable $e) {
            $this->assertStringContainsString('column users.status does not exist', $e->getMessage());
            $this->assertSame(500, $e->status());
            $this->assertNotInstanceOf(RequestException::class, $e);
        }
    }

    public function test_a_missing_table_points_at_the_setup_sql(): void
    {
        Http::fake([
            'https://fake-project.supabase.test/rest/v1/cargo*' => Http::response([
                'code' => '42P01',
                'message' => 'relation "public.cargo" does not exist',
            ], 400),
        ]);

        $this->expectException(DataStoreUnavailable::class);
        $this->expectExceptionMessage('Run supabase_schema.sql in the Supabase SQL Editor first.');

        app(SupabaseClient::class)->select('cargo', ['select' => 'id']);
    }

    public function test_an_upstream_outage_is_reported_as_a_gateway_fault(): void
    {
        Http::fake([
            'https://fake-project.supabase.test/rest/v1/users*' => Http::response('boom', 502),
        ]);

        try {
            app(SupabaseClient::class)->select('users');
            $this->fail('Expected a DataStoreUnavailable.');
        } catch (DataStoreUnavailable $e) {
            $this->assertSame(502, $e->status());
        }
    }

    public function test_a_rejected_write_becomes_a_data_store_failure(): void
    {
        Http::fake([
            'https://fake-project.supabase.test/rest/v1/users*' => Http::response([
                'code' => '23505',
                'message' => 'duplicate key value violates unique constraint',
            ], 409),
        ]);

        try {
            app(SupabaseClient::class)->insert('users', ['identifier' => 'a@example.com']);
            $this->fail('Expected a DataStoreUnavailable.');
        } catch (DataStoreUnavailable $e) {
            $this->assertStringContainsString('duplicate key value', $e->getMessage());
            $this->assertSame(500, $e->status());
        }
    }
}
