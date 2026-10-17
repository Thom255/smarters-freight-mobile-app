-- ============================================================================
-- SMARTERS FREIGHT — Booking requests, pricing & driver details
-- (run AFTER supabase_marketplace.sql and supabase_bookings.sql)
-- ============================================================================
-- Replaces the instantaneous "accept a match" booking with an explicit
-- request → accept / reject lifecycle backed by a real table, and adds the
-- pricing + driver fields the marketplace needs:
--
--   * trucks.driver_name / driver_phone  → who is driving the vehicle
--   * trucks.rate_per_ton                → quoting basis for the estimate
--   * cargo.currency                     → currency for budget / quotes
--   * bookings                           → one row per booking request
--
-- Concurrency safety (SRS "prevention of duplicate bookings"):
--   * partial unique indexes keep at most one ACTIVE booking per cargo, per
--     truck and per (cargo, truck) pair — enforced by Postgres itself;
--   * accept_booking() / cancel_booking() are SECURITY DEFINER functions so
--     the multi-row state change runs in a single transaction (the backend
--     talks to PostgREST and cannot span transactions by itself).
--
-- Fully IDEMPOTENT: safe to re-run.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- trucks — driver + pricing columns.
-- ---------------------------------------------------------------------------
alter table public.trucks add column if not exists driver_name  text;
alter table public.trucks add column if not exists driver_phone text;
alter table public.trucks add column if not exists rate_per_ton numeric(15, 2);

-- ---------------------------------------------------------------------------
-- cargo — quoting currency (defaults to the local shilling).
-- ---------------------------------------------------------------------------
alter table public.cargo add column if not exists currency text not null default 'TZS';

-- ---------------------------------------------------------------------------
-- bookings — one row per booking request between a load and a truck.
--   requester_id  the party who asked for the booking
--   responder_id  the counterparty who must accept / reject it
--   status        pending → accepted | rejected | cancelled
--   price         quoted price (falls back to rate × weight, then budget)
-- ---------------------------------------------------------------------------
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

-- At most one ACTIVE booking per pair, per cargo and per truck.
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

-- ---------------------------------------------------------------------------
-- accept_booking — atomically accept a pending request. Locks the booking,
-- load and truck rows, re-checks they are still free, reserves both sides and
-- auto-rejects the competing pending requests. Returns a JSON envelope so the
-- backend can answer with the right HTTP status.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- cancel_booking — atomically cancel a pending or accepted request. When the
-- booking was accepted it also hands both sides back to the marketplace (only
-- where they still point at each other). Either party may cancel.
-- ---------------------------------------------------------------------------
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
-- DONE. Verify with:
--   select column_name from information_schema.columns
--   where table_schema = 'public' and table_name = 'bookings' order by column_name;
-- ============================================================================
