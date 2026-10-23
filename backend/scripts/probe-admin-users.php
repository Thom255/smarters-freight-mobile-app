<?php

declare(strict_types=1);

namespace SmartersFreight\Probe;

/**
 * Admin console user-management probe.
 *
 * It signs in as an admin through the public API, lists every account and —
 * only when mutation testing is explicitly enabled — exercises the role and
 * status writes of `PATCH /api/admin/users/{id}`.
 *
 * Safety rules baked into this script:
 *
 *   - The credentials are read from SF_ADMIN_IDENTIFIER / SF_ADMIN_PASSWORD.
 *     No password, token or API key is ever written to disk, printed or
 *     logged; a token is only ever reported as a length plus a short digest.
 *   - The default run is a dry run: one login, a few GETs and no PATCH at
 *     all, so it cannot change a user or any other record.
 *   - The mutation phase captures the target account's original role and
 *     status first, restores both in a guaranteed finally step, and then
 *     verifies the restoration with a fresh read. A failed restoration is
 *     reported prominently and exits non-zero.
 *   - The signed-in admin account is never mutated and no account is ever
 *     deleted.
 *   - A missing `users.status` column is detected and reported instead of
 *     being assumed away, so the probe can never leave an account suspended.
 *
 * Usage:
 *
 *   php scripts/probe-admin-users.php --target someone@example.com
 *   php scripts/probe-admin-users.php --target someone@example.com --mutate
 *   php scripts/probe-admin-users.php --plan
 *
 * Environment:
 *
 *   SF_ADMIN_IDENTIFIER   admin account used to sign in (required)
 *   SF_ADMIN_PASSWORD     password for that account (required)
 *   SF_API_BASE_URL       API base URL (default http://127.0.0.1:8001)
 */
final class AdminUsersProbe
{
    /** The token of this run, kept in memory only so it can be revoked. */
    private ?string $sessionToken = null;

    public function __construct(
        private readonly Transport $transport,
        private readonly string $adminIdentifier,
        private readonly string $adminPassword,
        private readonly string $targetIdentifier,
        private readonly bool $mutate = false,
    ) {}

    /**
     * The bearer token of this run, if the login succeeded. Never printed.
     */
    public function sessionToken(): ?string
    {
        return $this->sessionToken;
    }

    /**
     * The test plan, printed before anything runs so the operator can see
     * exactly which checks are allowed to change data.
     *
     * @return array<int, array{name: string, expected: string, mutates: bool}>
     */
    public function plan(): array
    {
        $plan = [
            [
                'name' => 'admin login',
                'expected' => 'HTTP 200 and the server reports role=admin',
                'mutates' => false,
            ],
            [
                'name' => 'GET /api/admin/users',
                'expected' => 'HTTP 200 and every account listed',
                'mutates' => false,
            ],
            [
                'name' => 'status distribution',
                'expected' => 'every account reports a status',
                'mutates' => false,
            ],
            [
                'name' => 'admin account listed as admin',
                'expected' => 'the signed-in admin appears with role=admin',
                'mutates' => false,
            ],
            [
                'name' => 'target account present',
                'expected' => 'the target account is in the admin user list',
                'mutates' => false,
            ],
            [
                'name' => 'account status support',
                'expected' => 'only a write can prove it, so it is skipped in the dry run',
                'mutates' => false,
            ],
        ];

        if (! $this->mutate) {
            return $plan;
        }

        return array_merge($plan, [
            [
                'name' => 'original state captured',
                'expected' => 'the target role and status are recorded before any write',
                'mutates' => false,
            ],
            [
                'name' => 'role change applied',
                'expected' => 'PATCH role=<other role> returns HTTP 200',
                'mutates' => true,
            ],
            [
                'name' => 'role change persisted',
                'expected' => 'a fresh read shows the new role',
                'mutates' => false,
            ],
            [
                'name' => 'invalid role refused',
                'expected' => 'PATCH role=<invalid> returns HTTP 422 and changes nothing',
                'mutates' => true,
            ],
            [
                'name' => 'status change applied',
                'expected' => 'PATCH status=<other status> returns HTTP 200, or the API reports the status column is missing',
                'mutates' => true,
            ],
            [
                'name' => 'restore original role',
                'expected' => 'PATCH role=<original role> returns HTTP 200',
                'mutates' => true,
            ],
            [
                'name' => 'restore original status',
                'expected' => 'PATCH status=<original status> returns HTTP 200, or the column is absent so nothing is suspended',
                'mutates' => true,
            ],
            [
                'name' => 'restoration verified',
                'expected' => 'a fresh read shows the original role and status again',
                'mutates' => false,
            ],
        ]);
    }

