import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, test } from 'node:test';

import type { Server } from 'node:http';

import { createApp } from '../src/app';
import { InMemoryConfigRepository, InMemoryScheduleRepository, validRequest } from './fixtures';

let server: Server;
let baseUrl: string;
let schedules: InMemoryScheduleRepository;

beforeEach(async () => {
  schedules = new InMemoryScheduleRepository();
  const app = createApp({
    configRepository: new InMemoryConfigRepository(),
    scheduleRepository: schedules,
    databaseHealth: async () => true,
    corsOrigin: 'http://localhost:4200',
    production: true,
  });
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

async function postSchedule(payload: unknown) {
  return fetch(`${baseUrl}/api/schedules`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

test('GET /api/health reports API and database health', async () => {
  const response = await fetch(`${baseUrl}/api/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { api: 'ok', database: 'ok' });
});

test('GET season configuration returns repository data', async () => {
  const response = await fetch(`${baseUrl}/api/seasons/season-1/config`);
  assert.equal(response.status, 200);
  const body = await response.json() as { groups: unknown[]; activities: unknown[] };
  assert.equal(body.groups.length, 2);
  assert.equal(body.activities.length, 1);
});

test('POST /api/schedules rejects an invalid payload', async () => {
  const response = await postSchedule({ seasonId: 'season-1' });
  assert.equal(response.status, 400);
  const body = await response.json() as { code: string };
  assert.equal(body.code, 'BAD_REQUEST');
  assert.equal(schedules.schedules.size, 0);
});

test('POST /api/schedules creates a schedule with assignments and unassigned', async () => {
  const response = await postSchedule(validRequest());
  assert.equal(response.status, 201);
  const body = await response.json() as {
    schedule: { id: string; status: string };
    assignments: { status: string }[];
    unassigned: { reasonCode: string }[];
  };
  assert.match(body.schedule.id, /^[0-9a-f-]{36}$/);
  assert.equal(body.schedule.status, 'generated');
  assert.deepEqual(body.assignments.map((assignment) => assignment.status), ['planned']);
  assert.deepEqual(body.unassigned.map((entry) => entry.reasonCode), ['CAPACITY_EXHAUSTED']);
});

test('POST /api/schedules preserves an activity that does not advance cycles', async () => {
  const payload = validRequest();
  const response = await postSchedule({
    ...payload,
    configurationSnapshot: {
      ...payload.configurationSnapshot,
      activities: payload.configurationSnapshot.activities.map((activity) => ({
        ...activity,
        countsTowardCycle: false,
      })),
    },
  });

  assert.equal(response.status, 201);
  const body = await response.json() as { schedule: { configurationSnapshot: { activities: { countsTowardCycle?: boolean }[] } } };
  assert.equal(body.schedule.configurationSnapshot.activities[0].countsTowardCycle, false);
});

test('POST /api/schedules rejects a duplicate group assignment for a slot', async () => {
  const payload = validRequest();
  const response = await postSchedule({ ...payload, assignments: [...payload.assignments, payload.assignments[0]] });
  assert.equal(response.status, 409);
  assert.equal(schedules.schedules.size, 0);
});

test('POST /api/schedules never accepts generated assignments as completed history', async () => {
  const payload = validRequest();
  const response = await postSchedule({
    ...payload,
    assignments: payload.assignments.map((assignment) => ({ ...assignment, status: 'completed' })),
  });
  assert.equal(response.status, 400);
  assert.equal(schedules.schedules.size, 0);
});

test('POST /api/schedules rejects assignments that exceed snapshot capacity', async () => {
  const payload = validRequest();
  const response = await postSchedule({
    ...payload,
    assignments: [
      ...payload.assignments,
      { ...payload.assignments[0], groupId: 'sabana-2' },
    ],
    unassigned: [],
  });
  assert.equal(response.status, 409);
  assert.equal(schedules.schedules.size, 0);
});

test('POST /api/schedules rejects a used activity below its minimum group count', async () => {
  const payload = validRequest();
  const response = await postSchedule({
    ...payload,
    configurationSnapshot: {
      ...payload.configurationSnapshot,
      activities: payload.configurationSnapshot.activities.map((activity) => ({
        ...activity,
        minGroups: 2,
        maxGroups: 2,
      })),
    },
  });

  assert.equal(response.status, 409);
  assert.equal(schedules.schedules.size, 0);
});

test('POST /api/schedules rejects different programs in one activity and slot', async () => {
  const payload = validRequest();
  const response = await postSchedule({
    ...payload,
    configurationSnapshot: {
      ...payload.configurationSnapshot,
      categories: [
        ...payload.configurationSnapshot.categories,
        { id: 'bosque', name: 'Bosque', active: true },
      ],
      groups: payload.configurationSnapshot.groups.map((group, index) =>
        index === 1 ? { ...group, categoryId: 'bosque' } : group,
      ),
      activities: payload.configurationSnapshot.activities.map((activity) => ({ ...activity, maxGroups: 2 })),
      eligibility: [
        ...payload.configurationSnapshot.eligibility,
        { activityId: 'kayak', groupCategoryId: 'bosque' },
      ],
    },
    assignments: [
      ...payload.assignments,
      { ...payload.assignments[0], groupId: 'sabana-2' },
    ],
    unassigned: [],
  });

  assert.equal(response.status, 409);
  assert.equal(schedules.schedules.size, 0);
});

test('POST /api/schedules rejects time blocks from another season in the snapshot', async () => {
  const payload = validRequest();
  const response = await postSchedule({
    ...payload,
    configurationSnapshot: {
      ...payload.configurationSnapshot,
      timeBlocks: payload.configurationSnapshot.timeBlocks.map((block) => ({ ...block, seasonId: 'season-2' })),
    },
  });
  assert.equal(response.status, 400);
  assert.equal(schedules.schedules.size, 0);
});

test('GET /api/schedules/:id recovers a stored schedule', async () => {
  const created = await (await postSchedule(validRequest())).json() as { schedule: { id: string } };
  const response = await fetch(`${baseUrl}/api/schedules/${created.schedule.id}`);
  assert.equal(response.status, 200);
  const body = await response.json() as { assignments: unknown[]; unassigned: unknown[] };
  assert.equal(body.assignments.length, 1);
  assert.equal(body.unassigned.length, 1);
});

test('GET season schedules lists stored schedule summaries', async () => {
  await postSchedule(validRequest());
  const response = await fetch(`${baseUrl}/api/seasons/season-1/schedules`);
  assert.equal(response.status, 200);
  const body = await response.json() as { seed: number; status: string }[];
  assert.deepEqual(body.map((schedule) => schedule.seed), [2026]);
  assert.deepEqual(body.map((schedule) => schedule.status), ['generated']);
});

test('GET /api/schedules/:id returns 404 for an unknown schedule', async () => {
  const response = await fetch(`${baseUrl}/api/schedules/00000000-0000-4000-8000-000000000000`);
  assert.equal(response.status, 404);
  const body = await response.json() as { code: string };
  assert.equal(body.code, 'NOT_FOUND');
});
