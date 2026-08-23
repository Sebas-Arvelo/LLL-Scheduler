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
create unique index if not exists saved_schedules_user_id_idx
  on public.saved_schedules (user_id, id);

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

create table if not exists public.activity_cycles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  saved_schedule_id uuid,
  group_id text not null,
  cycle_number integer not null check (cycle_number > 0),
  status text not null default 'active' check (status in ('active', 'completed')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint activity_cycles_owned_schedule foreign key (user_id, saved_schedule_id)
    references public.saved_schedules(user_id, id) on delete cascade,
  constraint activity_cycles_completion_consistency check (
    (status = 'active' and completed_at is null)
    or (status = 'completed' and completed_at is not null)
  )
);

alter table public.activity_cycles
  add column if not exists saved_schedule_id uuid;
alter table public.activity_cycles
  drop constraint if exists activity_cycles_user_id_group_id_cycle_number_key;
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'activity_cycles_owned_schedule'
      and conrelid = 'public.activity_cycles'::regclass
  ) then
    alter table public.activity_cycles
      add constraint activity_cycles_owned_schedule
      foreign key (user_id, saved_schedule_id)
      references public.saved_schedules(user_id, id) on delete cascade;
  end if;
end;
$$;

drop index if exists public.activity_cycles_one_active_group_idx;
create unique index if not exists activity_cycles_one_active_group_idx
  on public.activity_cycles (user_id, saved_schedule_id, group_id)
  where status = 'active' and saved_schedule_id is not null;
create unique index if not exists activity_cycles_schedule_group_number_idx
  on public.activity_cycles (user_id, saved_schedule_id, group_id, cycle_number)
  where saved_schedule_id is not null;
create unique index if not exists activity_cycles_user_id_idx
  on public.activity_cycles (user_id, id);
drop index if exists public.activity_cycles_user_group_idx;
create index if not exists activity_cycles_user_schedule_group_idx
  on public.activity_cycles (user_id, saved_schedule_id, group_id, cycle_number desc);

create table if not exists public.cycle_requirements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  cycle_id uuid not null,
  activity_id text not null,
  status text not null default 'pending' check (status in ('pending', 'completed', 'exempted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (cycle_id, activity_id),
  constraint cycle_requirements_owned_cycle foreign key (user_id, cycle_id)
    references public.activity_cycles(user_id, id) on delete cascade
);

create index if not exists cycle_requirements_user_cycle_idx
  on public.cycle_requirements (user_id, cycle_id);

create table if not exists public.assignment_progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  saved_schedule_id uuid not null,
  group_id text not null,
  activity_id text not null,
  date date not null,
  time_block_id text not null,
  session_id text,
  session_block_index integer,
  session_block_count integer,
  status text not null default 'planned' check (status in ('planned', 'completed', 'cancelled')),
  cycle_id uuid,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (saved_schedule_id, group_id, date, time_block_id),
  constraint assignment_progress_completion_consistency check (
    (status = 'completed' and completed_at is not null)
    or (status <> 'completed' and completed_at is null and cycle_id is null)
  ),
  constraint assignment_progress_session_consistency check (
    (session_id is null and session_block_index is null and session_block_count is null)
    or (session_id is not null and session_block_index between 0 and session_block_count - 1
      and session_block_count between 2 and 3)
  ),
  constraint assignment_progress_owned_schedule foreign key (user_id, saved_schedule_id)
    references public.saved_schedules(user_id, id) on delete cascade,
  constraint assignment_progress_owned_cycle foreign key (user_id, cycle_id)
    references public.activity_cycles(user_id, id) on delete set null (cycle_id)
);

alter table public.assignment_progress add column if not exists session_id text;
alter table public.assignment_progress add column if not exists session_block_index integer;
alter table public.assignment_progress add column if not exists session_block_count integer;
alter table public.assignment_progress drop constraint if exists assignment_progress_session_consistency;
alter table public.assignment_progress add constraint assignment_progress_session_consistency check (
  (session_id is null and session_block_index is null and session_block_count is null)
  or (session_id is not null and session_block_index between 0 and session_block_count - 1
    and session_block_count between 2 and 3)
);

create index if not exists assignment_progress_schedule_idx
  on public.assignment_progress (user_id, saved_schedule_id, date, time_block_id);
create index if not exists assignment_progress_real_history_idx
  on public.assignment_progress (user_id, group_id, completed_at desc) where status = 'completed';

