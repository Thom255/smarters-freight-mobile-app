/**
 * Live API connectivity check for the login screen.
 *
 * The mobile app shows "Cannot reach the server..." when `fetch` gets no HTTP
 * response at all (host down, backend bound to 127.0.0.1 while the device uses
 * the LAN IP, wrong port, firewall, DNS). This script exercises exactly that
 * path against the same base URL the app bundles from `.env`, so the failure
 * can be reproduced without the UI:
 *
 *   PASS  an HTTP status came back (401 for the throwaway account, 422/429
 *         are also acceptable) - the login endpoint is reachable.
 *   FAIL  no response was received, which is precisely what the app reports
 *         as "Cannot reach the server".
 *
 * It never sends real credentials and never prints them. The identifier is a
 * throwaway address and the password is a fixed non-secret marker.
 *
 * Usage:
 *   node scripts/api-connectivity.test.mjs
 *   API_URL=http://192.168.1.107:8001 node scripts/api-connectivity.test.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REQUEST_TIMEOUT_MS = 15_000;

/** Reads EXPO_PUBLIC_API_URL from the root .env (comments/quotes handled). */
function apiUrlFromEnvFile() {
  try {
    const contents = readFileSync(join(ROOT, '.env'), 'utf8');

    for (const rawLine of contents.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;

      const match = line.match(/^EXPO_PUBLIC_API_URL\s*=\s*(.*)$/);
      if (!match) continue;

      const value = match[1].trim().replace(/^['"]|['"]$/g, '');
      if (value) return value;
    }
  } catch {
    // Fall through to the default below.
  }

  return null;
}

const configured = (process.env.API_URL ?? apiUrlFromEnvFile() ?? 'http://localhost:8001').trim();
const baseUrl = configured.replace(/\/+$/, '');

if (!/^https?:\/\/[^/\s]+/i.test(baseUrl)) {
  console.error(`FAIL: EXPO_PUBLIC_API_URL is not a valid http(s) URL: ${baseUrl}`);
  process.exit(1);
}

const identifier = `connectivity-check-${Date.now()}@example.invalid`;

console.log(`Checking login endpoint: ${baseUrl}/api/auth/login`);

const controller = new AbortController();
const deadline = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

let response;
try {
  response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password: 'connectivity-check-only' }),
    signal: controller.signal,
  });
} catch (error) {
  clearTimeout(deadline);

  const reason = controller.signal.aborted
    ? `no response within ${REQUEST_TIMEOUT_MS / 1000}s`
    : error instanceof Error
      ? error.message
      : String(error);

  console.error(`FAIL: no HTTP response from ${baseUrl} (${reason}).`);
  console.error(
    'The app would show: "Cannot reach the server. Check your connection and try again."',
  );
  console.error(
    'Start the backend so it listens on the LAN interface: npm run api  ' +
      '(php backend/artisan serve --host=0.0.0.0 --port=8001)',
  );
  process.exit(1);
} finally {
  clearTimeout(deadline);
}

const status = response.status;
let payload = null;
try {
  payload = await response.json();
} catch {
  // A non-JSON body still proves the endpoint answered.
}

const expectedStatuses = new Set([401, 422, 429]);
if (!status || status < 200 || status >= 600) {
  console.error(`FAIL: unexpected HTTP status ${status} from ${baseUrl}/api/auth/login`);
  process.exit(1);
}

if (!expectedStatuses.has(status)) {
  console.error(
    `FAIL: login endpoint answered HTTP ${status}, expected 401/422/429 for a throwaway account.`,
  );
  if (payload && typeof payload === 'object' && 'message' in payload) {
    console.error(`Server message: ${String(payload.message)}`);
  }
  process.exit(1);
}

const contractOk =
  status === 429 ||
  (payload &&
    typeof payload === 'object' &&
    payload.ok === false &&
    typeof payload.field === 'string' &&
    typeof payload.message === 'string');

if (!contractOk) {
  console.error(
    `FAIL: HTTP ${status} did not match the { ok:false, field, message } login contract.`,
  );
  process.exit(1);
}

console.log(`PASS: login endpoint reachable at ${baseUrl} (HTTP ${status}).`);
console.log('The network path used by the app is working; a real sign-in can now be attempted.');
