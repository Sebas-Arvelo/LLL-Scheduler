import type {
  Activity,
  ActivityEligibility,
  CampGroup,
  GroupCategory,
  ScheduleGenerationResult,
  Season,
  TimeBlock,
} from '../../domain';

export interface ConfigurationSnapshot {
  season: Season;
  categories: readonly GroupCategory[];
  groups: readonly CampGroup[];
  activities: readonly Activity[];
  eligibility: readonly ActivityEligibility[];
  timeBlocks: readonly TimeBlock[];
}

export interface CreateScheduleRequest {
  seasonId: string;
  name?: string;
  rangeStart: string;
  rangeEnd: string;
  seed: number;
  algorithmVersion: string;
  configurationSnapshot: ConfigurationSnapshot;
  assignments: readonly {
    groupId: string;
    activityId: string;
    date: string;
    timeBlockId: string;
    sessionId?: string;
    sessionBlockIndex?: number;
    sessionBlockCount?: number;
    cycleId?: string;
    source: 'automatic' | 'manual' | 'imported';
    status: 'planned';
    locked: boolean;
  }[];
  unassigned: readonly {
    groupId: string;
    date: string;
    timeBlockId: string;
    reasonCode: string;
    context?: Readonly<Record<string, unknown>>;
  }[];
}

export interface StoredSchedule {
  schedule: {
    id: string;
    seasonId: string;
    name?: string;
    rangeStart: string;
    rangeEnd: string;
    seed: number;
    algorithmVersion: string;
    status: 'draft' | 'generated' | 'archived';
    configurationSnapshot: ConfigurationSnapshot;
    createdAt: string;
    updatedAt: string;
  };
  assignments: readonly unknown[];
  unassigned: readonly unknown[];
}

export interface ScheduleApi {
  getSeasonConfiguration(seasonId: string): Promise<ConfigurationSnapshot>;
  saveSchedule(request: CreateScheduleRequest): Promise<StoredSchedule>;
  getSchedule(scheduleId: string): Promise<StoredSchedule>;
}

export interface SchedulePersistenceInput extends ConfigurationSnapshot {
  name?: string;
  rangeStart: string;
  rangeEnd: string;
  result: ScheduleGenerationResult;
}

export function mapSeasonConfiguration(configuration: ConfigurationSnapshot): ConfigurationSnapshot {
  const categoryIds = new Set(configuration.categories.map((category) => category.id));
  const activityIds = new Set(configuration.activities.map((activity) => activity.id));
  if (configuration.groups.some((group) => !categoryIds.has(group.categoryId))) {
    throw new Error('La configuración contiene un grupo con categoría desconocida.');
  }
  if (configuration.eligibility.some(
    (entry) => !activityIds.has(entry.activityId) || !categoryIds.has(entry.groupCategoryId),
  )) {
    throw new Error('La configuración contiene una relación de elegibilidad inválida.');
  }
  if (configuration.timeBlocks.some((block) => block.seasonId !== configuration.season.id)) {
    throw new Error('La configuración contiene un bloque de otra temporada.');
  }
  return {
    season: { ...configuration.season },
    categories: configuration.categories.map((category) => ({ ...category })),
    groups: configuration.groups.map((group) => ({ ...group })),
    activities: configuration.activities.map((activity) => ({ ...activity })),
    eligibility: configuration.eligibility.map((entry) => ({ ...entry })),
    timeBlocks: configuration.timeBlocks.map((block) => ({ ...block })),
  };
}

export function buildCreateScheduleRequest(input: SchedulePersistenceInput): CreateScheduleRequest {
  return {
    seasonId: input.season.id,
    ...(input.name ? { name: input.name } : {}),
    rangeStart: input.rangeStart,
    rangeEnd: input.rangeEnd,
    seed: input.result.diagnostics.seed,
    algorithmVersion: input.result.diagnostics.engineVersion,
    configurationSnapshot: {
      season: { ...input.season },
      categories: input.categories.map((category) => ({ ...category })),
      groups: input.groups.map((group) => ({ ...group })),
      activities: input.activities.map((activity) => ({ ...activity })),
      eligibility: input.eligibility.map((entry) => ({ ...entry })),
      timeBlocks: input.timeBlocks.map((block) => ({ ...block })),
    },
    assignments: input.result.assignments.map((assignment) => ({
      groupId: assignment.groupId,
      activityId: assignment.activityId,
      date: assignment.date,
      timeBlockId: assignment.timeBlockId,
      ...(assignment.sessionId ? { sessionId: assignment.sessionId } : {}),
      ...(assignment.sessionBlockIndex !== undefined ? { sessionBlockIndex: assignment.sessionBlockIndex } : {}),
      ...(assignment.sessionBlockCount !== undefined ? { sessionBlockCount: assignment.sessionBlockCount } : {}),
      ...(assignment.cycleId ? { cycleId: assignment.cycleId } : {}),
      source: assignment.source,
      status: 'planned' as const,
      locked: assignment.locked,
    })),
    unassigned: input.result.unassigned.flatMap((block) =>
      block.groups.map((group) => ({
        groupId: group.groupId,
        date: block.slot.date,
        timeBlockId: block.slot.timeBlockId,
        reasonCode: group.reasonCode,
        ...(group.context ? { context: group.context } : {}),
      })),
    ),
  };
}

export class HttpScheduleApi implements ScheduleApi {
  constructor(private readonly baseUrl = '/api') {}

  async getSeasonConfiguration(seasonId: string): Promise<ConfigurationSnapshot> {
    return mapSeasonConfiguration(
      await this.request<ConfigurationSnapshot>(`/seasons/${encodeURIComponent(seasonId)}/config`),
    );
  }

  saveSchedule(request: CreateScheduleRequest): Promise<StoredSchedule> {
    return this.request<StoredSchedule>('/schedules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
  }

  getSchedule(scheduleId: string): Promise<StoredSchedule> {
    return this.request<StoredSchedule>(`/schedules/${encodeURIComponent(scheduleId)}`);
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, init);
    const body = await response.json().catch(() => undefined) as { message?: string } | T | undefined;
    if (!response.ok) {
      const errorBody = typeof body === 'object' && body !== null ? body as { message?: string } : undefined;
      const message = errorBody?.message ?? `Request failed (${response.status}).`;
      throw new Error(message);
    }
    return body as T;
  }
}
