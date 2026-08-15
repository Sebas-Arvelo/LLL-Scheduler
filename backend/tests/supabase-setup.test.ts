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
});
