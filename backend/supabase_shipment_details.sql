-- ============================================================================
-- SMARTERS FREIGHT — Shipment details (run AFTER supabase_schema.sql and
-- supabase_marketplace.sql, because assigned_truck_id references public.trucks)
-- ============================================================================
-- Adds the cargo + planning fields the shipment screens collect, plus an
-- optional link to the truck hauling the load. Everything is nullable so the
-- migration is safe to run on a project that already has shipments.
--
-- Fully IDEMPOTENT: safe to run again.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- shipments — additional detail columns.
--   cargo_type / cargo_description → what is moving
--   weight_tons                    → how heavy it is (NULL when unknown)
--   dimensions                     → free text, e.g. "6 × 2.4 × 2.6 m"
--   pickup_date                    → planned pickup day
--   delivery_deadline              → the day the load is due
--   booking_reference              → external/booking reference, when any
--   assigned_truck_id              → the truck hauling it, when known
-- ---------------------------------------------------------------------------
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

-- Weight, when provided, must be positive.
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
-- DONE. Verify with:
--   select column_name from information_schema.columns
--   where table_schema = 'public' and table_name = 'shipments' order by column_name;
-- ============================================================================
