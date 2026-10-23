<?php

namespace Tests\Unit;

use PHPUnit\Framework\TestCase;
use SmartersFreight\Probe\AdminUsersProbe;
use SmartersFreight\Probe\ApiResponse;
use SmartersFreight\Probe\ProbeCli;
use SmartersFreight\Probe\TestOutcome;
use SmartersFreight\Probe\Transport;

require_once __DIR__.'/../../scripts/probe-admin-users.php';

/**
 * The admin console probe is the tool that verifies the account management
 * writes against a live backend, so its own safety rules are worth a test:
 * the dry run must never write, the mutation phase must always put the target
 * back, and a missing `users.status` column must be reported instead of
 * leaving an account suspended.
 */
class AdminUsersProbeTest extends TestCase
{
    private const ADMIN_IDENTIFIER = 'admin@example.com';

    private const ADMIN_PASSWORD = 'probe-password-value';

    private const TARGET_IDENTIFIER = 'target@example.com';

    public function test_a_dry_run_never_sends_a_write(): void
    {
        $transport = $this->transport();

        $this->probe($transport)->run();

        $this->assertSame(['POST', 'GET'], array_column($transport->calls, 'method'));
        $this->assertSame('/api/auth/login', $transport->calls[0]['path']);
        $this->assertSame('/api/admin/users', $transport->calls[1]['path']);
    }

    public function test_a_dry_run_reports_the_target_and_the_admin_row(): void
    {
        $outcomes = $this->probe($this->transport())->run();

        $this->assertSame(TestOutcome::PASS, $this->outcome($outcomes, 'admin login')->status);
        $this->assertSame(TestOutcome::PASS, $this->outcome($outcomes, 'GET /api/admin/users')->status);
        $this->assertSame(TestOutcome::PASS, $this->outcome($outcomes, 'admin account listed as admin')->status);
        $this->assertSame(TestOutcome::PASS, $this->outcome($outcomes, 'target account present')->status);
        $this->assertSame(TestOutcome::SKIP, $this->outcome($outcomes, 'account status support')->status);
    }

    public function test_the_plan_flags_every_mutating_check(): void
    {
        $dryRun = $this->probe($this->transport())->plan();
        $mutating = $this->probe($this->transport(), true)->plan();

        foreach ($dryRun as $entry) {
            $this->assertFalse($entry['mutates'], $entry['name'].' must be read-only in the dry run');
        }

        $names = array_column($mutating, 'name');
        $this->assertContains('role change applied', $names);
        $this->assertContains('status change applied', $names);
        $this->assertContains('restore original role', $names);
        $this->assertContains('restoration verified', $names);

        foreach ($mutating as $entry) {
            $this->assertNotSame('', $entry['expected']);
        }
    }

    public function test_the_mutation_phase_restores_the_original_role_and_status(): void
    {
        $transport = $this->transport();

        $outcomes = $this->probe($transport, true)->run();

        $this->assertSame(TestOutcome::PASS, $this->outcome($outcomes, 'role change applied')->status);
        $this->assertSame(TestOutcome::PASS, $this->outcome($outcomes, 'role change persisted')->status);
        $this->assertSame(TestOutcome::PASS, $this->outcome($outcomes, 'invalid role refused')->status);
        $this->assertSame(TestOutcome::PASS, $this->outcome($outcomes, 'status change applied')->status);
        $this->assertSame(TestOutcome::PASS, $this->outcome($outcomes, 'restore original role')->status);
        $this->assertSame(TestOutcome::PASS, $this->outcome($outcomes, 'restore original status')->status);
        $this->assertSame(TestOutcome::PASS, $this->outcome($outcomes, 'restoration verified')->status);

        $target = $transport->users['target-1'];
        $this->assertSame('cargo_owner', $target['role']);
        $this->assertSame('active', $target['status']);
    }

    public function test_a_missing_status_column_is_reported_and_nothing_is_left_suspended(): void
    {
        $transport = $this->transport(false);

        $outcomes = $this->probe($transport, true)->run();

        $statusChange = $this->outcome($outcomes, 'status change applied');
        $this->assertSame(TestOutcome::WARN, $statusChange->status);
        $this->assertStringContainsString('users.status', $statusChange->detail);

        $this->assertSame(TestOutcome::PASS, $this->outcome($outcomes, 'restore original status')->status);
        $this->assertSame(TestOutcome::PASS, $this->outcome($outcomes, 'restoration verified')->status);

        $target = $transport->users['target-1'];
        $this->assertSame('cargo_owner', $target['role']);
        $this->assertSame('active', $target['status']);
    }

    public function test_the_probe_never_mutates_the_admin_account(): void
    {
        $transport = $this->transport();

        $outcomes = $this->probe($transport, true, self::ADMIN_IDENTIFIER)->run();

        $this->assertSame(TestOutcome::FAIL, $this->outcome($outcomes, 'target is safe to mutate')->status);

        foreach ($transport->calls as $call) {
            $this->assertNotSame('PATCH', $call['method']);
        }
    }

    public function test_a_rejected_login_reports_the_field_the_api_refused(): void
    {
        $transport = $this->transport();
        $transport->loginResponse = new ApiResponse(401, [
            'ok' => false,
            'field' => 'identifier',
            'message' => 'No account found with that email or phone',
        ]);

        $outcomes = $this->probe($transport)->run();

        $login = $this->outcome($outcomes, 'admin login');

        $this->assertSame(TestOutcome::FAIL, $login->status);
        $this->assertStringContainsString('field=identifier', $login->detail);
        $this->assertStringContainsString('No account found with that email or phone', $login->detail);
        $this->assertStringContainsString('identifier='.self::ADMIN_IDENTIFIER, $login->detail);
        $this->assertStringNotContainsString(self::ADMIN_PASSWORD, $login->detail);
        $this->assertSame(['POST'], array_column($transport->calls, 'method'));
    }

