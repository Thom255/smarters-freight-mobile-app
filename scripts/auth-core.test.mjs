/**
 * Tests for the pure modules the app builds on:
 *   - the auth core (src/lib/auth-core.ts)
 *   - the API client (src/lib/api.ts)
 *   - shipment presentation helpers (src/lib/shipments.ts)
 *   - shipment form validation/mapping (src/lib/shipment-form.ts)
 *
 * Run with: node scripts/auth-core.test.mjs
 * These modules have no React Native imports; Node strips the types and the
 * API client is exercised against a mocked global fetch.
 */

import assert from 'node:assert/strict';
import { mock } from 'node:test';

const core = await import('../src/lib/auth-core.ts');
const {
  validateIdentifier,
  validatePassword,
  validateName,
  validateConfirm,
  normalizeIdentifier,
  validateLogin,
  validateRegister,
  validateForgotPassword,
  validateResetPassword,
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

  // --- password recovery guards ----------------------------------------
  check('validateForgotPassword flags a bad identifier', () => {
    const failure = validateForgotPassword({ identifier: 'nope' });
    assert.equal(failure.field, 'identifier');
    assert.equal(validateForgotPassword({ identifier: 'a@b.com' }), null);
  });
  check('validateResetPassword requires a token', () => {
    const failure = validateResetPassword({
      identifier: 'a@b.com',
      token: '',
      password: PASSWORD,
    });
    assert.equal(failure.field, 'token');
  });
  check('validateResetPassword checks password and confirm', () => {
    assert.equal(
      validateResetPassword({
        identifier: 'a@b.com',
        token: 'sfr_x',
        password: PASSWORD,
        confirm: PASSWORD,
      }),
      null,
    );
    assert.equal(
      validateResetPassword({ identifier: 'a@b.com', token: 'sfr_x', password: '123' }).field,
      'password',
    );
    assert.equal(
      validateResetPassword({
        identifier: 'a@b.com',
        token: 'sfr_x',
        password: PASSWORD,
        confirm: 'other',
      }).field,
      'confirm',
    );
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
  check('keeps the token field for reset errors', () => {
    const failure = toAuthFailure({ field: 'token', message: 'This reset link is invalid.' });
    assert.equal(failure.field, 'token');
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

  // --- error classification: network vs timeout vs http ----------------
  await withFetch(
    async () => {
      throw new TypeError('Network request failed');
    },
    async () => {
      try {
        await api.api.dashboard('sf_token');
        check('an unreachable host is classifyable as network', () => {
          assert.fail('should have thrown');
        });
      } catch (error) {
        check('an unreachable host is classifyable as network', () => {
          assert.equal(error.kind, 'network');
          assert.equal(error.status, 0);
        });
      }
    },
  );

  // The deadline is driven by setTimeout, so freeze the clock, hang the
  // request, then jump past the deadline instead of waiting it out.
  mock.timers.enable({ apis: ['setTimeout'] });
  await withFetch(
    (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new Error('Request aborted')));
      }),
    async () => {
      const pending = api.api.dashboard('sf_token');
      mock.timers.tick(60_000);
      try {
        await pending;
        check('a hung request times out as its own kind', () => {
          assert.fail('should have thrown');
        });
      } catch (error) {
        check('a hung request times out as its own kind', () => {
          assert.ok(error instanceof api.ApiError);
          assert.equal(error.kind, 'timeout');
          assert.equal(error.status, 0);
          assert.ok(error.message.includes('too long'));
        });
      }
    },
  );
  mock.timers.reset();

  // Bodies with no usable `message` must still read as plain English.
  await withFetch(
    async () => new Response('Bad Gateway', { status: 502 }),
    async () => {
      try {
        await api.api.dashboard('sf_token');
        check('a bare proxy error gets a friendly fallback message', () => {
          assert.fail('should have thrown');
        });
      } catch (error) {
        check('a bare proxy error gets a friendly fallback message', () => {
          assert.equal(error.kind, 'http');
          assert.equal(error.status, 502);
          assert.ok(error.message.includes('server'));
          assert.ok(!error.message.includes('Request failed ('));
        });
      }
    },
  );

  await withFetch(
    async () =>
      new Response(JSON.stringify({ ok: false }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    async () => {
      try {
        await api.api.me('sf_expired');
        check('a message-less 401 falls back to the session-expired wording', () => {
          assert.fail('should have thrown');
        });
      } catch (error) {
        check('a message-less 401 falls back to the session-expired wording', () => {
          assert.equal(error.kind, 'http');
          assert.equal(error.status, 401);
          assert.equal(error.message, 'Session expired. Please sign in again.');
        });
      }
    },
  );

  // A dashboard 500 must read as plain English — never a raw status or any
  // server-side detail — so the screen can offer a retry with useful copy.
  await withFetch(
    async () => new Response(null, { status: 500 }),
    async () => {
      try {
        await api.api.dashboard('sf_token');
        check('a dashboard 500 gets a friendly server-error message', () => {
          assert.fail('should have thrown');
        });
      } catch (error) {
        check('a dashboard 500 gets a friendly server-error message', () => {
          assert.ok(error instanceof api.ApiError);
          assert.equal(error.kind, 'http');
          assert.equal(error.status, 500);
          assert.equal(error.message, 'Something went wrong on the server. Please try again shortly.');
          const text = error.message.toLowerCase();
          assert.ok(!text.includes('exception'));
          assert.ok(!text.includes('stack'));
          assert.ok(!text.includes('supabase'));
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
          role: 'cargo_owner',
          stats: {
            shipments: 2,
            booked: 1,
            inTransit: 1,
            delivered: 0,
            cancelled: 0,
            orders: 1,
          },
          marketplace: {
            trucks: 3,
            availableTrucks: 3,
            cargo: 2,
            postedCargo: 1,
            matches: 2,
          },
          fleet: {
            total: 0,
            available: 0,
            booked: 0,
            inTransit: 0,
            maintenance: 0,
            inactive: 0,
          },
          loads: {
            total: 2,
            pending: 1,
            confirmed: 1,
            inTransit: 0,
            completed: 0,
            cancelled: 0,
          },
          bookings: { active: 1 },
          activeShipment: null,
          upcomingDeliveries: [
            {
              id: 'shp_1',
              reference: 'SF-ABC123',
              origin: 'Dar es Salaam',
              destination: 'Nairobi',
              status: 'booked',
              createdAt: 1_700_000_000_000,
            },
          ],
          recentActivity: [],
          alerts: [
            { id: 'awaiting-pickup', tone: 'info', title: '1 shipment awaiting pickup', body: null },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    },
    async () => {
      const payload = await api.api.dashboard('sf_token');
      check('dashboard attaches bearer token and parses payload', () => {
        assert.equal(payload.stats.shipments, 2);
        assert.equal(payload.stats.booked, 1);
        assert.equal(payload.loads.pending, 1);
        assert.equal(payload.bookings.active, 1);
        assert.equal(payload.upcomingDeliveries.length, 1);
        assert.equal(payload.alerts[0].tone, 'info');
        assert.deepEqual(payload.recentActivity, []);
      });
    },
  );

  await withFetch(
    async (url, init) => {
      assert.ok(String(url).endsWith('/api/admin/revenue'));
      assert.equal(init.method, 'GET');
      assert.equal(init.headers.Authorization, 'Bearer sf_admin_token');
      return new Response(
        JSON.stringify({
          ok: true,
          commissionRate: 8,
          currency: 'TZS',
          totals: {
            cargoValue: 3500000,
            pendingCommission: 80000,
            earnedCommission: 40000,
            paidCommission: 160000,
            cancelledCommission: 80000,
            refundedCommission: 80000,
            liveCommission: 280000,
            completedShipments: 2,
          },
          counts: { pending: 1, earned: 1, paid: 1, cancelled: 1, refunded: 1, total: 5 },
          commissions: [
            {
              id: 'c1',
              cargoId: 'g1',
              bookingId: 'b1',
              cargoPrice: 1000000,
              commissionRate: 8,
              commissionAmount: 80000,
              providerNetAmount: 920000,
              currency: 'TZS',
              status: 'pending',
              paymentReference: null,
              refundReason: null,
              earnedAt: null,
              paidAt: null,
              cancelledAt: null,
              refundedAt: null,
              createdAt: 1791618027000,
              cargo: {
                id: 'g1',
                reference: 'CG-ABC123',
                cargoType: 'General cargo',
                status: 'booked',
                pickupLocation: 'Dar es Salaam',
                destination: 'Mwanza',
              },
              booking: { id: 'b1', status: 'accepted', price: 1000000, currency: 'TZS' },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    },
    async () => {
      const payload = await api.api.adminRevenue('sf_admin_token');
      check('adminRevenue attaches bearer token and parses the revenue payload', () => {
        assert.equal(payload.commissionRate, 8);
        assert.equal(payload.currency, 'TZS');
        assert.equal(payload.totals.cargoValue, 3500000);
        assert.equal(payload.totals.pendingCommission, 80000);
        assert.equal(payload.totals.paidCommission, 160000);
        assert.equal(payload.totals.liveCommission, 280000);
        assert.equal(payload.totals.completedShipments, 2);
        assert.equal(payload.counts.total, 5);
        assert.equal(payload.commissions.length, 1);
        // The TZS 1,000,000 example, straight from the server.
        assert.equal(payload.commissions[0].cargoPrice, 1000000);
        assert.equal(payload.commissions[0].commissionAmount, 80000);
        assert.equal(payload.commissions[0].providerNetAmount, 920000);
        assert.equal(payload.commissions[0].cargo.reference, 'CG-ABC123');
        assert.equal(payload.commissions[0].booking.status, 'accepted');
      });
    },
  );

  await withFetch(
    async (url) => {
      assert.ok(String(url).endsWith('/api/admin/revenue'));
      return new Response(
        JSON.stringify({
          ok: false,
          field: 'role',
          message: 'Your account type does not allow that action.',
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      );
    },
    async () => {
      try {
        await api.api.adminRevenue('sf_token');
        check('adminRevenue 403 surfaces as ApiError with field role', () => {
          assert.fail('should have thrown');
        });
      } catch (error) {
        check('adminRevenue 403 surfaces as ApiError with field role', () => {
          assert.ok(error instanceof api.ApiError);
          assert.equal(error.status, 403);
          assert.equal(error.field, 'role');
        });
      }
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
      assert.ok(String(url).endsWith('/api/bookings'));
      assert.equal(init.method, 'POST');
      assert.equal(init.headers.Authorization, 'Bearer sf_token');
      const body = JSON.parse(init.body);
      assert.equal(body.truckId, 't1');
      assert.equal(body.cargoId, 'c1');
      assert.equal(body.price, 450000);
      return new Response(
        JSON.stringify({
          ok: true,
          booking: { id: 'b1', status: 'pending', direction: 'outgoing', price: 450000, currency: 'TZS' },
          truck: { id: 't1', registrationNumber: 'T 123 ABC', status: 'available' },
          cargo: { id: 'c1', reference: 'CG-ABC123', status: 'posted' },
        }),
        { status: 201, headers: { 'Content-Type': 'application/json' } },
      );
    },
    async () => {
      const payload = await api.api.requestBooking('sf_token', {
        truckId: 't1',
        cargoId: 'c1',
        price: 450000,
      });
      check('requestBooking posts both ids + price and returns the pending booking', () => {
        assert.equal(payload.booking.status, 'pending');
        assert.equal(payload.booking.direction, 'outgoing');
        assert.equal(payload.booking.price, 450000);
        assert.equal(payload.booking.currency, 'TZS');
      });
    },
  );

  await withFetch(
    async (url) => {
      assert.ok(String(url).endsWith('/api/bookings'));
      return new Response(
        JSON.stringify({ ok: false, field: 'truck', message: 'That truck is no longer available' }),
        { status: 409, headers: { 'Content-Type': 'application/json' } },
      );
    },
    async () => {
      try {
        await api.api.requestBooking('sf_token', { truckId: 't1', cargoId: 'c1' });
        check('requestBooking conflict surfaces as ApiError with field', () => {
          assert.fail('should have thrown');
        });
      } catch (error) {
        check('requestBooking conflict surfaces as ApiError with field', () => {
          assert.ok(error instanceof api.ApiError);
          assert.equal(error.status, 409);
          assert.equal(error.field, 'truck');
        });
      }
    },
  );

  await withFetch(
    async (url, init) => {
      assert.ok(String(url).endsWith('/api/bookings/b1/accept'));
      assert.equal(init.method, 'POST');
      assert.equal(init.headers.Authorization, 'Bearer sf_token');
      return new Response(
        JSON.stringify({
          ok: true,
          booking: { id: 'b1', status: 'accepted', direction: 'incoming' },
          truck: { id: 't1', status: 'booked' },
          cargo: { id: 'c1', status: 'booked' },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    },
    async () => {
      const payload = await api.api.acceptBooking('sf_token', 'b1');
      check('acceptBooking posts to the booking action and returns the accepted booking', () => {
        assert.equal(payload.booking.status, 'accepted');
        assert.equal(payload.truck.status, 'booked');
      });
    },
  );

  await withFetch(
    async (url, init) => {
      assert.ok(String(url).endsWith('/api/marketplace/trucks'));
      assert.equal(init.method, 'GET');
      assert.equal(init.headers.Authorization, 'Bearer sf_token');
      return new Response(
        JSON.stringify({
          ok: true,
          trucks: [
            {
              id: 't1',
              registrationNumber: 'T 123 ABC',
              truckType: 'Flatbed',
              status: 'available',
              driverName: 'Juma Ally',
              ratePerTon: 45000,
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    },
    async () => {
      const payload = await api.api.marketplaceTrucks('sf_token');
      check('marketplaceTrucks fetches the open fleet with driver + rate', () => {
        assert.equal(payload.trucks.length, 1);
        assert.equal(payload.trucks[0].driverName, 'Juma Ally');
        assert.equal(payload.trucks[0].ratePerTon, 45000);
      });
    },
  );

  // --- password recovery -------------------------------------------------
  await withFetch(
    async (url, init) => {
      assert.ok(String(url).endsWith('/api/auth/forgot-password'));
      assert.equal(init.method, 'POST');
      // No Authorization header — recovery is a public endpoint.
      assert.equal(init.headers.Authorization, undefined);
      const body = JSON.parse(init.body);
      assert.equal(body.identifier, 'amina@co.tz');
      return new Response(
        JSON.stringify({
          ok: true,
          message: 'If an account exists with that email or phone, we have sent reset instructions.',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    },
    async () => {
      const result = await api.api.forgotPassword({ identifier: 'amina@co.tz' });
      check('forgotPassword posts the identifier and returns a neutral message', () => {
        assert.equal(result.ok, true);
        assert.ok(result.message.includes('reset instructions'));
      });
    },
  );

  await withFetch(
    async (url, init) => {
      assert.ok(String(url).endsWith('/api/auth/reset-password'));
      assert.equal(init.method, 'POST');
      const body = JSON.parse(init.body);
      assert.equal(body.identifier, 'amina@co.tz');
      assert.equal(body.token, 'sfr_abc');
      assert.equal(body.password, 'new-secret');
      return new Response(JSON.stringify({ ok: true, message: 'Your password has been reset.' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
    async () => {
      const result = await api.api.resetPassword({
        identifier: 'amina@co.tz',
        token: 'sfr_abc',
        password: 'new-secret',
      });
      check('resetPassword posts the token and new password', () => {
        assert.equal(result.ok, true);
        assert.ok(result.message.includes('reset'));
      });
    },
  );

  // --- shipment form helpers + presentation ------------------------------
  const shipLib = await import('../src/lib/shipments.ts');
  const form = await import('../src/lib/shipment-form.ts');
  const { EMPTY_SHIPMENT_FORM } = form;

  check('shipment status label maps booked to Confirmed', () => {
    assert.equal(shipLib.shipmentStatusLabel('booked'), 'Confirmed');
    assert.equal(shipLib.shipmentStatusLabel('in_transit'), 'In transit');
    assert.equal(shipLib.shipmentStatusLabel('delivered'), 'Delivered');
    assert.equal(shipLib.shipmentStatusLabel('cancelled'), 'Cancelled');
  });

  check('isoDate formats a local date as YYYY-MM-DD', () => {
    assert.equal(shipLib.isoDate(new Date(2026, 9, 7).getTime()), '2026-10-07');
    assert.equal(shipLib.isoDate(null), '');
    assert.equal(shipLib.isoDate(undefined), '');
  });

  check('formatShipmentWeight renders tons and blanks', () => {
    assert.equal(shipLib.formatShipmentWeight(12.5), '12.5 t');
    assert.equal(shipLib.formatShipmentWeight(12), '12 t');
    assert.equal(shipLib.formatShipmentWeight(null), '');
    assert.equal(shipLib.formatShipmentWeight(undefined), '');
  });

  check('validateShipmentForm requires origin and destination', () => {
    const errors = form.validateShipmentForm({ ...EMPTY_SHIPMENT_FORM, origin: 'A' });
    assert.equal(errors.origin, 'Enter the pickup location');
    assert.equal(errors.destination, 'Enter the destination');
    assert.equal(form.hasShipmentFormErrors(errors), true);
  });

  check('validateShipmentForm rejects non-positive weight', () => {
    const errors = form.validateShipmentForm({
      ...EMPTY_SHIPMENT_FORM,
      origin: 'Dar',
      destination: 'Nairobi',
      weightTons: '0',
    });
    assert.ok(errors.weightTons);
  });

  check('validateShipmentForm checks date format and ordering', () => {
    assert.ok(
      form.validateShipmentForm({
        ...EMPTY_SHIPMENT_FORM,
        origin: 'Dar',
        destination: 'Nairobi',
        pickupDate: '20-10-2026',
      }).pickupDate,
    );

    const errors = form.validateShipmentForm({
      ...EMPTY_SHIPMENT_FORM,
      origin: 'Dar',
      destination: 'Nairobi',
      pickupDate: '2026-10-20',
      deliveryDeadline: '2026-10-10',
    });
    assert.ok(errors.deliveryDeadline);
  });

  check('validateShipmentForm passes a valid form', () => {
    const errors = form.validateShipmentForm({
      ...EMPTY_SHIPMENT_FORM,
      origin: 'Dar es Salaam',
      destination: 'Nairobi',
      weightTons: '12.5',
      pickupDate: '2026-10-20',
      deliveryDeadline: '2026-10-27',
    });
    assert.equal(form.hasShipmentFormErrors(errors), false);
  });

  check('shipmentFormFrom prefills from an existing shipment', () => {
    const values = form.shipmentFormFrom({
      id: 's1',
      reference: 'SF-ABC123',
      origin: 'Dar es Salaam',
      destination: 'Nairobi',
      status: 'booked',
      notes: 'Fragile',
      createdAt: 1,
      cargoType: 'Cement',
      weightTons: 12.5,
      pickupDate: new Date(2026, 9, 7).getTime(),
      assignedTruckId: 't1',
    });
    assert.equal(values.origin, 'Dar es Salaam');
    assert.equal(values.cargoType, 'Cement');
    assert.equal(values.weightTons, '12.5');
    assert.equal(values.pickupDate, '2026-10-07');
    assert.equal(values.deliveryDeadline, '');
    assert.equal(values.assignedTruckId, 't1');
  });

  check('shipmentFormToCreateInput trims and drops blanks', () => {
    const input = form.shipmentFormToCreateInput({
      ...EMPTY_SHIPMENT_FORM,
      origin: '  Dar es Salaam ',
      destination: 'Nairobi',
      weightTons: '12.5',
      cargoType: '',
      notes: '   ',
    });
    assert.equal(input.origin, 'Dar es Salaam');
    assert.equal(input.destination, 'Nairobi');
    assert.equal(input.weightTons, 12.5);
    assert.equal(input.cargoType, undefined);
    assert.equal(input.notes, undefined);
  });

  check('shipmentFormToUpdateInput uses null to clear blanks', () => {
    const input = form.shipmentFormToUpdateInput({
      ...EMPTY_SHIPMENT_FORM,
      origin: 'Dar es Salaam',
      destination: 'Nairobi',
      weightTons: '',
      cargoType: '',
      bookingReference: 'BK-1',
    });
    assert.equal(input.weightTons, null);
    assert.equal(input.cargoType, null);
    assert.equal(input.bookingReference, 'BK-1');
  });

  await withFetch(
    async (url, init) => {
      assert.ok(String(url).endsWith('/api/shipments'));
      assert.equal(init.method, 'POST');
      assert.equal(init.headers.Authorization, 'Bearer sf_token');
      const body = JSON.parse(init.body);
      assert.equal(body.origin, 'Dar es Salaam');
      assert.equal(body.destination, 'Nairobi');
      assert.equal(body.weightTons, 12.5);
      assert.equal(body.assignedTruckId, 't1');
      return new Response(
        JSON.stringify({
          ok: true,
          shipment: {
            id: 's9',
            reference: 'SF-NEW123',
            origin: 'Dar es Salaam',
            destination: 'Nairobi',
            status: 'booked',
            notes: null,
            createdAt: 1,
            weightTons: 12.5,
            assignedTruckId: 't1',
          },
        }),
        { status: 201, headers: { 'Content-Type': 'application/json' } },
      );
    },
    async () => {
      const payload = await api.api.createShipment('sf_token', {
        origin: 'Dar es Salaam',
        destination: 'Nairobi',
        weightTons: 12.5,
        assignedTruckId: 't1',
      });
      check('createShipment posts camelCase body and parses the new shipment', () => {
        assert.equal(payload.shipment.id, 's9');
        assert.equal(payload.shipment.status, 'booked');
        assert.equal(payload.shipment.weightTons, 12.5);
        assert.equal(payload.shipment.assignedTruckId, 't1');
      });
    },
  );

  await withFetch(
    async (url, init) => {
      assert.ok(String(url).endsWith('/api/shipments/s9'));
      assert.equal(init.method, 'PATCH');
      assert.equal(init.headers.Authorization, 'Bearer sf_token');
      const body = JSON.parse(init.body);
      assert.equal(body.status, 'in_transit');
      return new Response(
        JSON.stringify({
          ok: true,
          shipment: {
            id: 's9',
            reference: 'SF-NEW123',
            origin: 'Dar es Salaam',
            destination: 'Nairobi',
            status: 'in_transit',
            notes: null,
            createdAt: 1,
          },
          event: {
            id: 'e1',
            type: 'in_transit',
            title: 'In transit',
            body: 'Dar es Salaam → Nairobi',
            createdAt: 2,
            actor: 'Amina',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    },
    async () => {
      const payload = await api.api.updateShipment('sf_token', 's9', { status: 'in_transit' });
      check('updateShipment patches the status and returns the recorded event', () => {
        assert.equal(payload.shipment.status, 'in_transit');
        assert.equal(payload.event?.actor, 'Amina');
        assert.equal(payload.event?.type, 'in_transit');
      });
    },
  );

  // --- central 401 handling ------------------------------------------------
  await withFetch(
    async () =>
      new Response(JSON.stringify({ ok: false, field: 'session', message: 'Session expired' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    async () => {
      let fired = 0;
      const unsubscribe = api.onUnauthorized(() => {
        fired += 1;
      });

      try {
        await api.api.shipments('sf_expired');
      } catch {
        // expected
      }

      unsubscribe();

      check('a token-bearing 401 notifies subscribers once', () => {
        assert.equal(fired, 1);
      });
    },
  );

  await withFetch(
    async () =>
      new Response(JSON.stringify({ ok: false, field: 'password', message: 'Incorrect password' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    async () => {
      let fired = 0;
      const unsubscribe = api.onUnauthorized(() => {
        fired += 1;
      });

      try {
        await api.api.login({ identifier: 'amina@co.tz', password: 'wrong' });
      } catch {
        // expected
      }

      unsubscribe();

      check('a login 401 does not notify subscribers', () => {
        assert.equal(fired, 0);
      });
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