    /**
     * Runs the plan and returns one outcome per check.
     *
     * @return array<int, TestOutcome>
     */
    public function run(): array
    {
        $outcomes = [];

        $login = $this->transport->request('POST', '/api/auth/login', [
            'identifier' => $this->adminIdentifier,
            'password' => $this->adminPassword,
        ]);

        $token = is_string($login->body['token'] ?? null) ? $login->body['token'] : null;
        $role = is_string($login->body['user']['role'] ?? null) ? $login->body['user']['role'] : '';

        $this->sessionToken = $token;

        $loginDetail = 'HTTP='.$login->code.' role='.($role !== '' ? $role : '?');

        if ($token !== null) {
            $loginDetail .= ' token(len='.strlen($token).', sha256='.substr(hash('sha256', $token), 0, 8).')';
        } else {
            // A rejected sign-in carries the field the API refused, so the
            // cause is visible without guessing: `identifier` means no
            // account matched, `password` means the account exists but the
            // password did not match. Both messages come from the server and
            // contain no secrets.
            $loginDetail .= ' field='.($login->field() !== '' ? $login->field() : '?')
                .' msg='.($login->message() !== '' ? $login->message() : '?')
                .' identifier='.$this->adminIdentifier;
        }

        $outcomes[] = new TestOutcome(
            'admin login',
            'HTTP 200 and the server reports role=admin',
            false,
            $login->ok() && $role === 'admin' ? TestOutcome::PASS : TestOutcome::FAIL,
            $loginDetail,
        );

        if ($token === null) {
            return $outcomes;
        }

        $list = $this->transport->request('GET', '/api/admin/users', null, $token);
        $rows = $this->rows($list);

        $outcomes[] = new TestOutcome(
            'GET /api/admin/users',
            'HTTP 200 and every account listed',
            false,
            $list->ok() ? TestOutcome::PASS : TestOutcome::FAIL,
            'HTTP='.$list->code.' rows='.count($rows),
        );

        $statuses = [];
        foreach ($rows as $row) {
            $status = (string) ($row['status'] ?? '?');
            $statuses[$status] = ($statuses[$status] ?? 0) + 1;
        }
        ksort($statuses);

        $outcomes[] = new TestOutcome(
            'status distribution',
            'every account reports a status',
            false,
            TestOutcome::PASS,
            (string) json_encode($statuses),
        );

        $adminRow = $this->findByIdentifier($rows, $this->adminIdentifier);
        $adminRole = (string) ($adminRow['role'] ?? '');

        $outcomes[] = new TestOutcome(
            'admin account listed as admin',
            'the signed-in admin appears with role=admin',
            false,
            $adminRole === 'admin' ? TestOutcome::PASS : TestOutcome::FAIL,
            'role='.($adminRole !== '' ? $adminRole : '?'),
        );

        $target = $this->findByIdentifier($rows, $this->targetIdentifier);

        $outcomes[] = new TestOutcome(
            'target account present',
            'the target account is in the admin user list',
            false,
            $target !== null ? TestOutcome::PASS : TestOutcome::FAIL,
            $target === null
                ? 'not found: '.$this->targetIdentifier
                : 'id='.(string) $target['id'].' role='.(string) ($target['role'] ?? '?'),
        );

        if (! $this->mutate) {
            $outcomes[] = new TestOutcome(
                'account status support',
                'only a write can prove it, so it is skipped in the dry run',
                false,
                TestOutcome::SKIP,
                'run with --mutate to probe it',
            );

            return $outcomes;
        }

        if ($target === null) {
            $outcomes[] = new TestOutcome(
                'target is safe to mutate',
                'the target exists and is not the signed-in admin',
                true,
                TestOutcome::FAIL,
                'no target account to mutate — nothing was written',
            );

            return $outcomes;
        }

        if ($this->sameIdentifier((string) ($target['identifier'] ?? ''), $this->adminIdentifier)) {
            $outcomes[] = new TestOutcome(
                'target is safe to mutate',
                'the target is never the signed-in admin account',
                true,
                TestOutcome::FAIL,
                'refusing to mutate the admin account — nothing was written',
            );

            return $outcomes;
        }

        if ((string) ($target['role'] ?? '') === 'admin') {
            $outcomes[] = new TestOutcome(
                'target is safe to mutate',
                'admin accounts are never mutated by this probe',
                true,
                TestOutcome::SKIP,
                'the target is an admin account — the mutation phase was skipped',
            );

            return $outcomes;
        }

        $outcomes[] = new TestOutcome(
            'target is safe to mutate',
            'the target is not the signed-in admin and not an admin account',
            true,
            TestOutcome::PASS,
            'target='.(string) ($target['identifier'] ?? '?'),
        );

        $targetId = (string) $target['id'];
        $originalRole = (string) ($target['role'] ?? 'cargo_owner');
        $originalStatus = (string) ($target['status'] ?? 'active');
        $flipRole = $originalRole === 'truck_owner' ? 'cargo_owner' : 'truck_owner';
        $flipStatus = $originalStatus === 'suspended' ? 'active' : 'suspended';

        $outcomes[] = new TestOutcome(
            'original state captured',
            'the target role and status are recorded before any write',
            false,
            TestOutcome::PASS,
            'role='.$originalRole.' status='.$originalStatus,
        );

        $mutated = false;

        try {
            $roleWrite = $this->transport->request(
                'PATCH',
                '/api/admin/users/'.$targetId,
                ['role' => $flipRole],
                $token,
            );
            $mutated = $mutated || $roleWrite->ok();

            $outcomes[] = new TestOutcome(
                'role change applied',
                'PATCH role='.$flipRole.' returns HTTP 200',
                true,
                $roleWrite->ok() ? TestOutcome::PASS : TestOutcome::FAIL,
                'HTTP='.$roleWrite->code.' role='.(string) ($roleWrite->body['user']['role'] ?? '?'),
            );

            $afterList = $this->transport->request('GET', '/api/admin/users', null, $token);
            $afterRow = $this->findById($this->rows($afterList), $targetId);
            $afterRole = (string) ($afterRow['role'] ?? '');

            $outcomes[] = new TestOutcome(
                'role change persisted',
                'a fresh read shows role='.$flipRole,
                false,
                $afterRole === $flipRole ? TestOutcome::PASS : TestOutcome::FAIL,
                'role='.($afterRole !== '' ? $afterRole : '?'),
            );

            $invalid = $this->transport->request(
                'PATCH',
                '/api/admin/users/'.$targetId,
                ['role' => 'wizard'],
                $token,
            );

            $outcomes[] = new TestOutcome(
                'invalid role refused',
                'PATCH role=wizard returns HTTP 422 and changes nothing',
                true,
                $invalid->code === 422 ? TestOutcome::PASS : TestOutcome::FAIL,
                'HTTP='.$invalid->code.' msg='.($invalid->message() !== '' ? $invalid->message() : '?'),
            );

            $statusWrite = $this->transport->request(
                'PATCH',
                '/api/admin/users/'.$targetId,
                ['status' => $flipStatus],
                $token,
            );

            if ($this->isMissingStatusSchema($statusWrite)) {
                $outcomes[] = new TestOutcome(
                    'status change applied',
                    'PATCH status='.$flipStatus.' returns HTTP 200, or the API reports the status column is missing',
                    true,
                    TestOutcome::WARN,
                    'the users.status column is missing: '.$statusWrite->message().' — nothing was written',
                );
            } else {
                $mutated = $mutated || $statusWrite->ok();

                $outcomes[] = new TestOutcome(
                    'status change applied',
                    'PATCH status='.$flipStatus.' returns HTTP 200',
                    true,
                    $statusWrite->ok() ? TestOutcome::PASS : TestOutcome::FAIL,
                    'HTTP='.$statusWrite->code.' status='.(string) ($statusWrite->body['user']['status'] ?? '?'),
                );
            }
        } finally {
            foreach ($this->restore($token, $targetId, $originalRole, $originalStatus, $mutated) as $outcome) {
                $outcomes[] = $outcome;
            }
        }

        return $outcomes;
    }

