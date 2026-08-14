import type {
  Activity,
  ActivityEligibility,
  Assignment,
  CampGroup,
  GroupCategory,
  ScheduleBlockResult,
  ScheduleBlockUnassigned,
  ScheduleGenerationDiagnostics,
  ScheduleGenerationMetrics,
  ScheduleGenerationResult,
  ScheduleGenerationStatus,
  Season,
  TimeBlock,
} from '../../domain';

export interface SavedScheduleData {
  schemaVersion: 1;
  configuration: {
    season: Season;
    categories: readonly GroupCategory[];
    groups: readonly CampGroup[];
    activities: readonly Activity[];
    eligibility: readonly ActivityEligibility[];
    timeBlocks: readonly TimeBlock[];
  };
  result: {
    status: ScheduleGenerationStatus;
    assignments: readonly Assignment[];
    unassigned: readonly ScheduleBlockUnassigned[];
    blocks: readonly ScheduleBlockResult[];
    metrics: ScheduleGenerationMetrics;
    diagnostics: ScheduleGenerationDiagnostics;
  };
}

export interface SavedScheduleInput {
  season: Season;
  categories: readonly GroupCategory[];
  groups: readonly CampGroup[];
  activities: readonly Activity[];
  eligibility: readonly ActivityEligibility[];
  timeBlocks: readonly TimeBlock[];
  result: ScheduleGenerationResult;
}

export function buildSavedScheduleData(input: SavedScheduleInput): SavedScheduleData {
  return {
    schemaVersion: 1,
    configuration: {
      season: structuredClone(input.season),
      categories: structuredClone(input.categories),
      groups: structuredClone(input.groups),
      activities: structuredClone(input.activities),
      eligibility: structuredClone(input.eligibility),
      timeBlocks: structuredClone(input.timeBlocks),
    },
    result: {
      status: input.result.status,
      assignments: structuredClone(input.result.assignments),
      unassigned: structuredClone(input.result.unassigned),
      blocks: structuredClone(input.result.blocks),
      metrics: structuredClone(input.result.metrics),
      diagnostics: structuredClone(input.result.diagnostics),
    },
  };
}

export function restoreSavedSchedule(data: SavedScheduleData): SavedScheduleInput {
  if (data.schemaVersion !== 1) throw new Error('Esta programación usa una versión de datos no compatible.');
  const cloned = structuredClone(data);
  return {
    ...cloned.configuration,
    result: {
      ...cloned.result,
      projectedCycles: [],
    },
  };
}
