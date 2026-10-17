-- ============================================================================
-- SMARTERS FREIGHT — Supabase schema
-- Run this whole file in the Supabase SQL Editor (Dashboard → SQL Editor →
-- New query → paste → Run). It is safe to run once on a fresh project.
--
-- Access model:
--   * The Laravel backend (backend/.env → SUPABASE_SERVICE_KEY) is the ONLY
--     client of these tables. It talks to PostgREST at {SUPABASE_URL}/rest/v1.
--   * RLS is enabled on every table with NO policies for anon/authenticated,
--     so the public anon key can read nothing. The service key bypasses RLS.
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
--     booked     → order received, not picked up yet   (counted as "Orders")
--     in_transit → moving between origin and destination
--     delivered  → completed
--     cancelled  → called off
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
-- Do not add any unless a future feature must read these tables from the app
-- directly — the mobile app must always go through the Laravel API.
