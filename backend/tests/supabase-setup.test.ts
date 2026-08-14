import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';

test('Supabase setup enables ownership RLS for every write and read operation', async () => {
  const sql = await readFile(resolve(process.cwd(), 'supabase/setup.sql'), 'utf8');
  assert.match(sql, /user_id uuid not null references auth\.users\(id\)/i);
  assert.match(sql, /alter table public\.saved_schedules enable row level security/i);
  assert.match(sql, /for select[\s\S]*using \(user_id = \(select auth\.uid\(\)\)\)/i);
  assert.match(sql, /for insert[\s\S]*with check \(user_id = \(select auth\.uid\(\)\)\)/i);
  assert.match(sql, /for update[\s\S]*using \(user_id = \(select auth\.uid\(\)\)\)[\s\S]*with check/i);
  assert.match(sql, /for delete[\s\S]*using \(user_id = \(select auth\.uid\(\)\)\)/i);
  assert.doesNotMatch(sql, /service_role/i);
});
