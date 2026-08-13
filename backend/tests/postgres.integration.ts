import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';

import { Pool } from 'pg';

import { createApp } from '../src/app';
import type { CreateScheduleRequest, SeasonConfiguration } from '../src/contracts';
import type { DatabasePool } from '../src/db/database';
import { runMigrations } from '../src/db/migrate';
import { DEMO_COUNTS, DEMO_SEASON_ID, seedDemo } from '../src/db/seed-demo';
import { PgConfigRepository } from '../src/repositories/config-repository';
import { PgScheduleRepository } from '../src/repositories/schedule-repository';
import { requireSafeTestDatabaseUrl } from './test-database';

const expectedTables = [
  'activities',
  'activity_eligibility',
  'assignments',
  'camp_groups',
  'group_categories',
  'schedule_unassigned',
  'schedules',
  'schema_migrations',
  'seasons',
  'time_blocks',
];

function requestFor(configuration: SeasonConfiguration, name: string): CreateScheduleRequest {
  return {
    seasonId: configuration.season.id,
    name,
    rangeStart: '2026-08-10',
    rangeEnd: '2026-08-10',
    seed: 2026,
    algorithmVersion: 'postgres-integration-v1',
    configurationSnapshot: configuration,
    assignments: [{
      groupId: 'sabana-1',
      activityId: 'futbol-5',
      date: '2026-08-10',
      timeBlockId: 'block-1',
      source: 'automatic',
      status: 'planned',
      locked: false,
    }],
    unassigned: [{
      groupId: 'sabana-2',
      date: '2026-08-10',
      timeBlockId: 'block-1',
      reasonCode: 'CAPACITY_EXHAUSTED',
      context: { checkedBy: 'postgres-integration' },
    }],
  };
}

async function listen(pool: DatabasePool): Promise<{ server: Server; baseUrl: string }> {
  const app = createApp({
    configRepository: new PgConfigRepository(pool),
    scheduleRepository: new PgScheduleRepository(pool),
    databaseHealth: async () => { await pool.query('SELECT 1'); return true; },
    corsOrigin: 'http://localhost:4200',
    production: true,
  });
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo;
      resolve({ server, baseUrl: `http://127.0.0.1:${address.port}` });
    });
  });
}

const integrationUrl = process.env['TEST_DATABASE_URL']?.trim();