create or replace function public.set_execution_updated_at()
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

drop trigger if exists activity_cycles_set_updated_at on public.activity_cycles;
create trigger activity_cycles_set_updated_at before update on public.activity_cycles
for each row execute function public.set_execution_updated_at();
drop trigger if exists cycle_requirements_set_updated_at on public.cycle_requirements;
create trigger cycle_requirements_set_updated_at before update on public.cycle_requirements
for each row execute function public.set_execution_updated_at();
drop trigger if exists assignment_progress_set_updated_at on public.assignment_progress;
create trigger assignment_progress_set_updated_at before update on public.assignment_progress
for each row execute function public.set_execution_updated_at();

alter table public.activity_cycles enable row level security;
alter table public.cycle_requirements enable row level security;
alter table public.assignment_progress enable row level security;

drop policy if exists "Users read own activity cycles" on public.activity_cycles;
create policy "Users read own activity cycles" on public.activity_cycles for select to authenticated
using (user_id = (select auth.uid()));
drop policy if exists "Users insert own activity cycles" on public.activity_cycles;
create policy "Users insert own activity cycles" on public.activity_cycles for insert to authenticated
with check (user_id = (select auth.uid()));
drop policy if exists "Users update own activity cycles" on public.activity_cycles;
create policy "Users update own activity cycles" on public.activity_cycles for update to authenticated
using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists "Users delete own activity cycles" on public.activity_cycles;
create policy "Users delete own activity cycles" on public.activity_cycles for delete to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "Users read own cycle requirements" on public.cycle_requirements;
create policy "Users read own cycle requirements" on public.cycle_requirements for select to authenticated
using (user_id = (select auth.uid()));
drop policy if exists "Users insert own cycle requirements" on public.cycle_requirements;
create policy "Users insert own cycle requirements" on public.cycle_requirements for insert to authenticated
with check (user_id = (select auth.uid()));
drop policy if exists "Users update own cycle requirements" on public.cycle_requirements;
create policy "Users update own cycle requirements" on public.cycle_requirements for update to authenticated
using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists "Users delete own cycle requirements" on public.cycle_requirements;
create policy "Users delete own cycle requirements" on public.cycle_requirements for delete to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "Users read own assignment progress" on public.assignment_progress;
create policy "Users read own assignment progress" on public.assignment_progress for select to authenticated
using (user_id = (select auth.uid()));
drop policy if exists "Users insert own assignment progress" on public.assignment_progress;
create policy "Users insert own assignment progress" on public.assignment_progress for insert to authenticated
with check (user_id = (select auth.uid()));
drop policy if exists "Users update own assignment progress" on public.assignment_progress;
create policy "Users update own assignment progress" on public.assignment_progress for update to authenticated
using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists "Users delete own assignment progress" on public.assignment_progress;
create policy "Users delete own assignment progress" on public.assignment_progress for delete to authenticated
using (user_id = (select auth.uid()));

