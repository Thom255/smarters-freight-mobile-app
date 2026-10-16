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
-- This file is the three canonical migration files concatenated in the correct
-- order, with NO changes to their behaviour:
--     1) supabase_schema.sql      (users, api_tokens, shipments, shipment_events)
--     2) supabase_marketplace.sql (user roles, locations, trucks, cargo)
--     3) supabase_bookings.sql    (match booking links)
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
-- PART 1 / 3 — CORE SCHEMA  (from supabase_schema.sql)
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
alter table public.shipments      enable row level security;
alter table public.shipment_events enable row level security;

-- Intentionally NO policies for anon / authenticated roles.


-- ============================================================================
-- PART 2 / 3 — MARKETPLACE SCHEMA  (from supabase_marketplace.sql)
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
-- PART 3 / 3 — BOOKING LINKS  (from supabase_bookings.sql)
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
-- DONE. Expected tables:
--   public.users, public.api_tokens, public.shipments, public.shipment_events,
--   public.locations, public.trucks, public.cargo
-- Verify in the Dashboard: Table Editor, or run:
--   select table_name from information_schema.tables
--   where table_schema = 'public' order by table_name;
-- ============================================================================
