-- ============================================================================
-- SMARTERS FREIGHT — 8% platform commission ledger (finalised)
-- (run AFTER supabase_marketplace.sql, supabase_bookings.sql and
--  supabase_booking_requests.sql — i.e. after the all-in-one supabase_setup.sql)
--
-- HOW TO RUN: Supabase Dashboard → SQL Editor → New query → paste → Run.
-- The editor submits the whole script as ONE implicit transaction: either
-- every statement below commits, or none of them do. The self-check at the
-- end raises an exception if any guarantee below is missing, so a half-fit
-- schema can never be left behind silently.
--
-- WHAT THIS LEDGER GUARANTEES
--
--   Smarters Freight earns 8.0000% of the AGREED cargo transportation price,
--   computed by the Laravel backend (CommissionCalculator, integer cents) —
--   never by the Expo app and never accepted from a request body:
--
--       cargo_price          1,000,000.00
--       commission_rate           8.0000   (fixed — see rule 2)
--       commission_amount     80,000.00    = round(cargo_price × 8%)
--       provider_net_amount  920,000.00    = cargo_price − commission_amount
--
--   1. WHEN A COMMISSION IS BORN (the booking lifecycle)
--        booking requested / rejected  → no commission exists
--        booking ACCEPTED              → one `pending` row, keyed to that
--                                         booking (unique index) and that load
--        load delivered/completed      → pending → earned   (work performed)
--        booking or load cancelled     → pending|earned → cancelled
--        admin settles with evidence   → pending|earned → paid (payment ref)
--        admin refunds                 → paid → refunded
--      Rejected requests create nothing; a replayed accept is a 409 and the
--      unique index makes a second row impossible; after a cancellation the
--      partial unique index frees the load, so a REBOOKING may create one new
--      commission while the cancelled record stays excluded from revenue.
--      Cancelled/refunded records are never deleted — they are the audit trail.
--
--   2. THE RATE IS NOT CONFIGURABLE
--       check `commissions_rate_check`: commission_rate = 8.0000 exactly.
--       The money checks below then pin the split: with rate fixed at 8.0000,
--       `commission_amount = round(cargo_price * rate / 100, 2)` can only be
--       80,000.00 for 1,000,000.00, and net must be price − amount.
--
--   3. FINANCIAL HISTORY CANNOT VANISH
--       Both foreign keys are ON DELETE RESTRICT (not CASCADE, not SET NULL):
--       a load or booking that has ledger rows cannot be deleted at all —
--       cancel it instead. The row trigger refuses DELETE and TRUNCATE on the
--       ledger itself, and service_role is granted no DELETE privilege, so
--       PostgREST cannot delete ledger rows either.
--
--   4. STATES ARE ONLY REACHED, NEVER INSERTED, AND ONLY WITH EVIDENCE
--       The BEFORE INSERT gate accepts `pending` alone (no settlement
--       timestamps, no payment reference at birth). earned/paid/cancelled/
--       refunded are reachable only through the validated UPDATE transition
--       table, and only the backend's service_role can write at all.
--       Flipping to `paid` REQUIRES a payment reference (>= 4 characters,
--       matching the /settle API) and flipping to `refunded` REQUIRES a
--       refund reason (>= 4 characters, matching /refund). Once recorded,
--       settlement evidence and milestone timestamps can never be edited or
--       cleared. The financial columns themselves — cargo_id, booking_id,
--       cargo_price, commission_rate, commission_amount, provider_net_amount,
--       currency — are FROZEN when the row is born: no UPDATE can rewrite
--       the numbers behind the revenue totals.
--
--   5. ACCESS MODEL (unchanged from the rest of the project)
--       RLS enabled, NO policies → anon/authenticated (the Expo client's keys)
--       can see and touch nothing; privileges are explicitly revoked from them.
--       Only the Laravel backend's service key (server-side only) may read or
--       append. The anon key must never ship with any write capability here.
--
-- RE-RUN SAFETY (exact scope — no broader claim): the script is safe to run
-- again on a fresh OR already-migrated database. On a re-run it
--   (a) adds every missing column, default, constraint, index, trigger and
--       grant,
--   (b) tightens — and NEVER loosens — FK actions, the rate rule and the
--       privilege grants (an older 0-100 rate check is only dropped AFTER
--       its strict replacement is in place; DELETE is revoked from
--       service_role before the exact SELECT/INSERT/UPDATE grants),
--   (c) removes any leftover RLS policy on the ledger so the table stays
--       deny-by-default (drop policy — never a table or a row), and
--   (d) VERIFIES every column type, nullability, default, constraint
--       definition, index, foreign key, trigger definition, RLS mode,
--       policy count and grant in the final self-check. Anything it cannot
--       verify aborts the whole transaction, so a schema that deviates in
--       any way is never silently left behind.
-- Existing ledger ROWS are never modified. If an earlier draft table has
-- rows, run read-only preflight P5 first to confirm they satisfy the strict
-- rules — that is the one thing this script checks structurally but cannot
-- judge for you.
-- ============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- commissions — the platform's earnings ledger (append-only).
--   cargo_id / booking_id   what the amount is owed on (RESTRICT, see below)
--   cargo_price             the AGREED transportation price (snapshot)
--   commission_rate         8.0000 percent — fixed
--   commission_amount       the platform's 8%
--   provider_net_amount     the transport provider's 92%
--   status                  pending | earned | paid | cancelled | refunded
--   payment_reference       evidence recorded when a settlement is made
-- ---------------------------------------------------------------------------
create table if not exists public.commissions (
  id                  uuid primary key default gen_random_uuid(),
  cargo_id            uuid not null references public.cargo (id) on delete restrict,
  booking_id          uuid references public.bookings (id) on delete restrict,
  cargo_price         numeric(15, 2) not null,
  commission_rate     numeric(6, 4)   not null default 8.0000,
  commission_amount   numeric(15, 2)  not null,
  provider_net_amount numeric(15, 2)  not null,
  currency            text            not null default 'TZS',
  status              text            not null default 'pending'
                      check (status in ('pending', 'earned', 'paid', 'cancelled', 'refunded')),
  payment_reference   text,
  refund_reason       text,
  earned_at           timestamptz,
  paid_at             timestamptz,
  cancelled_at        timestamptz,
  refunded_at         timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  -- Money rules, stated inline for a fresh create and re-asserted by name in
  -- the DO block below so an existing table ends up with them too.
  check (cargo_price > 0),
  check (commission_rate = 8.0000),
  check (commission_amount >= 0),
  check (commission_amount = round(cargo_price * commission_rate / 100, 2)),
  check (provider_net_amount = cargo_price - commission_amount)
);

-- ---------------------------------------------------------------------------
-- Existing-table safety: if an earlier draft already created `commissions`,
-- bring its COLUMNS and DEFAULTS up to this definition before any constraint
-- work. `add column if not exists` never touches a column that is already
-- correct, and the self-check at the end verifies the type and nullability of
-- EVERY column, so a draft with a wrong shape cannot survive the transaction
-- silently.
-- ---------------------------------------------------------------------------
alter table public.commissions add column if not exists id                  uuid primary key default gen_random_uuid();
alter table public.commissions add column if not exists cargo_id            uuid not null;
alter table public.commissions add column if not exists booking_id          uuid;
alter table public.commissions add column if not exists cargo_price         numeric(15, 2) not null;
alter table public.commissions add column if not exists commission_rate     numeric(6, 4)   not null default 8.0000;
alter table public.commissions add column if not exists commission_amount   numeric(15, 2)  not null;
alter table public.commissions add column if not exists provider_net_amount numeric(15, 2)  not null;
alter table public.commissions add column if not exists currency            text            not null default 'TZS';
alter table public.commissions add column if not exists status              text            not null default 'pending';
alter table public.commissions add column if not exists payment_reference   text;
alter table public.commissions add column if not exists refund_reason       text;
alter table public.commissions add column if not exists earned_at           timestamptz;
alter table public.commissions add column if not exists paid_at             timestamptz;
alter table public.commissions add column if not exists cancelled_at        timestamptz;
alter table public.commissions add column if not exists refunded_at         timestamptz;
alter table public.commissions add column if not exists created_at          timestamptz not null default now();
alter table public.commissions add column if not exists updated_at          timestamptz not null default now();

alter table public.commissions alter column id              set default gen_random_uuid();
alter table public.commissions alter column commission_rate set default 8.0000;
alter table public.commissions alter column status          set default 'pending';
alter table public.commissions alter column currency        set default 'TZS';

-- Primary key and status allow-list when the table came from an earlier
-- draft (on a fresh create both already exist, so these are no-ops).
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.commissions'::regclass and contype = 'p'
  ) then
    alter table public.commissions add primary key (id);
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.commissions'::regclass
       and conname = 'commissions_status_check'
  ) then
    alter table public.commissions
      add constraint commissions_status_check
      check (status in ('pending', 'earned', 'paid', 'cancelled', 'refunded'));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Named constraints, idempotently.
