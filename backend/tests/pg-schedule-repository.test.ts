import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';

import type { QueryResult, QueryResultRow } from 'pg';

import type { DatabasePool, TransactionClient } from '../src/db/database';
import { PgScheduleRepository } from '../src/repositories/schedule-repository';
import { validRequest } from './fixtures';

function emptyResult<T extends QueryResultRow>(): QueryResult<T> {
  return { command: '', rowCount: 0, oid: 0, rows: [], fields: [] };
}

test('PgScheduleRepository rolls back the complete schedule when an assignment insert fails', async () => {
  const commands: string[] = [];
  let released = false;
  const client: TransactionClient = {
    async query<T extends QueryResultRow>(sql: string): Promise<QueryResult<T>> {
      commands.push(sql.trim().split(/\s+/).slice(0, 3).join(' '));
      if (sql.includes('INSERT INTO assignments')) throw new Error('simulated assignment failure');
      return emptyResult<T>();
    },
    release() {
      released = true;
    },
  };
  const pool: DatabasePool = {
    async connect() {
      return client;
    },
    async query<T extends QueryResultRow>(): Promise<QueryResult<T>> {
      return emptyResult<T>();
    },
    async end() {},
  };

  await assert.rejects(() => new PgScheduleRepository(pool).create(validRequest()), /simulated assignment failure/);
  assert.equal(commands[0], 'BEGIN');
  assert.ok(commands.some((command) => command === 'INSERT INTO schedules'));
  assert.ok(commands.some((command) => command === 'INSERT INTO assignments'));
  assert.equal(commands.at(-1), 'ROLLBACK');
  assert.equal(commands.includes('COMMIT'), false);
  assert.equal(released, true);
});

test('initial migration protects duplicate assignments and eligibility at database level', async () => {
  const migration = await readFile(resolve(process.cwd(), 'backend/src/db/migrations/001_initial_schema.sql'), 'utf8');
  assert.match(migration, /PRIMARY KEY \(activity_id, group_category_id\)/);
  assert.match(migration, /UNIQUE \(schedule_id, group_id, assignment_date, time_block_id\)/);
  assert.match(migration, /REFERENCES schedules\(id\) ON DELETE CASCADE/);
  assert.match(migration, /max_groups integer NOT NULL CHECK \(max_groups >= 1\)/);
});
