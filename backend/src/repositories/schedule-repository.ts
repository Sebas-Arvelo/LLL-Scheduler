import { randomUUID } from 'node:crypto';

import type {
  CreateScheduleRequest,
  StoredSchedule,
  StoredScheduleAssignment,
  StoredScheduleMetadata,
  StoredScheduleUnassigned,
} from '../contracts';
import type { DatabasePool } from '../db/database';
import { withTransaction } from '../db/database';

export interface ScheduleSummary {
  id: string;
  name?: string;
  rangeStart: string;
  rangeEnd: string;
  seed: number;
  status: string;
  createdAt: string;
}

export interface ScheduleRepository {
  create(request: CreateScheduleRequest): Promise<StoredSchedule>;
  getById(id: string): Promise<StoredSchedule | undefined>;
  listBySeason(seasonId: string): Promise<readonly ScheduleSummary[]>;
}

function dateValue(value: unknown): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value);
}

function instantValue(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

export class PgScheduleRepository implements ScheduleRepository {
  constructor(private readonly pool: DatabasePool) {}

  async create(request: CreateScheduleRequest): Promise<StoredSchedule> {
    const scheduleId = randomUUID();
    const now = new Date().toISOString();
    const assignments: StoredScheduleAssignment[] = request.assignments.map((assignment) => ({
      ...assignment,
      id: randomUUID(),
      scheduleId,
    }));
    const unassigned: StoredScheduleUnassigned[] = request.unassigned.map((entry) => ({
      ...entry,
      id: randomUUID(),
      scheduleId,
      createdAt: now,
    }));
    const metadata: StoredScheduleMetadata = {
      id: scheduleId,
      seasonId: request.seasonId,
      ...(request.name ? { name: request.name } : {}),
      rangeStart: request.rangeStart,
      rangeEnd: request.rangeEnd,
      seed: request.seed,
      algorithmVersion: request.algorithmVersion,
      status: 'generated',
      configurationSnapshot: request.configurationSnapshot,
      createdAt: now,
      updatedAt: now,
    };

    await withTransaction(this.pool, async (client) => {
      await client.query(
        `INSERT INTO schedules (
           id, season_id, name, range_start, range_end, seed, algorithm_version, status, configuration_snapshot
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
        [
          metadata.id,
          metadata.seasonId,
          metadata.name ?? null,
          metadata.rangeStart,
          metadata.rangeEnd,
          metadata.seed,
          metadata.algorithmVersion,
          metadata.status,
          JSON.stringify(metadata.configurationSnapshot),
        ],
      );

      for (const assignment of assignments) {
        await client.query(
          `INSERT INTO assignments (
             id, schedule_id, group_id, activity_id, assignment_date, time_block_id, cycle_id, source, status, locked
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            assignment.id,
            assignment.scheduleId,
            assignment.groupId,
            assignment.activityId,
            assignment.date,
            assignment.timeBlockId,
            assignment.cycleId ?? null,
            assignment.source,
            assignment.status,
            assignment.locked,
          ],
        );
      }

      for (const entry of unassigned) {
        await client.query(
          `INSERT INTO schedule_unassigned (
             id, schedule_id, group_id, unassigned_date, time_block_id, reason_code, context
           ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
          [
            entry.id,
            entry.scheduleId,
            entry.groupId,
            entry.date,
            entry.timeBlockId,
            entry.reasonCode,
            entry.context ? JSON.stringify(entry.context) : null,
          ],
        );
      }
    });

    return { schedule: metadata, assignments, unassigned };
  }

  async getById(id: string): Promise<StoredSchedule | undefined> {
    const scheduleResult = await this.pool.query<{
      id: string;
      season_id: string;
      name: string | null;
      range_start: unknown;
      range_end: unknown;
      seed: string;
      algorithm_version: string;
      status: StoredScheduleMetadata['status'];
      configuration_snapshot: StoredScheduleMetadata['configurationSnapshot'];
      created_at: unknown;
      updated_at: unknown;
    }>(
      `SELECT id, season_id, name, range_start, range_end, seed, algorithm_version, status,
              configuration_snapshot, created_at, updated_at
       FROM schedules WHERE id = $1`,
      [id],
    );
    const row = scheduleResult.rows[0];
    if (!row) return undefined;

    const [assignmentResult, unassignedResult] = await Promise.all([
      this.pool.query<{
        id: string;
        schedule_id: string;
        group_id: string;
        activity_id: string;
        assignment_date: unknown;
        time_block_id: string;
        cycle_id: string | null;
        source: StoredScheduleAssignment['source'];
        status: StoredScheduleAssignment['status'];
        locked: boolean;
      }>(
        `SELECT id, schedule_id, group_id, activity_id, assignment_date, time_block_id,
                cycle_id, source, status, locked
         FROM assignments WHERE schedule_id = $1 ORDER BY assignment_date, time_block_id, group_id`,
        [id],
      ),
      this.pool.query<{
        id: string;
        schedule_id: string;
        group_id: string;
        unassigned_date: unknown;
        time_block_id: string;
        reason_code: StoredScheduleUnassigned['reasonCode'];
        context: Readonly<Record<string, unknown>> | null;
        created_at: unknown;
      }>(
        `SELECT id, schedule_id, group_id, unassigned_date, time_block_id, reason_code, context, created_at
         FROM schedule_unassigned WHERE schedule_id = $1 ORDER BY unassigned_date, time_block_id, group_id`,
        [id],
      ),
    ]);

    return {
      schedule: {
        id: row.id,
        seasonId: row.season_id,
        ...(row.name !== null ? { name: row.name } : {}),
        rangeStart: dateValue(row.range_start),
        rangeEnd: dateValue(row.range_end),
        seed: Number(row.seed),
        algorithmVersion: row.algorithm_version,
        status: row.status,
        configurationSnapshot: row.configuration_snapshot,
        createdAt: instantValue(row.created_at),
        updatedAt: instantValue(row.updated_at),
      },
      assignments: assignmentResult.rows.map((assignment) => ({
        id: assignment.id,
        scheduleId: assignment.schedule_id,
        groupId: assignment.group_id,
        activityId: assignment.activity_id,
        date: dateValue(assignment.assignment_date),
        timeBlockId: assignment.time_block_id,
        ...(assignment.cycle_id !== null ? { cycleId: assignment.cycle_id } : {}),
        source: assignment.source,
        status: assignment.status,
        locked: assignment.locked,
      })),
      unassigned: unassignedResult.rows.map((entry) => ({
        id: entry.id,
        scheduleId: entry.schedule_id,
        groupId: entry.group_id,
        date: dateValue(entry.unassigned_date),
        timeBlockId: entry.time_block_id,
        reasonCode: entry.reason_code,
        ...(entry.context !== null ? { context: entry.context } : {}),
        createdAt: instantValue(entry.created_at),
      })),
    };
  }

  async listBySeason(seasonId: string): Promise<readonly ScheduleSummary[]> {
    const result = await this.pool.query<{
      id: string;
      name: string | null;
      range_start: unknown;
      range_end: unknown;
      seed: string;
      status: string;
      created_at: unknown;
    }>(
      `SELECT id, name, range_start, range_end, seed, status, created_at
       FROM schedules WHERE season_id = $1 ORDER BY created_at DESC, id`,
      [seasonId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      ...(row.name !== null ? { name: row.name } : {}),
      rangeStart: dateValue(row.range_start),
      rangeEnd: dateValue(row.range_end),
      seed: Number(row.seed),
      status: row.status,
      createdAt: instantValue(row.created_at),
    }));
  }
}