--
-- Order matters for safety: the STRICT rate rule is added FIRST and the older
-- weaker 0–100 draft rule (commissions_rate_range) is dropped only afterwards,
-- in the same block. If any existing row failed the strict rule the add would
-- abort the block (and the transaction), leaving the old rule in place rather
-- than removing the only protection.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.commissions'::regclass
       and conname = 'commissions_rate_check'
  ) then
    alter table public.commissions
      add constraint commissions_rate_check check (commission_rate = 8.0000);
  end if;

  if exists (
    select 1 from pg_constraint
     where conrelid = 'public.commissions'::regclass
       and conname = 'commissions_rate_range'
  ) then
    alter table public.commissions drop constraint commissions_rate_range;
  end if;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.commissions'::regclass
       and conname = 'commissions_price_positive'
  ) then
    alter table public.commissions
      add constraint commissions_price_positive check (cargo_price > 0);
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.commissions'::regclass
       and conname = 'commissions_amount_check'
  ) then
    alter table public.commissions
      add constraint commissions_amount_check
      check (commission_amount = round(cargo_price * commission_rate / 100, 2));
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.commissions'::regclass
       and conname = 'commissions_net_check'
  ) then
    alter table public.commissions
      add constraint commissions_net_check
      check (provider_net_amount = cargo_price - commission_amount);
  end if;
