/**
 * Tests for the pure auth core (src/lib/auth-core.ts) and the API client
 * (src/lib/api.ts).
 *
 * Run with: node scripts/auth-core.test.mjs
 * Both modules have no React Native imports; Node strips the types and the
 * API client is exercised against a mocked global fetch.
 */

import assert from 'node:assert/strict';

const core = await import('../src/lib/auth-core.ts');
const {
  validateIdentifier,
  validatePassword,
  validateName,
  validateConfirm,
  normalizeIdentifier,
  validateLogin,
  validateRegister,
  toAuthFailure,
} = core;

const PASSWORD = 'sekret123';

const results = [];
function check(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, error });
  }
}

async function run() {
  // --- validation -------------------------------------------------------
  check('rejects empty identifier', () => {
    assert.equal(validateIdentifier(''), 'Enter your email or phone number');
  });
  check('rejects malformed identifier', () => {
    assert.ok(validateIdentifier('abc').includes('valid email'));
  });
  check('accepts email and phone', () => {
    assert.equal(validateIdentifier('Amina@Co.tz'), null);
    assert.equal(validateIdentifier('+255 712 345 678'), null);
  });
  check('rejects short password', () => {
    assert.ok(validatePassword('123').includes('at least 6'));
  });
  check('normalizes identifier', () => {
    assert.equal(normalizeIdentifier('  Amina@Co.TZ '), 'amina@co.tz');
  });
  check('name validation', () => {
    assert.equal(validateName('Amina Juma'), null);
    assert.ok(validateName('') === 'Enter your full name');
    assert.ok(validateName('A') === 'Name looks too short');
  });
  check('confirm validation', () => {
    assert.equal(validateConfirm(PASSWORD, PASSWORD), null);
    assert.ok(validateConfirm(PASSWORD, 'other').includes('do not match'));
  });

  // --- form-level guards ------------------------------------------------
  check('validateRegister flags missing name first', () => {
    const failure = validateRegister({
      name: '',
      identifier: 'a@b.com',
      password: PASSWORD,
      confirm: PASSWORD,
    });
    assert.equal(failure.ok, false);
    assert.equal(failure.field, 'name');
  });
  check('validateRegister flags mismatched confirm', () => {
    const failure = validateRegister({
      name: 'Amina Juma',
      identifier: 'a@b.com',
      password: PASSWORD,
      confirm: 'different',
    });
    assert.equal(failure.ok, false);
    assert.equal(failure.field, 'confirm');
  });
  check('validateRegister passes a valid payload', () => {
    const failure = validateRegister({
      name: 'Amina Juma',
      identifier: ' Amina@Co.tz ',
      password: PASSWORD,
      confirm: PASSWORD,
    });
    assert.equal(failure, null);
  });
  check('validateLogin flags empty form', () => {
    const failure = validateLogin({ identifier: '', password: '' });
    assert.equal(failure.ok, false);
    assert.equal(failure.field, 'identifier');
  });
  check('validateLogin flags missing password', () => {
    const failure = validateLogin({ identifier: 'a@b.com', password: '' });
    assert.equal(failure.ok, false);
    assert.equal(failure.field, 'password');
  });

  // --- toAuthFailure mapping -------------------------------------------
  check('maps backend field error', () => {
    const failure = toAuthFailure({
      field: 'identifier',
      message: 'An account with that email or phone already exists',
    });
    assert.equal(failure.ok, false);
    assert.equal(failure.field, 'identifier');
    assert.ok(failure.message.includes('already exists'));
  });
  check('maps unknown field to form', () => {
    const failure = toAuthFailure({ field: 'weird', message: 'boom' });
    assert.equal(failure.field, 'form');
  });
  check('maps non-error throwables to a generic message', () => {
    assert.equal(toAuthFailure(new Error('')).field, 'form');
    const failure = toAuthFailure('plain string');
    assert.equal(failure.ok, false);
    assert.equal(failure.field, 'form');
    assert.ok(failure.message.length > 0);
  });

  // --- API client against mocked fetch ---------------------------------
  const api = await import('../src/lib/api.ts');

  /** Installs a mock fetch for one scenario and restores the original after. */
  function withFetch(mock, fn) {
    const original = globalThis.fetch;
    globalThis.fetch = mock;
    return Promise.resolve()
      .then(fn)
      .finally(() => {
        globalThis.fetch = original;
      });
  }

  await withFetch(
    async (url, init) => {
      assert.ok(String(url).endsWith('/api/auth/login'));
      assert.equal(init.method, 'POST');
      const body = JSON.parse(init.body);
      assert.equal(body.identifier, 'amina@co.tz');
      return new Response(
        JSON.stringify({
          ok: true,
          token: 'sf_test_token',
          user: { id: 'u1', identifier: 'amina@co.tz', name: 'Amina', createdAt: 1 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    },
    async () => {
      const result = await api.api.login({
        identifier: normalizeIdentifier(' Amina@Co.TZ '),
        password: PASSWORD,
      });
      check('login succeeds and returns token + user', () => {
        assert.equal(result.ok, true);
        assert.equal(result.token, 'sf_test_token');
        assert.equal(result.user.identifier, 'amina@co.tz');
      });
    },
  );

  await withFetch(
    async () =>
      new Response(JSON.stringify({ ok: false, field: 'password', message: 'Incorrect password. Try again' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    async () => {
      try {
        await api.api.login({ identifier: 'amina@co.tz', password: 'wrong' });
        check('login rejection surfaces as ApiError', () => {
          assert.fail('should have thrown');
        });
      } catch (error) {
        check('login rejection surfaces as ApiError with field', () => {
          assert.ok(error instanceof api.ApiError);
          assert.equal(error.status, 401);
          assert.equal(error.field, 'password');
          assert.equal(error.message, 'Incorrect password. Try again');
        });
      }
    },
  );

  await withFetch(
    async () => {
      throw new TypeError('Network request failed');
    },
    async () => {
      try {
        await api.api.dashboard('sf_token');
        check('network failure becomes friendly ApiError', () => {
          assert.fail('should have thrown');
        });
      } catch (error) {
        check('network failure becomes friendly ApiError', () => {
          assert.ok(error instanceof api.ApiError);
          assert.equal(error.status, 0);
          assert.ok(error.message.includes('reach the server'));
        });
      }
    },
  );

  await withFetch(
    async (url, init) => {
      assert.ok(String(url).endsWith('/api/dashboard'));
      assert.equal(init.headers.Authorization, 'Bearer sf_token');
      return new Response(
        JSON.stringify({
          ok: true,
          stats: { shipments: 2, inTransit: 1, orders: 1 },
          activeShipment: null,
          recentActivity: [],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    },
    async () => {
      const payload = await api.api.dashboard('sf_token');
      check('dashboard attaches bearer token and parses payload', () => {
        assert.equal(payload.stats.shipments, 2);
        assert.deepEqual(payload.recentActivity, []);
      });
    },
  );

  await withFetch(
    async (url, init) => {
      assert.ok(String(url).endsWith('/api/shipments'));
      assert.equal(init.headers.Authorization, 'Bearer sf_token');
      return new Response(
        JSON.stringify({
          ok: true,
          shipments: [
            {
              id: 's1',
              reference: 'SF-ABC123',
              origin: 'Dar es Salaam, TZ',
              destination: 'Nairobi, KE',
              status: 'booked',
              notes: null,
              createdAt: 1791618027000,
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    },
    async () => {
      const payload = await api.api.shipments('sf_token');
      check('shipments list attaches bearer token and parses payload', () => {
        assert.equal(payload.shipments.length, 1);
        assert.equal(payload.shipments[0].reference, 'SF-ABC123');
        assert.equal(payload.shipments[0].status, 'booked');
      });
    },
  );

  await withFetch(
    async (url, init) => {
      assert.ok(String(url).endsWith('/api/shipments/s1'));
      assert.equal(init.method, 'GET');
      assert.equal(init.headers.Authorization, 'Bearer sf_token');
      return new Response(
        JSON.stringify({
          ok: true,
          shipment: {
            id: 's1',
            reference: 'SF-ABC123',
            origin: 'Dar es Salaam, TZ',
            destination: 'Nairobi, KE',
            status: 'in_transit',
            notes: 'Fragile',
            createdAt: 1791618027000,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    },
    async () => {
      const payload = await api.api.shipment('sf_token', 's1');
      check('shipment detail hits /api/shipments/{id} and parses payload', () => {
        assert.equal(payload.shipment.status, 'in_transit');
        assert.equal(payload.shipment.notes, 'Fragile');
      });
    },
  );

  await withFetch(
    async (url) => {
      // Path segment must be URL-encoded so ids with slashes can't escape the route.
      assert.ok(String(url).endsWith('/api/shipments/a%2Fb'));
      return new Response(
        JSON.stringify({ ok: false, field: 'shipment', message: 'Shipment not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } },
      );
    },
    async () => {
      try {
        await api.api.shipment('sf_token', 'a/b');
        check('shipment detail 404 surfaces as ApiError', () => {
          assert.fail('should have thrown');
        });
      } catch (error) {
        check('shipment detail 404 surfaces as ApiError with field', () => {
          assert.ok(error instanceof api.ApiError);
          assert.equal(error.status, 404);
          assert.equal(error.field, 'shipment');
          assert.equal(error.message, 'Shipment not found');
        });
      }
    },
  );

  await withFetch(
    async () =>
      new Response(JSON.stringify({ ok: false, field: 'form', message: 'Session expired. Please sign in again.' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    async () => {
      try {
        await api.api.me('sf_expired');
        check('401 maps to ApiError status for session revalidation', () => {
          assert.fail('should have thrown');
        });
      } catch (error) {
        check('401 maps to ApiError status for session revalidation', () => {
          assert.equal(error.status, 401);
          const failure = toAuthFailure(error);
          assert.equal(failure.field, 'form');
        });
      }
    },
  );

  await withFetch(
    async (url, init) => {
      assert.ok(String(url).endsWith('/api/matches/accept'));
      assert.equal(init.method, 'POST');
      assert.equal(init.headers.Authorization, 'Bearer sf_token');
      const body = JSON.parse(init.body);
      assert.equal(body.truckId, 't1');
      assert.equal(body.cargoId, 'c1');
      return new Response(
        JSON.stringify({
          ok: true,
          truck: { id: 't1', registrationNumber: 'T 123 ABC', status: 'booked', matchedCargoId: 'c1' },
          cargo: { id: 'c1', reference: 'CG-ABC123', status: 'booked', matchedTruckId: 't1' },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    },
    async () => {
      const payload = await api.api.acceptMatch('sf_token', { truckId: 't1', cargoId: 'c1' });
      check('acceptMatch posts both ids and returns the booked records', () => {
        assert.equal(payload.truck.status, 'booked');
        assert.equal(payload.truck.matchedCargoId, 'c1');
        assert.equal(payload.cargo.status, 'booked');
        assert.equal(payload.cargo.matchedTruckId, 't1');
      });
    },
  );

  await withFetch(
    async (url) => {
      assert.ok(String(url).endsWith('/api/matches/accept'));
      return new Response(
        JSON.stringify({ ok: false, field: 'truck', message: 'That truck has just been booked' }),
        { status: 409, headers: { 'Content-Type': 'application/json' } },
      );
    },
    async () => {
      try {
        await api.api.acceptMatch('sf_token', { truckId: 't1', cargoId: 'c1' });
        check('acceptMatch conflict surfaces as ApiError with field', () => {
          assert.fail('should have thrown');
        });
      } catch (error) {
        check('acceptMatch conflict surfaces as ApiError with field', () => {
          assert.ok(error instanceof api.ApiError);
          assert.equal(error.status, 409);
          assert.equal(error.field, 'truck');
        });
      }
    },
  );

  // --- report -----------------------------------------------------------
  let failed = 0;
  for (const result of results) {
    if (result.ok) {
      console.log(`  ok   ${result.name}`);
    } else {
      failed += 1;
      console.log(`  FAIL ${result.name}`);
      console.log(`       ${result.error?.message ?? result.error}`);
    }
  }

  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  if (failed > 0) process.exit(1);
}

await run();