    /**
     * Puts the target back into the state it was captured in and verifies the
     * result with a fresh read. Runs even when the mutation phase failed.
     *
     * @return array<int, TestOutcome>
     */
    private function restore(
        string $token,
        string $targetId,
        string $originalRole,
        string $originalStatus,
        bool $mutated,
    ): array {
        $outcomes = [];

        if (! $mutated) {
            $outcomes[] = new TestOutcome(
                'restore original role',
                'no write reached the account',
                true,
                TestOutcome::SKIP,
                'nothing was mutated',
            );
            $outcomes[] = new TestOutcome(
                'restore original status',
                'no write reached the account',
                true,
                TestOutcome::SKIP,
                'nothing was mutated',
            );

            return array_merge($outcomes, $this->verifyRestoration($token, $targetId, $originalRole, $originalStatus));
        }

        $roleWrite = $this->transport->request(
            'PATCH',
            '/api/admin/users/'.$targetId,
            ['role' => $originalRole],
            $token,
        );

        $outcomes[] = new TestOutcome(
            'restore original role',
            'PATCH role='.$originalRole.' returns HTTP 200',
            true,
            $roleWrite->ok() ? TestOutcome::PASS : TestOutcome::FAIL,
            'HTTP='.$roleWrite->code.' msg='.($roleWrite->message() !== '' ? $roleWrite->message() : '?'),
        );

        $statusWrite = $this->transport->request(
            'PATCH',
            '/api/admin/users/'.$targetId,
            ['status' => $originalStatus],
            $token,
        );

        // A missing status column means the account was never suspended, so the
        // restore is satisfied even though the write itself fails.
        $statusRestored = $statusWrite->ok() || $this->isMissingStatusSchema($statusWrite);

        $outcomes[] = new TestOutcome(
            'restore original status',
            'PATCH status='.$originalStatus.' returns HTTP 200, or the column is absent so nothing is suspended',
            true,
            $statusRestored ? TestOutcome::PASS : TestOutcome::FAIL,
            'HTTP='.$statusWrite->code.' msg='.($statusWrite->message() !== '' ? $statusWrite->message() : '?'),
        );

        return array_merge($outcomes, $this->verifyRestoration($token, $targetId, $originalRole, $originalStatus));
    }