exception
  when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- Foreign-key strategy: ON DELETE RESTRICT on both sides.
--
--   CASCADE  would silently erase financial history when a load/booking row
--            disappears — unacceptable for a revenue ledger.
--   SET NULL would keep the row but destroy its traceability (cargo_id is
--            NOT NULL anyway).
--   RESTRICT makes deletion of a referenced load or booking impossible: the
--            data must be cancelled through its status instead. The app has no
--            delete endpoint for cargo or bookings (only status changes), so
--            this blocks no existing workflow.
--
-- The block only rewrites the keys when they are not already RESTRICT, so a
-- re-run costs nothing and never loosens an existing action.
-- ---------------------------------------------------------------------------
do $$
declare
  v_action "char";
begin
  select con.confdeltype into v_action
    from pg_constraint con
   where con.conrelid = 'public.commissions'::regclass
     and con.conname = 'commissions_cargo_id_fkey';

  if v_action is distinct from 'r' then
    alter table public.commissions drop constraint if exists commissions_cargo_id_fkey;
    alter table public.commissions
      add constraint commissions_cargo_id_fkey
      foreign key (cargo_id) references public.cargo (id) on delete restrict;
  end if;

  select con.confdeltype into v_action
    from pg_constraint con
   where con.conrelid = 'public.commissions'::regclass
     and con.conname = 'commissions_booking_id_fkey';

  if v_action is distinct from 'r' then
    alter table public.commissions drop constraint if exists commissions_booking_id_fkey;
    alter table public.commissions
      add constraint commissions_booking_id_fkey
      foreign key (booking_id) references public.bookings (id) on delete restrict;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Uniqueness: one commission per booking (replay/duplicate protection), and
-- ONE LIVE commission per load so revenue can never be double-counted. A
-- cancelled/refunded record releases the load for a legitimate rebooking.
-- ---------------------------------------------------------------------------
create unique index if not exists commissions_booking_unique
  on public.commissions (booking_id)
  where booking_id is not null;

create unique index if not exists commissions_active_cargo_unique
  on public.commissions (cargo_id)
  where status in ('pending', 'earned', 'paid');

create index if not exists commissions_cargo_idx   on public.commissions (cargo_id);
create index if not exists commissions_status_idx on public.commissions (status);
create index if not exists commissions_created_idx on public.commissions (created_at desc);

