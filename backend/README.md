# Smarters Freight — Laravel API backend

Remote REST API for the Expo mobile app. The app **never** talks to Supabase
directly — every service (auth, dashboard, shipments) comes from this backend,
and Metro is configured (`metro.config.js` `blockList`) to never bundle this
folder.

## How it fits together

```
Expo app (src/)  ── HTTP/JSON ──►  Laravel API (backend/)  ── HTTPS ──►  Supabase REST (PostgREST)
   bearer token                      service-role key                      users / api_tokens /
                                                                               shipments / shipment_events
```

* **Laravel owns auth.** Passwords are bcrypt-hashed by Laravel; only the
  SHA-256 hash of each bearer token is stored. Supabase is reached over its
  REST API with the service-role key — no database socket, no Eloquent.
* **RLS is deny-by-default** on every table (see `supabase_schema.sql`), so the
  public anon key can read nothing. The service key must stay server-side only.

## Setup

Requires PHP ≥ 8.3 and Composer.

```bash
cd backend
composer install
cp .env.example .env          # then fill in the values below
php artisan key:generate
php artisan serve             # http://127.0.0.1:8000
```

### Environment (backend/.env)

| Key | Value |
| --- | --- |
| `APP_URL` | `http://localhost:8000` locally; your HTTPS origin in production |
| `SUPABASE_URL` | `https://<project>.supabase.co` |
| `SUPABASE_ANON_KEY` | public anon key (parity / future use) |
| `SUPABASE_SERVICE_KEY` | service-role key — **server-side only** |
| `CORS_ALLOWED_ORIGINS` | optional, comma-separated browser origins (default `http://localhost:8081,http://127.0.0.1:8081`) — needed for Expo **web**, not for native |

## Database schema (Supabase SQL Editor)

Run these once, in order, in the Supabase SQL Editor:

1. **`supabase_schema.sql`** — `users`, `api_tokens`, `shipments`,
   `shipment_events`, indexes, `updated_at` triggers, RLS with **no** anon
   policies.
2. **`supabase_marketplace.sql`** — `users.role`/`phone`/`company_name`,
   `locations`, `trucks`, `cargo` (SRS §14–§17).
3. **`supabase_bookings.sql`** — the `cargo.matched_truck_id` /
   `trucks.matched_cargo_id` links that keep a booked match visible (SRS §22).

> If an API call fails with *"Run supabase_schema.sql in the Supabase SQL
> Editor first"*, the tables are missing.

## API reference

Base URL: `http://127.0.0.1:8000` (or your host). All responses are JSON.
Failures are `{ "ok": false, "field": "<form|name|identifier|password|confirm>", "message": "..." }`.

### Public

| Method | Path | Body | Success |
| --- | --- | --- | --- |
| POST | `/api/auth/register` | `name, identifier, password, confirm, role?, companyName?` | `{ ok, user, token }` (201) |
| POST | `/api/auth/login` | `identifier, password` | `{ ok, user, token }` |

`identifier` is an email **or** phone, normalized (trimmed + lowercased).

### Authenticated (send `Authorization: Bearer <token>`)

| Method | Path | Success |
| --- | --- | --- |
| GET | `/api/auth/me` | `{ ok, user }` |
| POST | `/api/auth/logout` | `{ ok }` |
| GET | `/api/dashboard` | `{ ok, role, stats, marketplace, activeShipment, recentActivity }` |
| GET | `/api/shipments` | `{ ok, shipments }` (newest first) |
| POST | `/api/shipments` | `{ ok, shipment }` — body `origin, destination, notes?` |
| GET | `/api/shipments/{id}` | `{ ok, shipment }` |

### Marketplace (SRS §14–§22)

| Method | Path | Success |
| --- | --- | --- |
| GET | `/api/trucks` | `{ ok, trucks }` — the caller's fleet |
| POST | `/api/trucks` | `{ ok, truck }` — body `registrationNumber, truckType, capacityTons, currentLocation, availabilityDate` |
| GET | `/api/trucks/{id}` | `{ ok, truck }` — owner only |
| PATCH | `/api/trucks/{id}` | `{ ok, truck }` — body `status?, currentLocation?, availabilityDate?` |
| GET | `/api/cargo` | `{ ok, cargo }` — the caller's loads |
| POST | `/api/cargo` | `{ ok, cargo }` — body `cargoType, weightTons, pickupLocation, destination, pickupDate, …` |
| GET | `/api/cargo/{id}` | `{ ok, cargo }` — owner only |
| PATCH | `/api/cargo/{id}` | `{ ok, cargo }` — body `status?, pickupDate?, budget?, …` |
| GET | `/api/matches` | `{ ok, role, matches }` — role-aware best matches |
| GET | `/api/matches/cargo/{id}` | `{ ok, cargo, matches }` — trucks for one of my loads |
| GET | `/api/matches/truck/{id}` | `{ ok, truck, matches }` — loads for one of my trucks |
| POST | `/api/matches/accept` | `{ ok, truck, cargo }` — body `truckId, cargoId`; books both sides |

Scores follow the SRS weighting (route 30, capacity 25, date 20, location 15,
availability 10). Accepting a match is allowed for the owner of either side;
it sets the load and truck to `booked` and records the counterpart link.
Finishing a load (`delivered`/`completed`/`cancelled`) or freeing a truck
(`available`/`inactive`/`maintenance`) releases the other side automatically.

Tokens expire after 30 days; a rejected/expired token returns **401**.

## Hosting remotely

Any PHP 8.3+ host works (VPS + nginx/Caddy, Laravel Cloud, Forge, etc.):

1. Deploy this folder; run `composer install --no-dev` and `php artisan config:cache`.
2. Set the env vars above (`SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, …).
3. Serve `backend/public/` over **HTTPS**.
4. Point the app at it: set `EXPO_PUBLIC_API_URL` in the app's root `.env`
   (see `../.env`) to that HTTPS origin, then rebuild/restart Expo.

Health check: `GET /up` returns 200 when the app boots.

## Tests

* **Backend unit tests** (matching engine + booking rules, no Supabase needed):

  ```bash
  cd backend && php vendor/bin/phpunit --testsuite Unit
  ```

* **App-side contract tests** (validators + API client against a mocked fetch)
  live in the Expo project: `node scripts/auth-core.test.mjs`.
