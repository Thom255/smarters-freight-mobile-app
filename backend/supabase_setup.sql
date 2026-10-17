-- ============================================================================
-- SMARTERS FREIGHT — Complete Supabase setup (ALL-IN-ONE)
-- ============================================================================
-- Project : https://hqoptdkbgdjgnjsnlexh.supabase.co
--
-- HOW TO RUN (one time, ~10 seconds):
--   1. Open the Supabase Dashboard for this project.
--   2. Go to "SQL Editor" -> "New query".
--   3. Paste this ENTIRE file and click "Run".
--
-- This file is the five canonical migration files concatenated in the correct
-- order, with NO changes to their behaviour:
--     1) supabase_schema.sql          (users, api_tokens, shipments, shipment_events)
--     2) supabase_marketplace.sql     (user roles, locations, trucks, cargo)
--     3) supabase_bookings.sql        (match booking links)
--     4) supabase_shipment_details.sql (shipment cargo/planning detail columns)
--     5) supabase_booking_requests.sql (bookings, pricing, driver + RPCs)
--
-- It is fully IDEMPOTENT: safe to run again on a project that already has it.
--
-- ACCESS MODEL (do not change):
--   * Only the Laravel backend (backend/.env -> SUPABASE_SERVICE_KEY) talks to
--     these tables over PostgREST at {SUPABASE_URL}/rest/v1.
--   * RLS is enabled on EVERY table with NO policies for anon/authenticated,
--     so the public anon key can read/write nothing. The service key bypasses
--     RLS and must stay server-side only.
-- ============================================================================


