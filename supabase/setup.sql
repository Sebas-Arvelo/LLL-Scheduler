create table if not exists public.saved_schedules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  season_name text,
  range_start date,
  range_end date,
  seed bigint check (seed is null or seed between 0 and 4294967295),
  algorithm_version text,
  schedule_data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint saved_schedules_date_range check (
    range_start is null or range_end is null or range_end >= range_start
  )
);

create index if not exists saved_schedules_user_created_idx
  on public.saved_schedules (user_id, created_at desc);

create or replace function public.set_saved_schedules_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists saved_schedules_set_updated_at on public.saved_schedules;
create trigger saved_schedules_set_updated_at
before update on public.saved_schedules
for each row execute function public.set_saved_schedules_updated_at();

alter table public.saved_schedules enable row level security;

drop policy if exists "Users read own schedules" on public.saved_schedules;
create policy "Users read own schedules"
on public.saved_schedules for select
to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "Users insert own schedules" on public.saved_schedules;
create policy "Users insert own schedules"
on public.saved_schedules for insert
to authenticated
with check (user_id = (select auth.uid()));

drop policy if exists "Users update own schedules" on public.saved_schedules;
create policy "Users update own schedules"
on public.saved_schedules for update
to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

drop policy if exists "Users delete own schedules" on public.saved_schedules;
create policy "Users delete own schedules"
on public.saved_schedules for delete
to authenticated
using (user_id = (select auth.uid()));