    public function test_no_outcome_leaks_the_password_or_the_token(): void
    {
        $transport = $this->transport();

        $outcomes = $this->probe($transport, true)->run();

        foreach ($outcomes as $outcome) {
            $this->assertStringNotContainsString(self::ADMIN_PASSWORD, $outcome->detail);
            $this->assertStringNotContainsString(self::ADMIN_PASSWORD, $outcome->name);
            $this->assertStringNotContainsString($transport->token, $outcome->detail);
        }
    }

    public function test_the_cli_takes_the_target_from_a_bare_argument(): void
    {
        $parsed = ProbeCli::parseOptions(['probe-admin-users.php', 'someone@example.com']);

        $this->assertNull($parsed['error']);
        $this->assertSame('someone@example.com', $parsed['options']['target']);
        $this->assertFalse($parsed['options']['mutate']);
    }

    public function test_the_cli_rejects_an_unknown_option(): void
    {
        $parsed = ProbeCli::parseOptions(['probe-admin-users.php', '--nope']);

        $this->assertNotNull($parsed['error']);
    }

    private function transport(bool $statusColumnExists = true): FakeProbeTransport
    {
        return new FakeProbeTransport(self::ADMIN_IDENTIFIER, $statusColumnExists);
    }

    private function probe(
        Transport $transport,
        bool $mutate = false,
        string $target = self::TARGET_IDENTIFIER,
    ): AdminUsersProbe {
        return new AdminUsersProbe(
            $transport,
            self::ADMIN_IDENTIFIER,
            self::ADMIN_PASSWORD,
            $target,
            $mutate,
        );
    }

    /**
     * @param  array<int, TestOutcome>  $outcomes
     */
    private function outcome(array $outcomes, string $name): TestOutcome
    {
        foreach ($outcomes as $outcome) {
            if ($outcome->name === $name) {
                return $outcome;
            }
        }

        $this->fail('No outcome named "'.$name.'".');
    }
}

/**
 * In-memory stand-in for the API: it keeps the account rows the way the
 * admin console writes them and records every request, so the probe's own
 * safety rules can be asserted without a network.
 */
final class FakeProbeTransport implements Transport
{
    /** @var array<int, array{method: string, path: string, body: array<string, mixed>|null, token: string|null}> */
    public array $calls = [];

    /** @var array<string, array<string, mixed>> */
    public array $users = [];

    public bool $statusColumnExists;

    public string $token = 'sf_fake_token_value_0123456789';

    /** Set to simulate a rejected sign-in instead of the happy path. */
    public ?ApiResponse $loginResponse = null;

    public function __construct(string $adminIdentifier, bool $statusColumnExists = true)
    {
        $this->statusColumnExists = $statusColumnExists;
        $this->users = [
            'admin-1' => [
                'id' => 'admin-1',
                'identifier' => $adminIdentifier,
                'name' => 'Admin',
                'role' => 'admin',
                'status' => 'active',
                'createdAt' => 1,
            ],
            'target-1' => [
                'id' => 'target-1',
                'identifier' => 'target@example.com',
                'name' => 'Target',
                'role' => 'cargo_owner',
                'status' => 'active',
                'createdAt' => 2,
            ],
        ];
    }

    public function request(string $method, string $path, ?array $body = null, ?string $token = null): ApiResponse
    {
        $this->calls[] = [
            'method' => $method,
            'path' => $path,
            'body' => $body,
            'token' => $token,
        ];

        if ($method === 'POST' && $path === '/api/auth/login') {
            if ($this->loginResponse !== null) {
                return $this->loginResponse;
            }

            return new ApiResponse(200, [
                'ok' => true,
                'token' => $this->token,
                'user' => $this->users['admin-1'],
            ]);
        }

        if ($method === 'GET' && $path === '/api/admin/users') {
            return new ApiResponse(200, ['ok' => true, 'users' => array_values($this->users)]);
        }

        if ($method === 'PATCH' && str_starts_with($path, '/api/admin/users/')) {
            $id = substr($path, strlen('/api/admin/users/'));
            $row = $this->users[$id] ?? null;

            if ($row === null) {
                return new ApiResponse(404, ['ok' => false, 'field' => 'user', 'message' => 'User not found']);
            }

            if (isset($body['role']) && ! in_array($body['role'], ['cargo_owner', 'truck_owner', 'admin'], true)) {
                return new ApiResponse(422, [
                    'ok' => false,
                    'field' => 'role',
                    'message' => 'Choose a valid account type',
                ]);
            }

            if ($body !== null && array_key_exists('status', $body) && ! $this->statusColumnExists) {
                return new ApiResponse(500, [
                    'ok' => false,
                    'field' => 'status',
                    'message' => 'Account status is not available yet — apply supabase_admin.sql first.',
                ]);
            }

            foreach ($body ?? [] as $key => $value) {
                $row[$key] = $value;
            }

            $this->users[$id] = $row;

            return new ApiResponse(200, ['ok' => true, 'user' => $row]);
        }

        return new ApiResponse(404, ['ok' => false, 'message' => 'Not found']);
    }
}
