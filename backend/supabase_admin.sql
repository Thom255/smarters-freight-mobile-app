-- ============================================================================
-- SMARTERS FREIGHT — Admin console: account status (run AFTER supabase_marketplace.sql)
--
-- The admin console can list every account and change a role, but it can only
-- suspend / reactivate an account when the users table carries a status column:
--
--   users.status  text  not null default 'active'  -- 'active' | 'suspended'
--
-- Until this file is applied the console degrades gracefully: the user list
-- still returns every account (status is read as 'active' when the column is
-- missing) and only the suspend / reactivate write reports that the account
-- status is unavailable yet.
--
-- Run the whole file in the Supabase SQL Editor (Dashboard -> SQL Editor -> New
-- query -> paste -> Run). Safe to re-run: every statement is idempotent.
-- ============================================================================

alter table public.users
  add column if not exists status text not null default 'active';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'users_status_check'
  ) then
    alter table public.users
      add constraint users_status_check
      check (status in ('active', 'suspended'));
  end if;
end $$;

create index if not exists users_status_idx on public.users (status);