-- updated_at maintenance, same convention as cargo/bookings (set_updated_at()
-- is created in supabase_marketplace.sql / supabase_schema.sql).
drop trigger if exists commissions_set_updated_at on public.commissions;
create trigger commissions_set_updated_at
  before update on public.commissions
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- set_commission_timestamps — the state machine.
--
-- INSERT: a ledger row may only be BORN `pending`, with no settlement
--         timestamps and no settlement evidence. This is the single authorised
--         way into the ledger (the backend's accept-booking workflow, which
--         computes the amounts server-side).
--
-- UPDATE: the financial columns are frozen first (cargo_id, booking_id,
--         cargo_price, commission_rate, commission_amount,
--         provider_net_amount, currency), then transitions are a closed set —
--         history cannot be rewound and money cannot appear without an event:
--             pending  → earned | paid | cancelled
--             earned   → paid | cancelled
--             paid     → refunded      (only an explicit reversal removes it)
--         `paid` demands payment evidence and `refunded` demands a refund
--         reason (both >= 4 characters, mirroring the admin API's own
--         validation). Milestone timestamps are stamped the moment the status
--         flips, if the caller did not set them itself, and are write-once
--         afterwards — as is payment_reference / refund_reason once filled.
-- ---------------------------------------------------------------------------
create or replace function public.set_commission_timestamps()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'pending' then
      raise exception 'commissions may only be inserted as "pending" (received: %)', new.status
        using hint = 'earned/paid/cancelled/refunded are reached through the backend workflow, never at insert time.';
    end if;

    if new.earned_at is not null
       or new.paid_at is not null
       or new.cancelled_at is not null
       or new.refunded_at is not null then
      raise exception 'a new commission cannot carry settlement timestamps';
    end if;

    if new.payment_reference is not null or new.refund_reason is not null then
      raise exception 'a new commission cannot carry settlement evidence';
    end if;

    return new;
  end if;

  -- Financial history is FROZEN: these columns were computed by the backend
  -- when the row was born and no later write may rewrite them. (Only status,
  -- the milestone timestamps and the settlement evidence may ever change.)
  if new.cargo_id is distinct from old.cargo_id
     or new.booking_id is distinct from old.booking_id
     or new.cargo_price is distinct from old.cargo_price
     or new.commission_rate is distinct from old.commission_rate
     or new.commission_amount is distinct from old.commission_amount
     or new.provider_net_amount is distinct from old.provider_net_amount
     or new.currency is distinct from old.currency then
    raise exception 'commission financial fields are immutable after creation'
      using hint = 'cargo/booking links, price, rate, amounts and currency are fixed at insert; only status, timestamps and settlement evidence may change.';
  end if;

  -- Milestone timestamps are write-once: a recorded event never changes.
  if old.earned_at is not null and new.earned_at is distinct from old.earned_at then
    raise exception 'earned_at cannot change once recorded';
  end if;
  if old.paid_at is not null and new.paid_at is distinct from old.paid_at then
    raise exception 'paid_at cannot change once recorded';
  end if;
  if old.cancelled_at is not null and new.cancelled_at is distinct from old.cancelled_at then
    raise exception 'cancelled_at cannot change once recorded';
  end if;
  if old.refunded_at is not null and new.refunded_at is distinct from old.refunded_at then
    raise exception 'refunded_at cannot change once recorded';
  end if;

  -- Settlement evidence is write-once too: fill it in WITH the status flip,
  -- then it may never be edited or cleared — the audit trail stays intact.
  if old.payment_reference is not null
     and new.payment_reference is distinct from old.payment_reference then
    raise exception 'payment evidence cannot be changed once recorded';
  end if;
  if old.refund_reason is not null
     and new.refund_reason is distinct from old.refund_reason then
    raise exception 'refund evidence cannot be changed once recorded';
  end if;

  if new.status is distinct from old.status then
    if not (
         (old.status = 'pending'   and new.status in ('earned', 'paid', 'cancelled'))
      or (old.status = 'earned'    and new.status in ('paid', 'cancelled'))
      or (old.status = 'paid'      and new.status = 'refunded')
    ) then
      raise exception 'invalid commission status transition: % -> %', old.status, new.status;
    end if;

    -- Money is only "paid" with proof, and only an explicit, reasoned
    -- reversal may move it out of the paid bucket. Both thresholds (4
    -- characters) match the admin API's own request validation on
    -- /admin/commissions/{id}/settle and /refund.
    if new.status = 'paid'
       and (new.payment_reference is null
            or length(btrim(new.payment_reference)) < 4) then
      raise exception 'a commission cannot become paid without payment evidence'
        using hint = 'Send the settlement reference (at least 4 characters) in the same UPDATE that flips status to paid.';
    end if;

    if new.status = 'refunded'
       and (new.refund_reason is null
            or length(btrim(new.refund_reason)) < 4) then
      raise exception 'a commission cannot become refunded without a refund reason'
        using hint = 'Send the refund reason (at least 4 characters) in the same UPDATE that flips status to refunded.';
    end if;
  end if;

  if new.status = 'earned'    and new.earned_at   is null then new.earned_at   = coalesce(old.earned_at,   now()); end if;
  if new.status = 'paid'      and new.paid_at     is null then new.paid_at     = coalesce(old.paid_at,     now()); end if;
  if new.status = 'cancelled' and new.cancelled_at is null then new.cancelled_at = coalesce(old.cancelled_at, now()); end if;
  if new.status = 'refunded'  and new.refunded_at is null then new.refunded_at  = coalesce(old.refunded_at,  now()); end if;

  return new;
end;
$$;