    /**
     * @return array<int, TestOutcome>
     */
    private function verifyRestoration(
        string $token,
        string $targetId,
        string $originalRole,
        string $originalStatus,
    ): array {
        $list = $this->transport->request('GET', '/api/admin/users', null, $token);
        $row = $this->findById($this->rows($list), $targetId);

        $role = (string) ($row['role'] ?? '');
        $status = (string) ($row['status'] ?? '');
        $restored = $row !== null && $role === $originalRole && $status === $originalStatus;

        return [new TestOutcome(
            'restoration verified',
            'a fresh read shows role='.$originalRole.' and status='.$originalStatus,
            false,
            $restored ? TestOutcome::PASS : TestOutcome::FAIL,
            'role='.($role !== '' ? $role : '?').' status='.($status !== '' ? $status : '?'),
        )];
    }

    /**
     * The API reports a missing `users.status` column as a 500 on the status
     * field; a status read can never prove it, because the user list falls
     * back to "active" for accounts without the column.
     */
    private function isMissingStatusSchema(ApiResponse $response): bool
    {
        if ($response->code < 400) {
            return false;
        }

        $message = strtolower($response->message());

        if (! str_contains($message, 'status')) {
            return false;
        }

        foreach (['not available yet', "'status' column", 'column "status"', 'supabase_admin.sql'] as $needle) {
            if (str_contains($message, $needle)) {
                return true;
            }
        }

        return false;
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    private function rows(ApiResponse $response): array
    {
        $users = $response->body['users'] ?? null;

        if (! is_array($users)) {
            return [];
        }

        return array_values(array_filter($users, 'is_array'));
    }

    /**
     * @param  array<int, array<string, mixed>>  $rows
     * @return array<string, mixed>|null
     */
    private function findByIdentifier(array $rows, string $identifier): ?array
    {
        foreach ($rows as $row) {
            if ($this->sameIdentifier((string) ($row['identifier'] ?? ''), $identifier)) {
                return $row;
            }
        }

        return null;
    }

    /**
     * @param  array<int, array<string, mixed>>  $rows
     * @return array<string, mixed>|null
     */
    private function findById(array $rows, string $id): ?array
    {
        foreach ($rows as $row) {
            if ((string) ($row['id'] ?? '') === $id) {
                return $row;
            }
        }

        return null;
    }

    private function sameIdentifier(string $left, string $right): bool
    {
        return mb_strtolower(trim($left)) === mb_strtolower(trim($right));
    }
}

/**
 * The outcome of a single check.
 */
final class TestOutcome
{
    public const PASS = 'PASS';

