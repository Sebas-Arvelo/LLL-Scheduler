import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';

test('Supabase setup enables ownership RLS for every write and read operation', async () => {
  const sql = await readFile(resolve(process.cwd(), 'supabase/setup.sql'), 'utf8');
  assert.match(sql, /user_id uuid not null references auth\.users\(id\)/i);
  assert.match(sql, /alter table public\.saved_schedules enable row level security/i);
  for (const table of ['assignment_progress', 'activity_cycles', 'cycle_requirements']) {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`, 'i'));
  }
  assert.match(sql, /for select[\s\S]*using \(user_id = \(select auth\.uid\(\)\)\)/i);
  assert.match(sql, /for insert[\s\S]*with check \(user_id = \(select auth\.uid\(\)\)\)/i);
  assert.match(sql, /for update[\s\S]*using \(user_id = \(select auth\.uid\(\)\)\)[\s\S]*with check/i);
  assert.match(sql, /for delete[\s\S]*using \(user_id = \(select auth\.uid\(\)\)\)/i);
  assert.doesNotMatch(sql, /service_role/i);
});

test('Supabase execution setup is idempotent and keeps one progress row per planned cell', async () => {
  const sql = await readFile(resolve(process.cwd(), 'supabase/setup.sql'), 'utf8');
  assert.match(sql, /unique \(saved_schedule_id, group_id, date, time_block_id\)/i);
  assert.match(sql, /on conflict \(saved_schedule_id, group_id, date, time_block_id\) do nothing/i);
  assert.match(sql, /create or replace function public\.initialize_schedule_execution/i);
  assert.match(sql, /create or replace function public\.set_assignment_progress_status/i);
  assert.match(sql, /status in \('planned', 'completed', 'cancelled'\)/i);
  assert.match(sql, /coalesce\(\(activity->>'countsTowardCycle'\)::boolean, true\)/i);
});

test('Supabase auto-completes untouched progress while preserving manual exceptions', async () => {
  const sql = await readFile(resolve(process.cwd(), 'supabase/setup.sql'), 'utf8');
  assert.match(sql, /status_manually_set boolean not null default false/i);
  assert.match(sql, /status = 'planned' and not status_manually_set/i);
  assert.match(sql, /set status = p_status, completed_at = null, cycle_id = null, status_manually_set = true/i);
  assert.match(sql, /perform public\.set_assignment_progress_status\(v_progress_id, 'completed', v_user_id\)/i);
});

test('Supabase deletes a saved day through the progress transition rules', async () => {
  const sql = await readFile(resolve(process.cwd(), 'supabase/setup.sql'), 'utf8');
  assert.match(sql, /create or replace function public\.delete_schedule_day/i);
  assert.match(sql, /perform public\.set_assignment_progress_status\(v_progress\.id, 'planned', p_user_id\)/i);
  assert.match(sql, /delete from public\.assignment_progress[\s\S]*date = p_date/i);
  assert.match(sql, /grant execute on function public\.delete_schedule_day\(uuid, date, uuid\) to authenticated/i);
});

test('Supabase scopes activity cycles to the saved schedule', async () => {
  const sql = await readFile(resolve(process.cwd(), 'supabase/setup.sql'), 'utf8');
  assert.match(sql, /activity_cycles[\s\S]*saved_schedule_id uuid/i);
  assert.match(sql, /foreign key \(user_id, saved_schedule_id\)[\s\S]*saved_schedules\(user_id, id\)/i);
  assert.match(sql, /activity_cycles_one_active_group_idx[\s\S]*user_id, saved_schedule_id, group_id/i);
  assert.match(sql, /where user_id = v_user_id and saved_schedule_id = p_saved_schedule_id/i);
  assert.match(sql, /insert into public\.activity_cycles \(user_id, saved_schedule_id, group_id, cycle_number\)/i);
  assert.match(sql, /later\.saved_schedule_id = v_cycle\.saved_schedule_id/i);
});

test('Supabase persists and updates multi-block sessions atomically', async () => {
  const sql = await readFile(resolve(process.cwd(), 'supabase/setup.sql'), 'utf8');
  assert.match(sql, /session_id text/i);
  assert.match(sql, /session_block_index integer/i);
  assert.match(sql, /session_block_count integer/i);
  assert.match(sql, /assignment_progress_session_consistency/i);
  assert.match(sql, /assignment->>'sessionId'/i);
  assert.match(sql, /v_progress\.session_id is not null and session_id = v_progress\.session_id/i);
  assert.match(sql, /cycle_id = case when id = p_progress_id then v_cycle\.id else null end/i);
});