drop trigger if exists commissions_set_timestamps on public.commissions;
create trigger commissions_set_timestamps
  before insert or update on public.commissions
  for each row execute function public.set_commission_timestamps();

-- ---------------------------------------------------------------------------
-- Append-only protection: the ledger itself can never be deleted or emptied,
-- by any role (a trigger fires for the table owner too, where grants and RLS
-- do not apply). Corrections happen through status transitions, not removal.
-- ---------------------------------------------------------------------------
create or replace function public.commissions_block_write_loss()
returns trigger
language plpgsql
as $$
begin
  raise exception 'the commission ledger is append-only: % is not allowed', tg_op
    using hint = 'Reverse a record with its status (cancelled/refunded) instead of deleting it.';
end;
$$;

drop trigger if exists commissions_block_delete on public.commissions;
create trigger commissions_block_delete
  before delete on public.commissions
  for each row execute function public.commissions_block_write_loss();

drop trigger if exists commissions_block_truncate on public.commissions;
create trigger commissions_block_truncate
  before truncate on public.commissions
  for each statement execute function public.commissions_block_write_loss();

-- ---------------------------------------------------------------------------
-- Row Level Security — deny-by-default (same policy as every other table),
-- with explicit revocations because Supabase's default privileges normally
-- hand new tables to anon/authenticated. The Expo client authenticates with
-- the ANON key; with no policies and no privileges it can read nothing here,
-- and the service-role key stays server-side in backend/.env only.
-- ---------------------------------------------------------------------------
alter table public.commissions enable row level security;

-- Intentionally NO policies for anon / authenticated / public — ever. An
-- earlier draft may have left a permissive policy behind; remove them ALL so
-- the ledger is strictly deny-by-default even for the Expo client's keys.
-- (On a fresh install this loop finds nothing and changes nothing.)
do $$
declare
  p record;
begin
  for p in
    select policyname from pg_policies
     where schemaname = 'public' and tablename = 'commissions'
  loop
    execute format('drop policy %I on public.commissions', p.policyname);
  end loop;
end $$;

-- Roles: no anon / authenticated / public access.

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.commissions from anon;
  end if;

  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on public.commissions from authenticated;
  end if;

  revoke all on public.commissions from public;

  if exists (select 1 from pg_roles where rolname = 'service_role') then
    -- Normalise first (a previous run of an earlier draft may have granted
    -- DELETE), then grant exactly the capabilities the backend workflow needs:
    -- read the ledger, append a pending row, transition statuses. Never DELETE.
    revoke all on public.commissions from service_role;
    grant select, insert, update on public.commissions to service_role;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- SELF-CHECK — runs last, inside the same transaction. Any deviation raises,
-- so the script either commits with every guarantee in place or leaves the
-- database exactly as it was. It only reads catalog and privilege metadata.
-- ---------------------------------------------------------------------------
do $$
declare
  v_missing text[] := '{}';
  v_col     record;
  v_trig    record;
  v_def     text;