-- ============================================================================
-- PART 1 / 5 — CORE SCHEMA  (from supabase_schema.sql)
-- ============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- users — Laravel-owned accounts.
--   identifier: normalized (trimmed + lowercased) email OR phone, unique.
--   password_hash: Laravel bcrypt hash (never a plain password).
-- ---------------------------------------------------------------------------
create table if not exists public.users (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  identifier    text not null,
  password_hash text not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create unique index if not exists users_identifier_unique
  on public.users (identifier);

-- ---------------------------------------------------------------------------
-- api_tokens — opaque bearer tokens issued at register/login.
-- Only the SHA-256 hash of the token is stored; the raw token never touches
-- the database or logs.
-- ---------------------------------------------------------------------------
create table if not exists public.api_tokens (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users (id) on delete cascade,
  token_hash   text not null,
  last_used_at timestamptz,
  expires_at   timestamptz,
  created_at   timestamptz not null default now()
);

create unique index if not exists api_tokens_hash_unique
  on public.api_tokens (token_hash);

create index if not exists api_tokens_user_idx
  on public.api_tokens (user_id);

-- ---------------------------------------------------------------------------
-- password_reset_tokens — single-use tokens for the forgot-password flow.
--   email: normalized (trimmed + lowercased) email OR phone, matching the
--          identifier the account signed up with.
--   token: SHA-256 hash of the one-time token; the raw token only ever exists
--          in the reset link sent to the user.
-- ---------------------------------------------------------------------------
create table if not exists public.password_reset_tokens (
  email      text primary key,
  token      text not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- shipments — one row per freight shipment.
--   status lifecycle:
--     booked     -> order received, not picked up yet   (counted as "Orders")
--     in_transit -> moving between origin and destination
--     delivered  -> completed
--     cancelled  -> called off
-- ---------------------------------------------------------------------------
create table if not exists public.shipments (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users (id) on delete cascade,
  reference  text not null,
  origin     text not null,
  destination text not null,
  status     text not null default 'booked'
             check (status in ('booked', 'in_transit', 'delivered', 'cancelled')),
  notes      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists shipments_reference_unique
  on public.shipments (reference);

create index if not exists shipments_user_created_idx
  on public.shipments (user_id, created_at desc);

create index if not exists shipments_user_status_idx
  on public.shipments (user_id, status);

-- ---------------------------------------------------------------------------
-- shipment_events — timeline entries that feed "Recent activity".
-- ---------------------------------------------------------------------------
create table if not exists public.shipment_events (
  id          uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.shipments (id) on delete cascade,
  user_id     uuid not null references public.users (id) on delete cascade,
  type        text not null default 'update'
              check (type in ('update', 'picked_up', 'in_transit', 'customs',
                              'out_for_delivery', 'delivered', 'delayed')),
  title       text not null,
  body        text,
  created_at  timestamptz not null default now()
);

create index if not exists shipment_events_user_created_idx
  on public.shipment_events (user_id, created_at desc);

create index if not exists shipment_events_shipment_idx
  on public.shipment_events (shipment_id, created_at desc);

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists users_set_updated_at on public.users;
create trigger users_set_updated_at
  before update on public.users
  for each row execute function public.set_updated_at();

drop trigger if exists shipments_set_updated_at on public.shipments;
create trigger shipments_set_updated_at
  before update on public.shipments
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security — deny-by-default.
-- With RLS on and no policies, anon/authenticated get zero rows through the
-- public REST API. The service_role key (backend only) bypasses RLS.
-- ---------------------------------------------------------------------------
alter table public.users          enable row level security;
alter table public.api_tokens     enable row level security;
alter table public.password_reset_tokens enable row level security;
alter table public.shipments      enable row level security;
alter table public.shipment_events enable row level security;

-- Intentionally NO policies for anon / authenticated roles.


-- ============================================================================
-- PART 2 / 5 — MARKETPLACE SCHEMA  (from supabase_marketplace.sql)
-- ============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- users: add the marketplace columns (a user is a truck owner, cargo owner or
-- an administrator). Existing accounts default to CARGO_OWNER.
-- ---------------------------------------------------------------------------
alter table public.users add column if not exists role         text not null default 'cargo_owner';
alter table public.users add column if not exists phone        text;
alter table public.users add column if not exists company_name text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'users_role_check'
  ) then
    alter table public.users
      add constraint users_role_check
      check (role in ('truck_owner', 'cargo_owner', 'admin'));
  end if;
end $$;

create index if not exists users_role_idx on public.users (role);

-- ---------------------------------------------------------------------------
-- locations — canonical places used by trucks (current location) and cargo
-- (pickup / destination). Matching compares by name (case-insensitive) today;
-- latitude/longitude feed GPS + distance work in a later version.
-- ---------------------------------------------------------------------------
create table if not exists public.locations (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  region     text,
  country    text not null default 'Tanzania',
  latitude   numeric(10, 7),
  longitude  numeric(10, 7),
  created_at timestamptz not null default now()
);

create unique index if not exists locations_name_unique on public.locations (lower(name));

-- Seed the main corridors (safe to re-run).
insert into public.locations (name, region) values
  ('Dar es Salaam', 'Dar es Salaam'),
  ('Arusha',        'Arusha'),
  ('Mwanza',        'Mwanza'),
  ('Dodoma',        'Dodoma'),
  ('Morogoro',      'Morogoro'),
  ('Mbeya',         'Mbeya'),
  ('Tanga',         'Tanga'),
  ('Nairobi',       'Nairobi')
on conflict (lower(name)) do nothing;

-- ---------------------------------------------------------------------------
-- trucks — supply side. One row per vehicle a truck owner registers.
-- ---------------------------------------------------------------------------
create table if not exists public.trucks (
  id                uuid primary key default gen_random_uuid(),
  owner_id          uuid not null references public.users (id) on delete cascade,
  registration_number text not null,
  truck_type        text not null,
  capacity_tons     numeric(10, 2) not null,
  current_location  text not null,
  availability_date date not null,
  status            text not null default 'available'
                    check (status in ('available', 'booked', 'in_transit', 'maintenance', 'inactive')),
  verification_status text not null default 'pending'
                    check (verification_status in ('pending', 'verified', 'rejected')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create unique index if not exists trucks_registration_unique
  on public.trucks (lower(registration_number));

create index if not exists trucks_owner_idx on public.trucks (owner_id);
create index if not exists trucks_status_idx on public.trucks (status);
create index if not exists trucks_location_idx on public.trucks (lower(current_location));

-- ---------------------------------------------------------------------------
-- cargo — demand side. One row per load a cargo owner posts.
-- ---------------------------------------------------------------------------
create table if not exists public.cargo (
  id                     uuid primary key default gen_random_uuid(),
  owner_id               uuid not null references public.users (id) on delete cascade,
  reference              text not null,
  cargo_type             text not null,
  description            text,
  weight_tons            numeric(10, 2) not null,
  pickup_location        text not null,
  destination_location   text not null,
  pickup_date            date not null,
  preferred_truck_type   text,
  budget                 numeric(15, 2),
  special_requirements   text,
  status                 text not null default 'posted'
                         check (status in ('posted', 'matched', 'booked', 'in_transit', 'delivered', 'completed', 'cancelled')),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create unique index if not exists cargo_reference_unique on public.cargo (reference);
create index if not exists cargo_owner_idx on public.cargo (owner_id);
create index if not exists cargo_status_idx on public.cargo (status);
create index if not exists cargo_pickup_idx on public.cargo (lower(pickup_location));
create index if not exists cargo_destination_idx on public.cargo (lower(destination_location));
create index if not exists cargo_pickup_date_idx on public.cargo (pickup_date);

-- ---------------------------------------------------------------------------
-- updated_at maintenance for the new tables.
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trucks_set_updated_at on public.trucks;
create trigger trucks_set_updated_at
  before update on public.trucks
  for each row execute function public.set_updated_at();

drop trigger if exists cargo_set_updated_at on public.cargo;
create trigger cargo_set_updated_at
  before update on public.cargo
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security — deny-by-default (same policy as the core schema).
-- ---------------------------------------------------------------------------
alter table public.locations enable row level security;
alter table public.trucks    enable row level security;
alter table public.cargo     enable row level security;

-- Intentionally NO policies for anon / authenticated roles.


-- ============================================================================
-- PART 3 / 5 — BOOKING LINKS  (from supabase_bookings.sql)
-- ============================================================================
-- Accepting a match (SRS §22) reserves both sides: the load is marked booked
-- and the truck is taken off the market. Each side stores a reference to its
-- counterpart so the pairing stays visible after matching results refresh.

alter table public.cargo
  add column if not exists matched_truck_id uuid
  references public.trucks (id) on delete set null;

alter table public.cargo
  add column if not exists matched_at timestamptz;

alter table public.trucks
  add column if not exists matched_cargo_id uuid
  references public.cargo (id) on delete set null;

alter table public.trucks
  add column if not exists matched_at timestamptz;

create index if not exists cargo_matched_truck_idx on public.cargo (matched_truck_id);
create index if not exists trucks_matched_cargo_idx on public.trucks (matched_cargo_id);


-- ============================================================================
-- PART 4 / 5 — SHIPMENT DETAILS  (from supabase_shipment_details.sql)
-- ============================================================================
-- Cargo + planning detail columns on public.shipments, plus an optional link to
-- the truck hauling the load. All nullable and idempotent.

alter table public.shipments add column if not exists cargo_type text;
alter table public.shipments add column if not exists cargo_description text;
alter table public.shipments add column if not exists weight_tons numeric(10,2);
alter table public.shipments add column if not exists dimensions text;
alter table public.shipments add column if not exists pickup_date date;
alter table public.shipments add column if not exists delivery_deadline date;
alter table public.shipments add column if not exists booking_reference text;

alter table public.shipments
  add column if not exists assigned_truck_id uuid
  references public.trucks (id) on delete set null;

do $$
begin
  alter table public.shipments
    add constraint shipments_weight_tons_check check (weight_tons is null or weight_tons > 0);
exception
  when duplicate_object then null;
end $$;

create index if not exists shipments_assigned_truck_idx
  on public.shipments (assigned_truck_id);


-- ============================================================================
-- PART 5 / 5 — BOOKING REQUESTS  (from supabase_booking_requests.sql)
-- ============================================================================
-- Explicit request → accept / reject booking lifecycle on a real table, plus
-- the pricing (trucks.rate_per_ton, cargo.currency) and driver (driver_name /
-- driver_phone) fields. Partial unique indexes prevent duplicate/conflicting
-- bookings; accept_booking() / cancel_booking() do the multi-row change in one
-- transaction.

alter table public.trucks add column if not exists driver_name  text;
alter table public.trucks add column if not exists driver_phone text;
alter table public.trucks add column if not exists rate_per_ton numeric(15, 2);

alter table public.cargo add column if not exists currency text not null default 'TZS';

create table if not exists public.bookings (
  id           uuid primary key default gen_random_uuid(),
  cargo_id     uuid not null references public.cargo (id) on delete cascade,
  truck_id     uuid not null references public.trucks (id) on delete cascade,
  requester_id uuid not null references public.users (id) on delete cascade,
  responder_id uuid not null references public.users (id) on delete cascade,
  status       text not null default 'pending'
               check (status in ('pending', 'accepted', 'rejected', 'cancelled')),
  price        numeric(15, 2),
  currency     text not null default 'TZS',
  message      text,
  decided_by   uuid references public.users (id) on delete set null,
  requested_at timestamptz not null default now(),
  decided_at   timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists bookings_cargo_idx     on public.bookings (cargo_id);
create index if not exists bookings_truck_idx     on public.bookings (truck_id);
create index if not exists bookings_requester_idx on public.bookings (requester_id);
create index if not exists bookings_responder_idx on public.bookings (responder_id);
create index if not exists bookings_status_idx    on public.bookings (status);

create unique index if not exists bookings_active_pair_unique
  on public.bookings (cargo_id, truck_id) where status in ('pending', 'accepted');
create unique index if not exists bookings_active_cargo_unique
  on public.bookings (cargo_id) where status = 'accepted';
create unique index if not exists bookings_active_truck_unique
  on public.bookings (truck_id) where status = 'accepted';

drop trigger if exists bookings_set_updated_at on public.bookings;
create trigger bookings_set_updated_at
  before update on public.bookings
  for each row execute function public.set_updated_at();

alter table public.bookings enable row level security;

create or replace function public.accept_booking(p_booking uuid, p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking  public.bookings;
  v_cargo    public.cargo;
  v_truck    public.trucks;
  v_cargo_id uuid;
  v_truck_id uuid;
begin
  -- Peek at the request (no lock) only to learn which load + truck it needs.
  select * into v_booking from public.bookings where id = p_booking;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found', 'field', 'booking',
      'message', 'This booking request no longer exists');
  end if;

  v_cargo_id := v_booking.cargo_id;
  v_truck_id := v_booking.truck_id;

  -- Lock the shared rows FIRST, always in cargo -> truck -> booking order, so
  -- two concurrent accepts/cancels can never deadlock on each other.
  select * into v_cargo from public.cargo where id = v_cargo_id for update;
  select * into v_truck from public.trucks where id = v_truck_id for update;

  if v_cargo.id is null or v_truck.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found', 'field', 'booking',
      'message', 'This booking request no longer exists');
  end if;

  select * into v_booking from public.bookings where id = p_booking for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found', 'field', 'booking',
      'message', 'This booking request no longer exists');
  end if;

  if p_user <> v_booking.responder_id then
    return jsonb_build_object('ok', false, 'error', 'forbidden', 'field', 'booking',
      'message', 'Only the other party can respond to this request');
  end if;

  if v_booking.status <> 'pending' then
    return jsonb_build_object('ok', false, 'error', 'conflict', 'field', 'booking',
      'message', 'This request has already been answered');
  end if;

  if v_cargo.status <> 'posted' then
    return jsonb_build_object('ok', false, 'error', 'conflict', 'field', 'cargo',
      'message', 'That load has just been booked');
  end if;

  if v_truck.status <> 'available' then
    return jsonb_build_object('ok', false, 'error', 'conflict', 'field', 'truck',
      'message', 'That truck has just been booked');
  end if;

  update public.bookings
     set status = 'accepted', decided_by = p_user, decided_at = now()
   where id = p_booking;

  update public.cargo
     set status = 'booked', matched_truck_id = v_truck_id, matched_at = now()
   where id = v_cargo_id;

  update public.trucks
     set status = 'booked', matched_cargo_id = v_cargo_id, matched_at = now()
   where id = v_truck_id;

  update public.bookings
     set status = 'rejected', decided_by = p_user, decided_at = now()
   where id <> p_booking
     and status = 'pending'
     and (cargo_id = v_cargo_id or truck_id = v_truck_id);

  select * into v_booking from public.bookings where id = p_booking;
  select * into v_cargo   from public.cargo   where id = v_cargo_id;
  select * into v_truck   from public.trucks  where id = v_truck_id;

  return jsonb_build_object(
    'ok', true,
    'booking', to_jsonb(v_booking),
    'cargo', to_jsonb(v_cargo),
    'truck', to_jsonb(v_truck)
  );
end;
$$;

create or replace function public.cancel_booking(p_booking uuid, p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking  public.bookings;
  v_cargo    public.cargo;
  v_truck    public.trucks;
  v_cargo_id uuid;
  v_truck_id uuid;
begin
  -- Peek at the request (no lock) only to learn which load + truck it needs.
  select * into v_booking from public.bookings where id = p_booking;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found', 'field', 'booking',
      'message', 'This booking no longer exists');
  end if;

  v_cargo_id := v_booking.cargo_id;
  v_truck_id := v_booking.truck_id;

  -- Lock in the same cargo -> truck -> booking order as accept_booking() so the
  -- two functions can never deadlock when they fire at the same time.
  select * into v_cargo from public.cargo where id = v_cargo_id for update;
  select * into v_truck from public.trucks where id = v_truck_id for update;

  select * into v_booking from public.bookings where id = p_booking for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found', 'field', 'booking',
      'message', 'This booking no longer exists');
  end if;

  if p_user <> v_booking.requester_id and p_user <> v_booking.responder_id then
    return jsonb_build_object('ok', false, 'error', 'forbidden', 'field', 'booking',
      'message', 'You can only cancel your own bookings');
  end if;

  if v_booking.status in ('cancelled', 'rejected') then
    return jsonb_build_object('ok', false, 'error', 'conflict', 'field', 'booking',
      'message', 'This booking is already closed');
  end if;

  if v_booking.status = 'accepted' then
    update public.cargo
       set status = 'posted', matched_truck_id = null, matched_at = null
     where id = v_cargo_id and matched_truck_id = v_truck_id;

    update public.trucks
       set status = 'available', matched_cargo_id = null, matched_at = null
     where id = v_truck_id and matched_cargo_id = v_cargo_id;
  end if;

  update public.bookings
     set status = 'cancelled', decided_by = p_user, decided_at = now()
   where id = p_booking;

  select * into v_booking from public.bookings where id = p_booking;
  select * into v_cargo   from public.cargo   where id = v_cargo_id;
  select * into v_truck   from public.trucks  where id = v_truck_id;

  return jsonb_build_object(
    'ok', true,
    'booking', to_jsonb(v_booking),
    'cargo', to_jsonb(v_cargo),
    'truck', to_jsonb(v_truck)
  );
end;
$$;


-- ---------------------------------------------------------------------------
-- Lock the RPCs down. accept_booking()/cancel_booking() are SECURITY DEFINER
-- and TRUST the p_user argument, so they must NOT be callable by the public,
-- anon or authenticated roles (PostgREST grants EXECUTE to PUBLIC by default,
-- which would let anyone POST /rest/v1/rpc/accept_booking with a forged user).
-- Only the backend's service_role key may execute them.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    revoke execute on function public.accept_booking(uuid, uuid) from public;
    revoke execute on function public.cancel_booking(uuid, uuid) from public;

    if exists (select 1 from pg_roles where rolname = 'anon') then
      revoke execute on function public.accept_booking(uuid, uuid) from anon;
      revoke execute on function public.cancel_booking(uuid, uuid) from anon;
    end if;

    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      revoke execute on function public.accept_booking(uuid, uuid) from authenticated;
      revoke execute on function public.cancel_booking(uuid, uuid) from authenticated;
    end if;

    grant execute on function public.accept_booking(uuid, uuid) to service_role;
    grant execute on function public.cancel_booking(uuid, uuid) to service_role;
  end if;
end $$;


-- ============================================================================
-- DONE. Expected tables:
--   public.users, public.api_tokens, public.shipments, public.shipment_events,
--   public.locations, public.trucks, public.cargo, public.bookings
-- Verify in the Dashboard: Table Editor, or run:
--   select table_name from information_schema.tables
--   where table_schema = 'public' order by table_name;
-- ============================================================================
