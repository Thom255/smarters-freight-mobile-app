<?php

namespace App\Services;

use App\Exceptions\DataStoreUnavailable;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Pool;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Http;

/**
 * Minimal Supabase REST (PostgREST) client.
 *
 * The backend never opens a database socket: every read/write goes through
 * {SUPABASE_URL}/rest/v1 with the service-role key from config/supabase.php.
 * Query syntax is PostgREST's:  identifier=eq.value,  order=created_at.desc,
 * limit=1,  select=col1,col2,  Prefer: return=representation, etc.
 */
class SupabaseClient
{
    /**
     * Keep every Supabase call well under PHP's 30s script limit (cli-server
     * SAPI kills the request at 30s on Windows). A healthy round trip is
     * ~0.5s; anything near these caps means the network is misbehaving, so we
     * cut the call short and (for idempotent methods) retry once.
     */
    private const CONNECT_TIMEOUT = 5;   // seconds to open the TCP/TLS connection

    private const TIMEOUT = 10;          // seconds to finish the request

    private const RETRY_TIMES = 2;       // attempts for GET/HEAD/DELETE

    private string $baseUrl;

    private string $serviceKey;

    public function __construct()
    {
        $this->baseUrl = rtrim((string) config('supabase.url'), '/');
        $this->serviceKey = (string) config('supabase.service_key');

        if ($this->baseUrl === '' || $this->serviceKey === '') {
            throw new DataStoreUnavailable(
                'Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_KEY in backend/.env',
                503
            );
        }
    }

    /**
     * GET rows. $query is PostgREST query params, e.g.
     * ['select' => '*', 'identifier' => 'eq.amin@x.com', 'limit' => 1].
     *
     * @return array<int, array<string, mixed>>
     */
    public function select(string $table, array $query = []): array
    {
        return $this->request('GET', $table, $query);
    }

    /**
     * First matching row or null.
     *
     * @return array<string, mixed>|null
     */
    public function selectOne(string $table, array $query = []): ?array
    {
        $query['limit'] = 1;
        $rows = $this->select($table, $query);

        return $rows[0] ?? null;
    }

    /**
     * POST a row, returning the inserted representation.
     *
     * @param  array<string, mixed>  $values
     * @return array<string, mixed>
     */
    public function insert(string $table, array $values): array
    {
        $rows = $this->request('POST', $table, [], $values, [
            'Prefer' => 'return=representation',
        ]);

        return $rows[0] ?? [];
    }

    /**
     * PATCH rows matching a PostgREST filter column, e.g. $column = 'id',
     * $equals = 'eq.<uuid>'.
     *
     * @param  array<string, mixed>  $values
     * @return array<int, array<string, mixed>>
     */
    public function update(string $table, string $column, string $equals, array $values): array
    {
        return $this->updateMatching($table, [$column => $equals], $values);
    }

    /**
     * PATCH rows that match EVERY filter (PostgREST combines them with AND),
     * e.g. ['id' => 'eq.<uuid>', 'status' => 'eq.available'].
     *
     * Returns the updated representations — an empty array means no row
     * matched the predicate. Callers use that as a compare-and-set: the
     * database only applies the update when the row is still in the expected
     * state, so two concurrent requests cannot both win.
     *
     * @param  array<string, string>  $filters
     * @param  array<string, mixed>  $values
     * @return array<int, array<string, mixed>>
     */
    public function updateMatching(string $table, array $filters, array $values): array
    {
        return $this->request(
            'PATCH',
            $table,
            $filters,
            $values,
            ['Prefer' => 'return=representation']
        );
    }

    /**
     * DELETE rows matching a filter. Returns nothing.
     *
     * @param  array<string, mixed>  $query  extra query params (e.g. 'select' => 'id')
     */
    public function delete(string $table, string $column, string $equals, array $query = []): void
    {
        $this->request('DELETE', $table, array_merge([$column => $equals], $query));
    }

    /**
     * Several independent GET reads issued at the same time.
     *
     * A single PostgREST round trip costs ~1s from this host, and a request
     * like the dashboard needs five of them. Running them concurrently turns
     * that wall clock from "sum of round trips" into "the slowest one".
     *
     * @param  array<string, array{table: string, query?: array<string, string>}>  $reads
     * @return array<string, array<int, array<string, mixed>>>
     */
    public function selectMany(array $reads): array
    {
        if ($reads === []) {
            return [];
        }

        $responses = Http::pool(function (Pool $pool) use ($reads): void {
            foreach ($reads as $key => $read) {
                $pool->as($key)
                    ->withHeaders($this->headers())
                    ->withOptions(['http_errors' => false])
                    ->connectTimeout(self::CONNECT_TIMEOUT)
                    ->timeout(self::TIMEOUT)
                    ->get($this->url($read['table']), $read['query'] ?? []);
            }
        });

        $decoded = [];
        foreach ($reads as $key => $read) {
            $response = $responses[$key] ?? null;

            if ($response instanceof ConnectionException) {
                throw new DataStoreUnavailable('Cannot reach Supabase REST API: '.$response->getMessage(), 503, $response);
            }

            if ($response instanceof \Throwable) {
                throw $response;
            }

            if (! $response instanceof Response) {
                throw new DataStoreUnavailable("Supabase pool returned no response for '{$read['table']}'", 502);
            }

            if ($response->failed()) {
                throw $this->toException($read['table'], $response);
            }

            $rows = $response->json();
            $decoded[$key] = is_array($rows) ? $rows : [];
        }

        return $decoded;
    }

