import type { Activity, ActivityEligibility } from './activities';
import type { ActivityCycleSnapshot } from './cycles';
import type { CampGroup, GroupCategory } from './groups';
import type { CycleId, GroupId, LocalDate, TimeBlockId } from './identifiers';
import type { Season } from './seasons';
import type {
  Assignment,
  SchedulingHardConstraints,
  SchedulingPreferences,
  SchedulingResult,
  SchedulingDiagnosticIssue,
  UnassignedGroup,
} from './scheduling';
import type { TimeBlock } from './time-blocks';

export interface ScheduleGenerationInput {
  season: Season;
  dates: readonly LocalDate[];
  timeBlocks: readonly TimeBlock[];
  groups: readonly CampGroup[];
  activities: readonly Activity[];
  groupCategories: readonly GroupCategory[];
  activityEligibility: readonly ActivityEligibility[];
  initialCycleSnapshots: readonly ActivityCycleSnapshot[];
  history: readonly Assignment[];
  lockedAssignments: readonly Assignment[];
  hardConstraints: SchedulingHardConstraints;
  preferences?: SchedulingPreferences;
  seed?: number;
}

export interface ScheduleSlot {
  date: LocalDate;
  timeBlockId: TimeBlockId;
  timeBlockOrder: number;
}

export interface ScheduleBlockResult {
  slot: ScheduleSlot;
  result: SchedulingResult;
}

export interface ScheduleBlockUnassigned {
  slot: ScheduleSlot;
  groups: readonly UnassignedGroup[];
}

export type ProjectedCycleOrigin = 'initial' | 'opened_during_generation';

export interface ProjectedCycleSnapshot {
  snapshot: ActivityCycleSnapshot;
  origin: ProjectedCycleOrigin;
  startedInSlot?: ScheduleSlot;
  completedInSlot?: ScheduleSlot;
}

export interface ProjectedGroupCycleState {
  groupId: GroupId;
  cycles: readonly ProjectedCycleSnapshot[];
  currentCycleId?: CycleId;
}

export interface GroupScheduleMetrics {
  groupId: GroupId;
  totalAssignments: number;
  distinctActivityCount: number;
  prematureRepetitionCount: number;
  completedCycleCount: number;
  activityUsage: Readonly<Record<string, number>>;
}

export interface GlobalScheduleMetrics {
  requestedGroupBlocks: number;
  successfulAssignments: number;
  unassignedCells: number;
  coveragePercentage: number;
  prematureRepetitionCount: number;
  activityUsage: Readonly<Record<string, number>>;
  activityUsageStandardDeviation: number;
}

export interface ScheduleGenerationMetrics {
  byGroup: readonly GroupScheduleMetrics[];
  global: GlobalScheduleMetrics;
}

export type ScheduleGenerationStatus = 'success' | 'partial' | 'invalid_input';

export interface ScheduleGenerationDiagnostics {
  engineVersion: string;
  seed: number;
  blockCount: number;
  generatedBlockCount: number;
  branchAndBoundNodes: number;
  branchAndBoundBranches: number;
  warnings: readonly SchedulingDiagnosticIssue[];
  errors: readonly SchedulingDiagnosticIssue[];
}

export interface ScheduleGenerationResult {
  status: ScheduleGenerationStatus;
  assignments: readonly Assignment[];
  unassigned: readonly ScheduleBlockUnassigned[];
  projectedCycles: readonly ProjectedGroupCycleState[];
  blocks: readonly ScheduleBlockResult[];
  metrics: ScheduleGenerationMetrics;
  diagnostics: ScheduleGenerationDiagnostics;
}