test('PostgreSQL persistence works end to end', { skip: integrationUrl ? false : 'TEST_DATABASE_URL is not configured.' }, async (context) => {
  const databaseUrl = requireSafeTestDatabaseUrl();
  const nativePool = new Pool({ connectionString: databaseUrl, max: 4 });
  const pool = nativePool as unknown as DatabasePool;
  let server: Server | undefined;

  try {
    await nativePool.query('DROP SCHEMA public CASCADE');
    await nativePool.query('CREATE SCHEMA public');

    await context.test('migrations are real and idempotent', async () => {
      const first = await runMigrations(pool);
      const second = await runMigrations(pool);
      assert.deepEqual(first.applied, ['001_initial_schema.sql']);
      assert.deepEqual(second.applied, []);
      assert.deepEqual(second.skipped, ['001_initial_schema.sql']);

      const tables = await nativePool.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`,
      );
      assert.deepEqual(tables.rows.map((row) => row.table_name), expectedTables);
      const migrations = await nativePool.query<{ name: string }>('SELECT name FROM schema_migrations ORDER BY name');
      assert.deepEqual(migrations.rows.map((row) => row.name), ['001_initial_schema.sql']);
    });

    await context.test('demo seed and configuration repository are idempotent', async () => {
      await seedDemo(pool);
      await seedDemo(pool);
      const counts = await nativePool.query<{
        seasons: number; categories: number; groups: number; activities: number; eligibility: number; blocks: number;
      }>(`SELECT
        (SELECT count(*)::int FROM seasons) AS seasons,
        (SELECT count(*)::int FROM group_categories) AS categories,
        (SELECT count(*)::int FROM camp_groups) AS groups,
        (SELECT count(*)::int FROM activities) AS activities,
        (SELECT count(*)::int FROM activity_eligibility) AS eligibility,
        (SELECT count(*)::int FROM time_blocks) AS blocks`);
      assert.deepEqual(counts.rows[0], DEMO_COUNTS);
      const groupsByCategory = await nativePool.query<{ category_id: string; count: number }>(
        'SELECT category_id, count(*)::int AS count FROM camp_groups GROUP BY category_id ORDER BY category_id',
      );
      assert.deepEqual(groupsByCategory.rows, [
        { category_id: 'aventura', count: 6 },
        { category_id: 'bosque', count: 12 },
        { category_id: 'cit', count: 6 },
        { category_id: 'sabana', count: 12 },
      ]);
      const brokenReferences = await nativePool.query<{ count: number }>(`SELECT count(*)::int AS count FROM camp_groups camp
        LEFT JOIN seasons ON seasons.id = camp.season_id
        LEFT JOIN group_categories categories ON categories.id = camp.category_id
        WHERE seasons.id IS NULL OR categories.id IS NULL`);
      assert.equal(brokenReferences.rows[0]?.count, 0);

      const configuration = await new PgConfigRepository(pool).getSeasonConfiguration(DEMO_SEASON_ID);
      assert.ok(configuration);
      assert.equal(configuration.groups.length, DEMO_COUNTS.groups);
      assert.equal(configuration.activities.length, DEMO_COUNTS.activities);
      assert.equal(configuration.eligibility.length, DEMO_COUNTS.eligibility);
      assert.equal(configuration.timeBlocks.length, DEMO_COUNTS.blocks);
    });

    await context.test('real API stores, recovers and lists a schedule while preserving its snapshot', async () => {
      const running = await listen(pool);
      server = running.server;
      const health = await fetch(`${running.baseUrl}/api/health`);
      assert.deepEqual(await health.json(), { api: 'ok', database: 'ok' });

      const configResponse = await fetch(`${running.baseUrl}/api/seasons/${DEMO_SEASON_ID}/config`);
      assert.equal(configResponse.status, 200);
      const configuration = await configResponse.json() as SeasonConfiguration;
      assert.equal(configuration.groups.length, DEMO_COUNTS.groups);

      const createResponse = await fetch(`${running.baseUrl}/api/schedules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestFor(configuration, 'Schedule A PostgreSQL validation')),
      });
      assert.equal(createResponse.status, 201);
      const created = await createResponse.json() as { schedule: { id: string; configurationSnapshot: SeasonConfiguration }; assignments: unknown[]; unassigned: unknown[] };
      assert.equal(created.assignments.length, 1);
      assert.equal(created.unassigned.length, 1);
      const persisted = await nativePool.query<{
        seed: string; algorithm_version: string; status: string; configuration_snapshot: SeasonConfiguration;
      }>('SELECT seed, algorithm_version, status, configuration_snapshot FROM schedules WHERE id = $1', [created.schedule.id]);
      assert.equal(persisted.rows[0]?.seed, '2026');
      assert.equal(persisted.rows[0]?.algorithm_version, 'postgres-integration-v1');
      assert.equal(persisted.rows[0]?.status, 'generated');
      assert.equal(
        persisted.rows[0]?.configuration_snapshot.activities.find((activity) => activity.id === 'futbol-5')?.maxGroups,
        36,
      );
      const originalMaxGroups = created.schedule.configurationSnapshot.activities.find((activity) => activity.id === 'futbol-5')?.maxGroups;
      assert.equal(originalMaxGroups, 36);

      await nativePool.query('UPDATE activities SET max_groups = 35 WHERE id = $1', ['futbol-5']);
      try {
        const recoveredResponse = await fetch(`${running.baseUrl}/api/schedules/${created.schedule.id}`);
        assert.equal(recoveredResponse.status, 200);
        const recovered = await recoveredResponse.json() as typeof created;
        assert.equal(recovered.schedule.configurationSnapshot.activities.find((activity) => activity.id === 'futbol-5')?.maxGroups, 36);
        assert.equal(recovered.assignments.length, 1);
        assert.equal(recovered.unassigned.length, 1);
      } finally {
        await nativePool.query('UPDATE activities SET max_groups = 36 WHERE id = $1', ['futbol-5']);
      }

      const listResponse = await fetch(`${running.baseUrl}/api/seasons/${DEMO_SEASON_ID}/schedules`);
      assert.equal(listResponse.status, 200);
      const schedules = await listResponse.json() as { id: string; seed: number; status: string }[];
      assert.ok(schedules.some((schedule) => schedule.id === created.schedule.id && schedule.seed === 2026 && schedule.status === 'generated'));
    });

    await context.test('a real unique failure rolls back the whole schedule', async () => {
      const repository = new PgScheduleRepository(pool);
      const configuration = await new PgConfigRepository(pool).getSeasonConfiguration(DEMO_SEASON_ID);
      assert.ok(configuration);
      const request = requestFor(configuration, 'Must roll back');
      const before = await nativePool.query<{ schedules: number; assignments: number; unassigned: number }>(`SELECT
        (SELECT count(*)::int FROM schedules) AS schedules,
        (SELECT count(*)::int FROM assignments) AS assignments,
        (SELECT count(*)::int FROM schedule_unassigned) AS unassigned`);
      await assert.rejects(
        () => repository.create({ ...request, assignments: [...request.assignments, request.assignments[0]!] }),
        (error: unknown) => (error as { code?: string }).code === '23505',
      );
      const after = await nativePool.query<{ schedules: number; assignments: number; unassigned: number }>(`SELECT
        (SELECT count(*)::int FROM schedules) AS schedules,
        (SELECT count(*)::int FROM assignments) AS assignments,
        (SELECT count(*)::int FROM schedule_unassigned) AS unassigned`);
      assert.deepEqual(after.rows[0], before.rows[0]);
    });

    await context.test('database constraints reject invalid FK, capacity and eligibility duplicates', async () => {
      const schedule = await nativePool.query<{ id: string }>('SELECT id FROM schedules ORDER BY created_at LIMIT 1');
      assert.ok(schedule.rows[0]);
      await assert.rejects(
        () => nativePool.query(
          `INSERT INTO assignments (id, schedule_id, group_id, activity_id, assignment_date, time_block_id, source, status, locked)
           VALUES ($1, $2, $3, $4, $5, $6, 'automatic', 'planned', false)`,
          [randomUUID(), schedule.rows[0].id, 'missing-group', 'futbol-5', '2026-08-11', 'block-1'],
        ),
        (error: unknown) => (error as { code?: string }).code === '23503',
      );
      await assert.rejects(
        () => nativePool.query("INSERT INTO activities (id, name, max_groups) VALUES ('invalid-capacity', 'Invalid', 0)"),
        (error: unknown) => (error as { code?: string }).code === '23514',
      );
      await assert.rejects(
        () => nativePool.query("INSERT INTO activity_eligibility (activity_id, group_category_id) VALUES ('futbol-5', 'sabana')"),
        (error: unknown) => (error as { code?: string }).code === '23505',
      );
    });
  } finally {
    if (server) await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
    await nativePool.end();
  }
});