    /**
     * Exact row count via PostgREST's Prefer: count=exact (HEAD request).
     *
     * @param  array<string, mixed>  $query
     */
    public function count(string $table, array $query = []): int
    {
        $response = Http::withHeaders($this->headers())
            ->withOptions(['http_errors' => false])
            ->withHeaders(['Prefer' => 'count=exact'])
            ->send('HEAD', $this->url($table), ['query' => $query]);

        if ($response->failed()) {
            throw $this->toException($table, $response);
        }

        // PostgREST returns e.g. "0-0/42" or "*/42".
        $contentRange = (string) $response->header('Content-Range');
        $parts = explode('/', $contentRange);

        return isset($parts[1]) && is_numeric($parts[1]) ? (int) $parts[1] : 0;
    }

    /**
     * Call a PostgREST database function: POST /rest/v1/rpc/{function}.
     *
     * Used for the transactional booking operations (accept/cancel), which
     * mutate several rows at once — something the REST interface cannot do in
     * a single round trip. The function returns a JSON object.
     *
     * @param  array<string, mixed>  $params
     * @return array<string, mixed>
     */
    public function rpc(string $function, array $params = []): array
    {
        try {
            $response = Http::withHeaders($this->headers())
                ->withOptions(['http_errors' => false])
                ->connectTimeout(self::CONNECT_TIMEOUT)
                ->timeout(self::TIMEOUT)
                ->post($this->baseUrl.'/rest/v1/rpc/'.rawurlencode($function), $params);
        } catch (ConnectionException $e) {
            throw new DataStoreUnavailable('Cannot reach Supabase REST API: '.$e->getMessage(), 503, $e);
        }

        if ($response->failed()) {
            throw $this->toException($function, $response);
        }

        $decoded = $response->json();

        return is_array($decoded) ? $decoded : [];
    }

    /**
     * @param  array<string, mixed>  $query
     * @param  array<string, mixed>|null  $body
     * @param  array<string, string>  $extraHeaders
     * @return array<int, array<string, mixed>>
     */
    private function request(
        string $method,
        string $table,
        array $query = [],
        ?array $body = null,
        array $extraHeaders = []
    ): array {
        try {
            $pending = Http::withHeaders(array_merge($this->headers(), $extraHeaders))
                ->withOptions(['http_errors' => false])
                ->connectTimeout(self::CONNECT_TIMEOUT)
                ->timeout(self::TIMEOUT);

            // Retry only idempotent reads/deletes: a retried POST could
            // duplicate a row if the connection dropped after the insert.
            if (in_array($method, ['GET', 'HEAD', 'DELETE'], true)) {
                $pending = $pending->retry(
                    self::RETRY_TIMES,
                    250,
                    fn ($e) => $e instanceof ConnectionException
                );
            }

            $pending = $pending->send($method, $this->url($table), array_filter([
                'query' => $query === [] ? null : $query,
                'json' => $body,
            ], fn ($value) => $value !== null));
        } catch (ConnectionException $e) {
            throw new DataStoreUnavailable('Cannot reach Supabase REST API: '.$e->getMessage(), 503, $e);
        }

        if ($pending->failed()) {
            throw $this->toException($table, $pending);
        }

        $decoded = $pending->json();

        return is_array($decoded) ? $decoded : [];
    }

    private function url(string $table): string
    {
        return $this->baseUrl.'/rest/v1/'.rawurlencode($table);
    }

    /** @return array<string, string> */
    private function headers(): array
    {
        return [
            'apikey' => $this->serviceKey,
            'Authorization' => 'Bearer '.$this->serviceKey,
            'Content-Type' => 'application/json',
        ];
    }

    private function toException(string $table, $response): DataStoreUnavailable
    {
        $status = $response->status();
        $message = $response->json('message') ?? $response->json('error_description')
            ?? trim($response->body());

        // Table missing → most likely the SQL file has not been run yet.
        if (str_contains((string) $message, 'relation') && str_contains((string) $message, 'does not exist')) {
            return new DataStoreUnavailable(
                "Supabase table missing for '{$table}'. Run supabase_schema.sql in the Supabase SQL Editor first.",
                500
            );
        }

        return new DataStoreUnavailable(
            "Supabase REST error ({$status}) on '{$table}': {$message}",
            // Upstream 5xx is a gateway fault; anything else is a server-side
            // misconfiguration (bad key, missing column, revoked permission).
            $status >= 500 ? 502 : 500
        );
    }
}
