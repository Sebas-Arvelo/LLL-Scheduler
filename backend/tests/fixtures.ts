import { randomUUID } from 'node:crypto';

import type {
  CreateScheduleRequest,
  SeasonConfiguration,
  StoredSchedule,
  StoredScheduleAssignment,
  StoredScheduleUnassigned,
} from '../src/contracts';
import type { ConfigRepository } from '../src/repositories/config-repository';
import type { ScheduleRepository, ScheduleSummary } from '../src/repositories/schedule-repository';

export const configuration: SeasonConfiguration = {
  season: {
    id: 'season-1',
    name: 'Season 1',
    startDate: '2026-08-01',
    endDate: '2026-08-31',
    active: true,
  },
  categories: [{ id: 'sabana', name: 'Sabana', active: true }],
  groups: [
    { id: 'sabana-1', name: 'Sabana 1', categoryId: 'sabana', participantCount: 10, active: true },
    { id: 'sabana-2', name: 'Sabana 2', categoryId: 'sabana', participantCount: 10, active: true },
  ],
  activities: [{ id: 'kayak', name: 'Kayak', maxGroups: 1, active: true }],
  eligibility: [{ activityId: 'kayak', groupCategoryId: 'sabana' }],
  timeBlocks: [{ id: 'block-1', seasonId: 'season-1', name: 'Block 1', order: 1, active: true }],
};

export function validRequest(): CreateScheduleRequest {
  return {
    seasonId: 'season-1',
    name: 'Generated schedule',
    rangeStart: '2026-08-10',
    rangeEnd: '2026-08-10',
    seed: 2026,
    algorithmVersion: 'multi-block-projection-v1',
    configurationSnapshot: configuration,
    assignments: [
      {
        groupId: 'sabana-1',
        activityId: 'kayak',
        date: '2026-08-10',
        timeBlockId: 'block-1',
        source: 'automatic',
        status: 'planned',
        locked: false,
      },
    ],
    unassigned: [
      {
        groupId: 'sabana-2',
        date: '2026-08-10',
        timeBlockId: 'block-1',
        reasonCode: 'CAPACITY_EXHAUSTED',
        context: { activityIds: ['kayak'] },
      },
    ],
  };
}

export class InMemoryConfigRepository implements ConfigRepository {
  async getSeasonConfiguration(seasonId: string): Promise<SeasonConfiguration | undefined> {
    return seasonId === configuration.season.id ? configuration : undefined;
  }
}

export class InMemoryScheduleRepository implements ScheduleRepository {
  readonly schedules = new Map<string, StoredSchedule>();

  async create(request: CreateScheduleRequest): Promise<StoredSchedule> {
    const id = randomUUID();
    const now = new Date().toISOString();
    const assignments: StoredScheduleAssignment[] = request.assignments.map((assignment) => ({
      ...assignment,
      id: randomUUID(),
      scheduleId: id,
    }));
    const unassigned: StoredScheduleUnassigned[] = request.unassigned.map((entry) => ({
      ...entry,
      id: randomUUID(),
      scheduleId: id,
      createdAt: now,
    }));
    const stored: StoredSchedule = {
      schedule: {
        id,
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
      },
      assignments,
      unassigned,
    };
    this.schedules.set(id, stored);
    return stored;
  }

  async getById(id: string): Promise<StoredSchedule | undefined> {
    return this.schedules.get(id);
  }

  async listBySeason(seasonId: string): Promise<readonly ScheduleSummary[]> {
    return [...this.schedules.values()]
      .filter((stored) => stored.schedule.seasonId === seasonId)
      .map((stored) => ({
        id: stored.schedule.id,
        ...(stored.schedule.name ? { name: stored.schedule.name } : {}),
        rangeStart: stored.schedule.rangeStart,
        rangeEnd: stored.schedule.rangeEnd,
        seed: stored.schedule.seed,
        status: stored.schedule.status,
        createdAt: stored.schedule.createdAt,
      }));
  }
}
