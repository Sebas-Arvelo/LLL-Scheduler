export const UNASSIGNED_REASON_CODES = [
  'NO_ELIGIBLE_ACTIVITY',
  'CAPACITY_EXHAUSTED',
  'GROUP_UNAVAILABLE',
  'NO_AVAILABLE_ACTIVITY',
  'PARTICIPANT_COUNT_REQUIRED',
  'INVALID_INPUT',
  'NO_FEASIBLE_ASSIGNMENT',
] as const;

export type PersistedUnassignedReasonCode = (typeof UNASSIGNED_REASON_CODES)[number];
export type PersistedAssignmentSource = 'automatic' | 'manual' | 'imported';
export type PersistedAssignmentStatus = 'planned' | 'confirmed' | 'completed' | 'cancelled';
export type PersistedScheduleStatus = 'draft' | 'generated' | 'archived';

export interface ConfigurationSnapshot {
  season: { id: string; name: string; startDate: string; endDate: string; active: boolean };
  categories: readonly { id: string; name: string; active: boolean }[];
  groups: readonly { id: string; name: string; categoryId: string; active: boolean; participantCount?: number }[];
  activities: readonly {
    id: string;
    name: string;
    active: boolean;
    minGroups?: number;
    maxGroups: number;
    maxParticipants?: number;
    countsTowardCycle?: boolean;
    displayCategory?: string;
    description?: string;
  }[];
  eligibility: readonly { activityId: string; groupCategoryId: string }[];
  timeBlocks: readonly {
    id: string;
    seasonId: string;
    name: string;
    order: number;
    active: boolean;
    startTime?: string;
    endTime?: string;
  }[];
}

export interface CreateScheduleAssignment {
  groupId: string;
  activityId: string;
  date: string;
  timeBlockId: string;
  cycleId?: string;
  source: PersistedAssignmentSource;
  status: 'planned';
  locked: boolean;
}

export interface CreateScheduleUnassigned {
  groupId: string;
  date: string;
  timeBlockId: string;
  reasonCode: PersistedUnassignedReasonCode;
  context?: Readonly<Record<string, unknown>>;
}

export interface CreateScheduleRequest {
  seasonId: string;
  name?: string;
  rangeStart: string;
  rangeEnd: string;
  seed: number;
  algorithmVersion: string;
  configurationSnapshot: ConfigurationSnapshot;
  assignments: readonly CreateScheduleAssignment[];
  unassigned: readonly CreateScheduleUnassigned[];
}

export interface StoredScheduleMetadata {
  id: string;
  seasonId: string;
  name?: string;
  rangeStart: string;
  rangeEnd: string;
  seed: number;
  algorithmVersion: string;
  status: PersistedScheduleStatus;
  configurationSnapshot: ConfigurationSnapshot;
  createdAt: string;
  updatedAt: string;
}

export interface StoredScheduleAssignment extends Omit<CreateScheduleAssignment, 'status'> {
  id: string;
  scheduleId: string;
  status: PersistedAssignmentStatus;
}

export interface StoredScheduleUnassigned extends CreateScheduleUnassigned {
  id: string;
  scheduleId: string;
  createdAt: string;
}

export interface StoredSchedule {
  schedule: StoredScheduleMetadata;
  assignments: readonly StoredScheduleAssignment[];
  unassigned: readonly StoredScheduleUnassigned[];
}

export interface SeasonConfiguration extends ConfigurationSnapshot {}
