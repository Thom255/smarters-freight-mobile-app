-- ============================================================================
-- SMARTERS FREIGHT — Marketplace schema (run AFTER supabase_schema.sql)
--
-- Adds the freight-marketplace core described in the SRS:
--   * users.role / phone / company_name   (account type & contact)
--   * locations                           (shared place list, seeded)
--   * trucks                              (truck-owner supply)
--   * cargo                               (cargo-owner demand)
--
-- Everything here is idempotent: it is safe to run again on a project that
-- already has supabase_schema.sql applied. Run the whole file in the Supabase
-- SQL Editor (Dashboard → SQL Editor → New query → paste → Run).
--
-- Access model is unchanged: only the Laravel backend (service key) talks to
-- these tables; RLS is on with no anon/authenticated policies.
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