begin
  if to_regclass('public.commissions') is null then
    raise exception 'commissions table does not exist after the migration';
  end if;

  -- Column shape: an earlier-draft table must match this definition exactly
  -- in type and nullability — anything else aborts the transaction.
  for v_col in
    select * from (values
      ('id',                  'uuid',                    'NO'),
      ('cargo_id',            'uuid',                    'NO'),
      ('booking_id',          'uuid',                    'YES'),
      ('cargo_price',         'numeric',                 'NO'),
      ('commission_rate',     'numeric',                 'NO'),
      ('commission_amount',   'numeric',                 'NO'),
      ('provider_net_amount', 'numeric',                 'NO'),
      ('currency',            'text',                    'NO'),
      ('status',              'text',                    'NO'),
      ('payment_reference',   'text',                    'YES'),
      ('refund_reason',       'text',                    'YES'),
      ('earned_at',           'timestamp with time zone', 'YES'),
      ('paid_at',             'timestamp with time zone', 'YES'),
      ('cancelled_at',        'timestamp with time zone', 'YES'),
      ('refunded_at',         'timestamp with time zone', 'YES'),
      ('created_at',          'timestamp with time zone', 'NO'),
      ('updated_at',          'timestamp with time zone', 'NO')
    ) as s (col_name, col_type, col_nullable)
  loop
    if not exists (
      select 1 from information_schema.columns c
       where c.table_schema = 'public'
         and c.table_name   = 'commissions'
         and c.column_name  = v_col.col_name
         and c.data_type    = v_col.col_type
         and c.is_nullable  = v_col.col_nullable
    ) then
      v_missing := v_missing || 'column ' || v_col.col_name
                  || ' must be ' || v_col.col_type
                  || case when v_col.col_nullable = 'NO' then ' not null' else '' end;
    end if;
  end loop;

  if exists (
    select 1 from information_schema.columns c
     where c.table_schema = 'public'
       and c.table_name = 'commissions'
       and c.column_name in ('cargo_price', 'commission_amount', 'provider_net_amount')
       and (c.numeric_precision is distinct from 15 or c.numeric_scale is distinct from 2)
  ) then
    v_missing := v_missing || 'money columns must be numeric(15,2)';
  end if;

  if exists (
    select 1 from information_schema.columns c
     where c.table_schema = 'public'
       and c.table_name = 'commissions'
       and c.column_name = 'commission_rate'
       and (c.numeric_precision is distinct from 6 or c.numeric_scale is distinct from 4)
  ) then
    v_missing := v_missing || 'commission_rate must be numeric(6,4)';
  end if;

  if exists (
    select 1 from information_schema.columns c
     where c.table_schema = 'public'
       and c.table_name = 'commissions'
       and c.column_name in ('id', 'commission_rate', 'status', 'currency')
       and c.column_default is null
  ) then
    v_missing := v_missing || 'id/commission_rate/status/currency must carry their defaults';
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.commissions'::regclass and contype = 'p'
  ) then
    v_missing := v_missing || 'primary key (id)';
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.commissions'::regclass
       and conname = 'commissions_status_check'
  ) then
    v_missing := v_missing || 'check commissions_status_check (allowed statuses)';
  end if;

  if not exists (select 1 from pg_constraint where conrelid = 'public.commissions'::regclass and conname = 'commissions_price_positive') then
    v_missing := v_missing || 'check commissions_price_positive';
  end if;

  if not exists (select 1 from pg_constraint where conrelid = 'public.commissions'::regclass and conname = 'commissions_rate_check') then
    v_missing := v_missing || 'check commissions_rate_check (= 8.0000)';
  end if;

  if exists (select 1 from pg_constraint where conrelid = 'public.commissions'::regclass and conname = 'commissions_rate_range') then
    v_missing := v_missing || 'legacy 0-100 rate check still present';
  end if;

  if not exists (select 1 from pg_constraint where conrelid = 'public.commissions'::regclass and conname = 'commissions_amount_check') then
    v_missing := v_missing || 'check commissions_amount_check (8% split)';
  end if;

  if not exists (select 1 from pg_constraint where conrelid = 'public.commissions'::regclass and conname = 'commissions_net_check') then
    v_missing := v_missing || 'check commissions_net_check (price - amount)';
  end if;

  if (select con.confdeltype from pg_constraint con
       where con.conrelid = 'public.commissions'::regclass
         and con.conname = 'commissions_cargo_id_fkey') is distinct from 'r' then
    v_missing := v_missing || 'FK cargo_id must be ON DELETE RESTRICT';
  end if;

  if (select con.confdeltype from pg_constraint con
       where con.conrelid = 'public.commissions'::regclass
         and con.conname = 'commissions_booking_id_fkey') is distinct from 'r' then
    v_missing := v_missing || 'FK booking_id must be ON DELETE RESTRICT';
  end if;

  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public'
       and tablename = 'commissions'
       and indexdef like 'CREATE UNIQUE INDEX%'
       and indexdef like '%(booking_id)%'
  ) then
    v_missing := v_missing || 'unique index on booking_id';
  end if;

  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public'
       and tablename = 'commissions'
       and indexdef like 'CREATE UNIQUE INDEX%'
       and indexdef like '%(cargo_id)%'
       and indexdef like '%pending%'
  ) then
    v_missing := v_missing || 'partial unique index (one live commission per load)';
  end if;

  for v_trig in
    select * from (values
      ('commissions_set_updated_at', 'BEFORE UPDATE'),
      ('commissions_set_timestamps',  'BEFORE INSERT OR UPDATE'),
      ('commissions_block_delete',    'BEFORE DELETE'),
      ('commissions_block_truncate',  'BEFORE TRUNCATE')
    ) as t (tg_name, must_contain)
  loop
    v_def := null;

    select pg_get_triggerdef(tg.oid) into v_def
      from pg_trigger tg
     where tg.tgrelid = 'public.commissions'::regclass
       and tg.tgname = v_trig.tg_name
       and not tg.tgisinternal;

    if v_def is null then
      v_missing := v_missing || 'trigger ' || v_trig.tg_name;
    elsif position(v_trig.must_contain in v_def) = 0 then
      v_missing := v_missing || 'trigger ' || v_trig.tg_name
                   || ' must fire ' || v_trig.must_contain;
    end if;
  end loop;

  if not exists (select 1 from pg_class where oid = 'public.commissions'::regclass and relrowsecurity) then
    v_missing := v_missing || 'row level security not enabled';
  end if;

  if exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'commissions'
  ) then
    v_missing := v_missing || 'no RLS policy may exist on the ledger (deny-by-default means zero policies)';
  end if;

  if exists (
    select 1 from information_schema.table_privileges
     where table_schema = 'public'
       and table_name = 'commissions'
       and grantee in ('anon', 'authenticated', 'PUBLIC')
  ) then
    v_missing := v_missing || 'anon/authenticated/PUBLIC must hold no privilege on the ledger';
  end if;

  if exists (select 1 from pg_roles where rolname = 'service_role') then
    if not has_table_privilege('service_role', 'public.commissions', 'SELECT')
       or not has_table_privilege('service_role', 'public.commissions', 'INSERT')
       or not has_table_privilege('service_role', 'public.commissions', 'UPDATE') then
      v_missing := v_missing || 'service_role needs SELECT, INSERT and UPDATE';
    end if;

    if has_table_privilege('service_role', 'public.commissions', 'DELETE') then
      v_missing := v_missing || 'service_role must not hold DELETE on the ledger';
    end if;
  end if;

  if cardinality(v_missing) > 0 then
    raise exception 'commissions migration self-check failed: %', array_to_string(v_missing, '; ')
      using hint = 'The transaction is aborted, so nothing was changed. Fix the reported item and re-run the whole script.';
  end if;

  raise notice 'commissions self-check passed: column types & defaults, rate 8.0000, split checks, frozen financial fields, evidence-gated paid/refunded, FK RESTRICT, unique guards, append-only + state-machine triggers, RLS with zero policies, service_role grants.';
