import type { ActivityId, GroupCategoryId } from './identifiers';

export interface Activity {
  id: ActivityId;
  name: string;
  active: boolean;
  minGroups?: number;
  maxGroups: number;
  maxParticipants?: number;
  countsTowardCycle?: boolean;
  displayCategory?: string;
  description?: string;
}

/**
 * Join record between an activity and an eligible group category. Keeping the
 * relationship separate maps directly to a future database join table.
 */
export interface ActivityEligibility {
  activityId: ActivityId;
  groupCategoryId: GroupCategoryId;
}
