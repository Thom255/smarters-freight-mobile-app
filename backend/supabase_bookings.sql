-- ============================================================================
-- SMARTERS FREIGHT — Match booking links (run AFTER supabase_marketplace.sql)
--
-- Accepting a match (SRS §22) reserves both sides: the load is marked booked
-- and the truck is taken off the market. To keep the pairing visible after the
-- match disappears from the (stateless) matching results, each side stores a
-- reference to its counterpart:
--
--   cargo.matched_truck_id  → the reserved truck
--   trucks.matched_cargo_id → the load the truck is booked for
--
-- Both columns are nullable and idempotent, and the FK uses ON DELETE SET NULL
-- so removing a truck/load never cascades into the other table.
--
-- Run the whole file in the Supabase SQL Editor (Dashboard → SQL Editor → New
-- query → paste → Run). Safe to re-run.
-- ============================================================================

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
