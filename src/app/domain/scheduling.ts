import type { Activity, ActivityEligibility } from './activities';
import type { ActivityCycleSnapshot } from './cycles';
import type { CampGroup, GroupCategory } from './groups';
import type {
  ActivityId,
  CycleId,
  GroupId,
  LocalDate,
  ScheduleId,
  TimeBlockId,
} from './identifiers';
import type { TimeBlock } from './time-blocks';

export type AssignmentSource = 'automatic' | 'manual' | 'imported';
export type AssignmentStatus = 'proposed' | 'confirmed' | 'completed' | 'cancelled';

export interface Assignment {
  scheduleId?: ScheduleId;
  groupId: GroupId;
  activityId: ActivityId;
  date: LocalDate;
  timeBlockId: TimeBlockId;
  cycleId?: CycleId;
  source: AssignmentSource;
  status: AssignmentStatus;
  locked: boolean;
}

/** An absent record means the activity uses its normal capacity and availability. */
export interface ActivityAvailability {
  activityId: ActivityId;
  date: LocalDate;
  timeBlockId: TimeBlockId;
  available: boolean;
  maxGroupsOverride?: number;
  maxParticipantsOverride?: number;
}

export interface GroupUnavailability {
  groupId: GroupId;
  date: LocalDate;
  timeBlockId: TimeBlockId;
  reason?: string;
}

export interface SchedulingHardConstraints {
  activityAvailability: readonly ActivityAvailability[];
  groupUnavailability: readonly GroupUnavailability[];
}

export interface SchedulingCostWeights {
  pendingCycleActivity: number;
  historicalBalance: number;
  recentUse: number;
  fairness: number;
}

export interface SchedulingPreferences {
  weights?: Partial<SchedulingCostWeights>;
}

export interface SchedulingInput {
  date: LocalDate;
  timeBlock: TimeBlock;
  groups: readonly CampGroup[];
  activities: readonly Activity[];
  groupCategories: readonly GroupCategory[];
  activityEligibility: readonly ActivityEligibility[];
  cycleSnapshots: readonly ActivityCycleSnapshot[];
  history: readonly Assignment[];
  lockedAssignments: readonly Assignment[];
  hardConstraints: SchedulingHardConstraints;
  preferences?: SchedulingPreferences;
  seed?: number;
}

export type UnassignedReasonCode =
  | 'NO_ELIGIBLE_ACTIVITY'
  | 'CAPACITY_EXHAUSTED'
  | 'GROUP_UNAVAILABLE'
  | 'NO_AVAILABLE_ACTIVITY'
  | 'NO_FEASIBLE_ASSIGNMENT';

export interface UnassignedGroup {
  groupId: GroupId;
  reasonCode: UnassignedReasonCode;
  message: string;
  context?: Readonly<Record<string, unknown>>;
}

export interface SchedulingWarning {
  code: string;
  message: string;
}

export interface SchedulingMetrics {
  candidateCount: number;
  assignedGroupCount: number;
  unassignedGroupCount: number;
}

export interface SchedulingDiagnostics {
  algorithmVersion: string;
  seed?: number;
  metrics?: SchedulingMetrics;
  warnings: readonly SchedulingWarning[];
}

export interface SchedulingResult {
  assignments: readonly Assignment[];
  unassigned: readonly UnassignedGroup[];
  diagnostics: SchedulingDiagnostics;
}