create or replace function public.initialize_schedule_execution(p_saved_schedule_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_schedule_data jsonb;
  v_group jsonb;
  v_cycle_id uuid;
  v_progress_id uuid;
  v_new_progress_ids uuid[] := '{}';
begin
  select schedule_data into v_schedule_data
  from public.saved_schedules
  where id = p_saved_schedule_id and user_id = v_user_id;
  if v_schedule_data is null then raise exception 'schedule not found'; end if;

  with inserted_progress as (
    insert into public.assignment_progress (
      user_id, saved_schedule_id, group_id, activity_id, date, time_block_id,
      session_id, session_block_index, session_block_count, status
    )
    select v_user_id, p_saved_schedule_id, assignment->>'groupId', assignment->>'activityId',
      (assignment->>'date')::date, assignment->>'timeBlockId', assignment->>'sessionId',
      (assignment->>'sessionBlockIndex')::integer, (assignment->>'sessionBlockCount')::integer, 'planned'
    from jsonb_array_elements(v_schedule_data #> '{result,assignments}') assignment
    on conflict (saved_schedule_id, group_id, date, time_block_id) do nothing
    returning id
  )
  select coalesce(array_agg(id), '{}') into v_new_progress_ids
  from inserted_progress;

  for v_group in
    select distinct group_item
    from jsonb_array_elements(v_schedule_data #> '{configuration,groups}') group_item
    where coalesce((group_item->>'active')::boolean, false)
      and exists (
        select 1 from public.assignment_progress progress
        where progress.saved_schedule_id = p_saved_schedule_id
          and progress.group_id = group_item->>'id' and progress.status = 'planned'
      )
      and exists (
        select 1
        from jsonb_array_elements(v_schedule_data #> '{configuration,activities}') activity
        where coalesce((activity->>'active')::boolean, false)
          and coalesce((activity->>'countsTowardCycle')::boolean, true)
          and exists (
            select 1 from jsonb_array_elements(v_schedule_data #> '{configuration,eligibility}') eligibility
            where eligibility->>'activityId' = activity->>'id'
              and eligibility->>'groupCategoryId' = group_item->>'categoryId'
          )
      )
  loop
    select id into v_cycle_id from public.activity_cycles
    where user_id = v_user_id and saved_schedule_id = p_saved_schedule_id
      and group_id = v_group->>'id' and status = 'active';
    if v_cycle_id is null then
      insert into public.activity_cycles (user_id, saved_schedule_id, group_id, cycle_number)
      values (
        v_user_id,
        p_saved_schedule_id,
        v_group->>'id',
        coalesce((select max(cycle_number) + 1 from public.activity_cycles
          where user_id = v_user_id and saved_schedule_id = p_saved_schedule_id
            and group_id = v_group->>'id'), 1)
      ) returning id into v_cycle_id;

      insert into public.cycle_requirements (user_id, cycle_id, activity_id, status)
      select distinct v_user_id, v_cycle_id, activity->>'id', 'pending'
      from jsonb_array_elements(v_schedule_data #> '{configuration,activities}') activity
      where coalesce((activity->>'active')::boolean, false)
        and coalesce((activity->>'countsTowardCycle')::boolean, true)
        and exists (
          select 1 from jsonb_array_elements(v_schedule_data #> '{configuration,eligibility}') eligibility
          where eligibility->>'activityId' = activity->>'id'
            and eligibility->>'groupCategoryId' = v_group->>'categoryId'
        )
      on conflict (cycle_id, activity_id) do nothing;
    end if;
    v_cycle_id := null;
  end loop;

  foreach v_progress_id in array v_new_progress_ids
  loop
    perform public.set_assignment_progress_status(v_progress_id, 'completed', v_user_id);
  end loop;
end;
$$;

create or replace function public.set_assignment_progress_status(
  p_progress_id uuid,
  p_status text,
  p_user_id uuid
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_progress public.assignment_progress%rowtype;
  v_cycle public.activity_cycles%rowtype;
  v_requirement_id uuid;
  v_linked_cycle_id uuid;
  v_has_other boolean;
begin
  if p_status not in ('planned', 'completed', 'cancelled') then raise exception 'invalid progress status'; end if;
  if p_user_id is distinct from auth.uid() then raise exception 'user mismatch'; end if;
  select * into v_progress from public.assignment_progress
  where id = p_progress_id and user_id = p_user_id for update;
  if not found then raise exception 'progress not found'; end if;
  if v_progress.status = p_status then return; end if;

  if p_status = 'completed' then
    select * into v_cycle from public.activity_cycles
    where user_id = p_user_id and saved_schedule_id = v_progress.saved_schedule_id
      and group_id = v_progress.group_id and status = 'active' for update;
    if found then
      select id into v_requirement_id from public.cycle_requirements
      where user_id = p_user_id and cycle_id = v_cycle.id and activity_id = v_progress.activity_id for update;
      if v_requirement_id is not null then
        update public.cycle_requirements set status = 'completed' where id = v_requirement_id;
        update public.assignment_progress
        set status = 'completed', completed_at = now(),
          cycle_id = case when id = p_progress_id then v_cycle.id else null end
        where user_id = p_user_id and saved_schedule_id = v_progress.saved_schedule_id
          and (
            (v_progress.session_id is null and id = p_progress_id)
            or (v_progress.session_id is not null and session_id = v_progress.session_id)
          );
        if not exists (
          select 1 from public.cycle_requirements where cycle_id = v_cycle.id and status = 'pending'
        ) then
          update public.activity_cycles set status = 'completed', completed_at = now() where id = v_cycle.id;
        end if;
        return;
      end if;
    end if;
    update public.assignment_progress set status = 'completed', completed_at = now(), cycle_id = null
    where user_id = p_user_id and saved_schedule_id = v_progress.saved_schedule_id
      and (
        (v_progress.session_id is null and id = p_progress_id)
        or (v_progress.session_id is not null and session_id = v_progress.session_id)
      );
    return;
  end if;

  if v_progress.status = 'completed' then
    if v_progress.session_id is null then
      v_linked_cycle_id := v_progress.cycle_id;
    else
      select cycle_id into v_linked_cycle_id
      from public.assignment_progress
      where user_id = p_user_id and saved_schedule_id = v_progress.saved_schedule_id
        and session_id = v_progress.session_id and cycle_id is not null
      limit 1;
    end if;
  end if;

  if v_linked_cycle_id is not null then
    select * into v_cycle from public.activity_cycles where id = v_linked_cycle_id for update;
    select exists (
      select 1 from public.assignment_progress
      where user_id = p_user_id and cycle_id = v_linked_cycle_id
        and activity_id = v_progress.activity_id and status = 'completed'
        and (
          (v_progress.session_id is null and id <> p_progress_id)
          or (v_progress.session_id is not null and session_id is distinct from v_progress.session_id)
        )
    ) into v_has_other;
    if not v_has_other and exists (
      select 1 from public.cycle_requirements
      where cycle_id = v_linked_cycle_id and activity_id = v_progress.activity_id and status = 'completed'
    ) then
      if v_cycle.status = 'completed' and exists (
        select 1 from public.activity_cycles later
        where later.user_id = p_user_id and later.saved_schedule_id = v_cycle.saved_schedule_id
          and later.group_id = v_cycle.group_id
          and later.cycle_number > v_cycle.cycle_number
      ) then raise exception 'later cycle exists'; end if;
      update public.cycle_requirements set status = 'pending'
      where cycle_id = v_linked_cycle_id and activity_id = v_progress.activity_id;
      if v_cycle.status = 'completed' then
        update public.activity_cycles set status = 'active', completed_at = null where id = v_cycle.id;
      end if;
    end if;
  end if;
  update public.assignment_progress set status = p_status, completed_at = null, cycle_id = null
  where user_id = p_user_id and saved_schedule_id = v_progress.saved_schedule_id
    and (
      (v_progress.session_id is null and id = p_progress_id)
      or (v_progress.session_id is not null and session_id = v_progress.session_id)
    );
end;
$$;

create or replace function public.set_cycle_requirement_status(
  p_requirement_id uuid,
  p_status text,
  p_user_id uuid
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_requirement public.cycle_requirements%rowtype;
  v_cycle public.activity_cycles%rowtype;
begin
  if p_status not in ('pending', 'exempted') then raise exception 'invalid requirement status'; end if;
  if p_user_id is distinct from auth.uid() then raise exception 'user mismatch'; end if;
  select * into v_requirement from public.cycle_requirements
  where id = p_requirement_id and user_id = p_user_id for update;
  if not found then raise exception 'requirement not found'; end if;
  if v_requirement.status = 'completed' then raise exception 'completed requirement is immutable'; end if;
  select * into v_cycle from public.activity_cycles where id = v_requirement.cycle_id for update;
  if p_status = 'pending' and v_cycle.status = 'completed' and exists (
    select 1 from public.activity_cycles later
    where later.user_id = p_user_id and later.saved_schedule_id = v_cycle.saved_schedule_id
      and later.group_id = v_cycle.group_id
      and later.cycle_number > v_cycle.cycle_number
  ) then raise exception 'later cycle exists'; end if;
  update public.cycle_requirements set status = p_status where id = p_requirement_id;
  if not exists (select 1 from public.cycle_requirements where cycle_id = v_cycle.id and status = 'pending') then
    update public.activity_cycles set status = 'completed', completed_at = coalesce(completed_at, now()) where id = v_cycle.id;
  else
    update public.activity_cycles set status = 'active', completed_at = null where id = v_cycle.id;
  end if;
end;
$$;

revoke all on function public.initialize_schedule_execution(uuid) from public, anon;
grant execute on function public.initialize_schedule_execution(uuid) to authenticated;
revoke all on function public.set_assignment_progress_status(uuid, text, uuid) from public, anon;
grant execute on function public.set_assignment_progress_status(uuid, text, uuid) to authenticated;
revoke all on function public.set_cycle_requirement_status(uuid, text, uuid) from public, anon;
grant execute on function public.set_cycle_requirement_status(uuid, text, uuid) to authenticated;
