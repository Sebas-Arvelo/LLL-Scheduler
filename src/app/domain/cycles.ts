import type { ActivityId, CycleId, GroupId, IsoDateTime } from './identifiers';

export type ActivityCycleStatus = 'active' | 'completed';
export type CycleRequirementStatus = 'pending' | 'completed' | 'exempted';

export interface ActivityCycle {
  id: CycleId;
  groupId: GroupId;
  cycleNumber: number;
  status: ActivityCycleStatus;
  startedAt: IsoDateTime;
  completedAt?: IsoDateTime;
}

export interface CycleRequirement {
  cycleId: CycleId;
  activityId: ActivityId;
  status: CycleRequirementStatus;
}

export interface ActivityCycleSnapshot {
  cycle: ActivityCycle;
  requirements: readonly CycleRequirement[];
}