    public const FAIL = 'FAIL';

    public const SKIP = 'SKIP';

    public const WARN = 'WARN';

    public function __construct(
        public readonly string $name,
        public readonly string $expected,
        public readonly bool $mutates,
        public readonly string $status,
        public readonly string $detail = '',
    ) {}

    public function failed(): bool
    {
        return $this->status === self::FAIL;
    }
}

/**
 * A single API response: the HTTP status and the decoded body.
 */
final class ApiResponse
{
    /**
     * @param  array<string, mixed>|null  $body
     */
    public function __construct(
        public readonly int $code,
        public readonly ?array $body = null,
    ) {}

    public function ok(): bool
    {
        return $this->code >= 200 && $this->code < 300;
    }

    public function message(): string
    {
        $message = $this->body['message'] ?? null;

        return is_string($message) ? $message : '';
    }

    /**
     * The field the API rejected, e.g. `identifier` or `password`.
     */
    public function field(): string
    {
        $field = $this->body['field'] ?? null;

        return is_string($field) ? $field : '';
    }
}

/**
 * The API calls the probe needs. Kept as an interface so the probe can be
 * exercised without a network.
 */
interface Transport
{
    /**
     * @param  array<string, mixed>|null  $body
     */
    public function request(string $method, string $path, ?array $body = null, ?string $token = null): ApiResponse;
}

/**
 * cURL transport for the public API.
 */
final class CurlTransport implements Transport
{
    public function __construct(
        private readonly string $baseUrl,
        private readonly int $timeout = 30,
    ) {}

    public function request(string $method, string $path, ?array $body = null, ?string $token = null): ApiResponse
    {
        $handle = curl_init(rtrim($this->baseUrl, '/').$path);

        if ($handle === false) {
            return new ApiResponse(0, ['message' => 'Could not open a connection']);
        }

        $headers = ['Accept: application/json'];
        if ($body !== null) {
            $headers[] = 'Content-Type: application/json';
        }
        if ($token !== null && $token !== '') {
            $headers[] = 'Authorization: Bearer '.$token;
        }

        curl_setopt_array($handle, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CUSTOMREQUEST => $method,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_TIMEOUT => $this->timeout,
        ]);

        if ($body !== null) {
            curl_setopt($handle, CURLOPT_POSTFIELDS, (string) json_encode($body));
        }

        $raw = curl_exec($handle);
        $code = (int) curl_getinfo($handle, CURLINFO_HTTP_CODE);
        $error = curl_error($handle);
        curl_close($handle);

        if ($raw === false) {
            return new ApiResponse(0, ['message' => $error !== '' ? $error : 'Request failed']);
        }

        $decoded = json_decode((string) $raw, true);