end $$;


-- ============================================================================
-- PREFLIGHT (read-only, run BEFORE the migration — every query only reads
-- catalog/privilege metadata; none of them can modify anything)
-- ============================================================================

-- P1. Required function from the earlier migrations exists:
-- select n.nspname || '.' || p.proname as function, l.lanname
--   from pg_proc p
--   join pg_namespace n on n.oid = p.pronamespace
--   join pg_language l on l.oid = p.prolang
--  where n.nspname = 'public' and p.proname = 'set_updated_at';
 -- Expect exactly: public.set_updated_at (plpgsql)

-- P2. Parent tables exist with uuid primary keys:
-- select c.relname as table_name, a.attname as pk_column, format_type(a.atttypid, a.atttypmod) as type
--   from pg_index i
--   join pg_class c on c.oid = i.indrelid
--   join pg_namespace ns on ns.oid = c.relnamespace
--   join pg_attribute a on a.attrelid = c.oid and a.attnum = any (i.indkey)
--  where ns.nspname = 'public'
--    and c.relname in ('cargo', 'bookings')
--    and i.indisprimary
--  order by c.relname;
 -- Expect 2 rows, both type uuid

-- P3. Has a commissions table already been created by an earlier run?
-- select c.relname as table_name, c.relrowsecurity as rls_enabled, c.reltuples::bigint as approx_rows
--   from pg_class c
--   join pg_namespace n on n.oid = c.relnamespace
--  where n.nspname = 'public' and c.relname = 'commissions';
 -- 0 rows = fresh install (the script below is a plain create).
 -- 1 row  = an earlier draft exists; run P4 before migrating.

-- P4. Existing definitions when the table is already there (still read-only):
-- select con.conname, pg_get_constraintdef(con.oid) as definition
--   from pg_constraint con
--  where con.conrelid = to_regclass('public.commissions')
--  order by con.conname;
 -- Look for: commission_rate = 8.0000 (strict), and ON DELETE RESTRICT on both
 -- foreign keys. Any missing item is added by the migration; nothing weaker is
 -- ever removed before its strict replacement is in place.

-- P5. Would existing ledger rows survive the strict rules? Run ONLY if P3
--     returned the table; "relation does not exist" simply means fresh.
--     Expect 0 — a non-zero count must be investigated before migrating.
-- select count(*) as rows_failing_strict_rules
--   from public.commissions
--  where commission_rate is distinct from 8.0000
--     or commission_amount is distinct from round(cargo_price * commission_rate / 100, 2)
--     or provider_net_amount is distinct from cargo_price - commission_amount
--     or cargo_price <= 0
--     or status not in ('pending', 'earned', 'paid', 'cancelled', 'refunded');


-- ============================================================================
-- POST-MIGRATION VERIFICATION (read-only — run after a successful Run)
-- ============================================================================