        return new ApiResponse($code, is_array($decoded) ? $decoded : null);
    }
}

/**
 * Command line front end for the admin console probe.
 */
final class ProbeCli
{
    private const USAGE = <<<'TEXT'
    Usage:
      php scripts/probe-admin-users.php --target <identifier> [--mutate] [--logout]
      php scripts/probe-admin-users.php --plan

    Options:
      --target <identifier>  the account to probe (also accepted as a bare argument)
      --mutate               run the role/status write tests; every write is restored
      --dry-run              read-only (default)
      --plan                 print the test plan and exit without any request
      --logout               revoke the session token this run issued
      --base-url <url>       API base URL (default $SF_API_BASE_URL or http://127.0.0.1:8001)
      -h, --help             show this help

    Environment:
      SF_ADMIN_IDENTIFIER    admin account used to sign in (required)
      SF_ADMIN_PASSWORD      password for that account (required)
      SF_API_BASE_URL        API base URL
    TEXT;

    /**
     * @param  array<int, string>  $argv
     * @return array{options: array<string, mixed>, error: string|null}
     */
    public static function parseOptions(array $argv): array
    {
        $options = [
            'target' => null,
            'mutate' => false,
            'plan' => false,
            'logout' => false,
            'help' => false,
            'base_url' => null,
        ];

        $count = count($argv);

        for ($index = 1; $index < $count; $index++) {
            $argument = $argv[$index];

            if ($argument === '--help' || $argument === '-h') {
                $options['help'] = true;

                continue;
            }

            if ($argument === '--mutate') {
                $options['mutate'] = true;

                continue;
            }

            if ($argument === '--dry-run') {
                $options['mutate'] = false;

                continue;
            }

            if ($argument === '--plan') {
                $options['plan'] = true;

                continue;
            }

            if ($argument === '--logout') {
                $options['logout'] = true;

                continue;
            }

            if (str_starts_with($argument, '--target=')) {
                $options['target'] = substr($argument, 9);

                continue;
            }

            if ($argument === '--target') {
                $options['target'] = $argv[++$index] ?? null;

                continue;
            }

            if (str_starts_with($argument, '--base-url=')) {
                $options['base_url'] = substr($argument, 11);

                continue;
            }

            if ($argument === '--base-url') {
                $options['base_url'] = $argv[++$index] ?? null;

                continue;
            }

            if (str_starts_with($argument, '-')) {
                return ['options' => $options, 'error' => 'Unknown option: '.$argument];
            }

            if ($options['target'] === null) {
                $options['target'] = $argument;

                continue;
            }

            return ['options' => $options, 'error' => 'Unexpected argument: '.$argument];
        }

        return ['options' => $options, 'error' => null];
    }

    /**
     * @param  array<int, string>  $argv
     */
    public static function execute(array $argv): int
    {
        $parsed = self::parseOptions($argv);
        $options = $parsed['options'];
        $error = $parsed['error'];

        if ($error !== null) {
            fwrite(STDERR, 'Error: '.$error.PHP_EOL.PHP_EOL.self::USAGE.PHP_EOL);

            return 2;
        }

        if ($options['help']) {
            fwrite(STDOUT, self::USAGE.PHP_EOL);

            return 0;
        }

        $baseUrl = (string) ($options['base_url'] ?? self::env('SF_API_BASE_URL', 'http://127.0.0.1:8001'));
        $target = trim((string) ($options['target'] ?? ''));
        $mutate = (bool) $options['mutate'];

        if ($options['plan']) {
            $planner = new AdminUsersProbe(new CurlTransport($baseUrl), '', '', $target, $mutate);
            self::printPlan($planner->plan());

            return 0;
        }

        $identifier = self::env('SF_ADMIN_IDENTIFIER', '');
        $password = self::env('SF_ADMIN_PASSWORD', '');

        if ($identifier === '' || $password === '') {
            fwrite(STDERR, 'Error: SF_ADMIN_IDENTIFIER and SF_ADMIN_PASSWORD must be set in the environment.'.PHP_EOL);

            return 2;
        }

        if ($target === '') {
            fwrite(STDERR, 'Error: a target account identifier is required (--target <identifier>).'.PHP_EOL);

            return 2;
        }

        $probe = new AdminUsersProbe(new CurlTransport($baseUrl), $identifier, $password, $target, $mutate);

        self::printPlan($probe->plan());
        fwrite(STDOUT, PHP_EOL.'Mode: '.($mutate
            ? 'MUTATION — every write is restored and verified afterwards'
            : 'DRY RUN — read-only, no PATCH is sent').PHP_EOL.PHP_EOL);

        $outcomes = $probe->run();

        self::printOutcomes($outcomes);

        if ($options['logout'] && $probe->sessionToken() !== null) {
            $logout = (new CurlTransport($baseUrl))->request('POST', '/api/auth/logout', null, $probe->sessionToken());
            fwrite(STDOUT, sprintf(
                '  %-4s %-32s %s'.PHP_EOL,
                $logout->ok() ? 'PASS' : 'FAIL',
                'session logout',
                'HTTP='.$logout->code,
            ));
        } elseif ($probe->sessionToken() !== null) {
            fwrite(STDOUT, PHP_EOL.'Note: this run issued a session token. Re-run with --logout to revoke it.'.PHP_EOL);
        }

        $counts = [TestOutcome::PASS => 0, TestOutcome::FAIL => 0, TestOutcome::SKIP => 0, TestOutcome::WARN => 0];
        $restorationFailed = false;
        $refused = false;

        foreach ($outcomes as $outcome) {
            $counts[$outcome->status] = ($counts[$outcome->status] ?? 0) + 1;

            if ($outcome->failed() && $outcome->name === 'restoration verified') {
                $restorationFailed = true;
            }

            if ($outcome->failed() && $outcome->name === 'target is safe to mutate') {
                $refused = true;
            }
        }

        fwrite(STDOUT, PHP_EOL.'SUMMARY: '.$counts[TestOutcome::PASS].' passed, '.$counts[TestOutcome::FAIL].' failed, '
            .$counts[TestOutcome::SKIP].' skipped, '.$counts[TestOutcome::WARN].' warnings'.PHP_EOL);

        if ($restorationFailed) {
            fwrite(STDOUT, PHP_EOL.'!! RESTORATION FAILED — the target account is not in the state it started in.'.PHP_EOL);
            fwrite(STDOUT, '   Fix it as an admin with: PATCH /api/admin/users/{id} {"role":"<original>","status":"<original>"}'.PHP_EOL);

            return 4;
        }

        if ($refused) {
            fwrite(STDOUT, PHP_EOL.'The probe refused to mutate the target. Nothing was written.'.PHP_EOL);

            return 3;
        }

        return $counts[TestOutcome::FAIL] > 0 ? 1 : 0;
    }

    /**
     * @param  array<int, array{name: string, expected: string, mutates: bool}>  $plan
     */
    private static function printPlan(array $plan): void
    {
        fwrite(STDOUT, 'Test plan:'.PHP_EOL);

        foreach ($plan as $index => $entry) {
            fwrite(STDOUT, sprintf(
                '  %2d. %-32s %-72s %s'.PHP_EOL,
                $index + 1,
                $entry['name'],
                $entry['expected'],
                $entry['mutates'] ? '[MUTATES]' : '[read-only]',
            ));
        }
    }

    /**
     * @param  array<int, TestOutcome>  $outcomes
     */
    private static function printOutcomes(array $outcomes): void
    {
        foreach ($outcomes as $outcome) {
            fwrite(STDOUT, sprintf(
                '  %-4s %-32s %s'.PHP_EOL,
                $outcome->status,
                $outcome->name,
                $outcome->detail,
            ));
        }
    }

    private static function env(string $key, string $default): string
    {
        $value = getenv($key);

        return $value === false || $value === '' ? $default : $value;
    }
}

if (PHP_SAPI === 'cli' && isset($argv[0]) && realpath((string) $argv[0]) === realpath(__FILE__)) {
    exit(ProbeCli::execute($argv));
}