-- V1. Table shape:
-- select column_name, data_type, is_nullable, column_default
--   from information_schema.columns
--  where table_schema = 'public' and table_name = 'commissions'
--  order by ordinal_position;

-- V2. Every rule that must now exist (expect one row per guarantee):
-- select con.conname, pg_get_constraintdef(con.oid) as definition, con.convalidated
--   from pg_constraint con
--  where con.conrelid = 'public.commissions'::regclass
--  order by con.conname;
 -- Must include:
 --   commissions_rate_check     check (commission_rate = 8.0000)
 --   commissions_amount_check   check (commission_amount = round(cargo_price * commission_rate / 100, 2))
 --   commissions_net_check      check (provider_net_amount = cargo_price - commission_amount)
 --   commissions_price_positive check (cargo_price > 0)
 --   commissions_cargo_id_fkey    foreign key (cargo_id) references cargo ... on delete restrict
 --   commissions_booking_id_fkey  foreign key (booking_id) references bookings ... on delete restrict
 --   plus a UNIQUE constraint covering booking_id, and the partial unique index
 --   on cargo_id for status in (pending, earned, paid) — see V3.

-- V3. Indexes:
-- select indexname, indexdef
--   from pg_indexes
--  where schemaname = 'public' and tablename = 'commissions'
--  order by indexname;

-- V4. Triggers (state machine + append-only guards + updated_at):
-- select t.tgname, pg_get_triggerdef(t.oid) as definition
--   from pg_trigger t
--  where t.tgrelid = 'public.commissions'::regclass and not t.tgisinternal
--  order by t.tgname;

-- V5. RLS and grants:
-- select c.relrowsecurity as rls_enabled, c.relforcerowsecurity as rls_forced
--   from pg_class c where c.oid = 'public.commissions'::regclass;

-- select grantee, string_agg(privilege_type, ', ' order by privilege_type) as privileges
--   from information_schema.table_privileges
--  where table_schema = 'public' and table_name = 'commissions'
--  group by grantee
--  order by grantee;
 -- Expect service_role → DELETE? no: INSERT, SELECT, UPDATE.
 -- Expect NO row for anon, authenticated or PUBLIC.

-- V6. The 8% rule itself (pure arithmetic, read-only):
-- select 1000000.00::numeric(15, 2)                                   as cargo_price,
--        8.0000::numeric(6, 4)                                        as commission_rate,
--        round(1000000.00::numeric(15, 2) * 8.0000 / 100, 2)          as commission_amount,
--        1000000.00::numeric(15, 2) - round(1000000.00::numeric(15, 2) * 8.0000 / 100, 2)
--                                                                     as provider_net_amount;
 -- Expect: 1000000.00 | 8.0000 | 80000.00 | 920000.00

-- V7. Ledger integrity scan — must return ZERO rows on a healthy database:
-- select id, cargo_id, booking_id, cargo_price, commission_rate, commission_amount, provider_net_amount, status
--   from public.commissions
--  where commission_rate is distinct from 8.0000
--     or commission_amount is distinct from round(cargo_price * commission_rate / 100, 2)
--     or provider_net_amount is distinct from cargo_price - commission_amount;

-- V8. No load may carry two live commissions (the partial unique index makes
--     this impossible, so expect ZERO rows):
-- select cargo_id, count(*) as live_records
--   from public.commissions
--  where status in ('pending', 'earned', 'paid')
--  group by cargo_id
-- having count(*) > 1;

-- V9. No booking may carry two commissions (expect ZERO rows):
-- select booking_id, count(*) as records
--   from public.commissions
--  where booking_id is not null
--  group by booking_id
-- having count(*) > 1;

-- V10. Revenue buckets from the ledger itself (statuses are mutually
--      exclusive, so no amount can appear twice):
-- select status,
--        count(*)                                        as records,
--        sum(cargo_price)                                as cargo_price_total,
--        sum(commission_amount)                          as commission_total
--   from public.commissions
--  group by status
--  order by status;

-- OPTIONAL PROOF of the append-only guard (not read-only by nature, but it
-- cannot change anything: the BEFORE DELETE trigger aborts the statement, and
-- the transaction always rolls back). Skip it if you prefer pure reads:
--
--   begin;
--   delete from public.commissions limit 1;   -- must ERROR: ledger is append-only
--   rollback;
--
-- ============================================================================
-- DONE. Expected table: public.commissions
-- Verify in the Dashboard: Table Editor (read-only views), or run:
--   select table_name from information_schema.tables
--   where table_schema = 'public' order by table_name;
-- ============================================================================
