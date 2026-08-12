import type { Activity } from '../activities';
import type { CampGroup } from '../groups';
import type {
  GroupScheduleMetrics,
  ScheduleGenerationMetrics,
} from '../schedule-generation';
import type { Assignment } from '../scheduling';
import type { ProjectedAssignmentEffect } from './projected-cycles';

function increment(record: Record<string, number>, key: string): void {
  record[key] = (record[key] ?? 0) + 1;
}

function standardDeviation(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

export function calculateScheduleMetrics(
  groups: readonly CampGroup[],
  activities: readonly Activity[],
  slotCount: number,
  assignments: readonly Assignment[],
  unassignedCellCount: number,
  effects: readonly ProjectedAssignmentEffect[],
): ScheduleGenerationMetrics {
  const activeGroups = groups.filter((group) => group.active);
  const prematureByGroup = new Map<string, number>();
  const completedCyclesByGroup = new Map<string, number>();
  for (const effect of effects) {
    if (effect.prematureRepetition) {
      prematureByGroup.set(effect.groupId, (prematureByGroup.get(effect.groupId) ?? 0) + 1);
    }
    if (effect.completedCycleId !== undefined) {
      completedCyclesByGroup.set(effect.groupId, (completedCyclesByGroup.get(effect.groupId) ?? 0) + 1);
    }
  }

  const byGroup = activeGroups
    .map<GroupScheduleMetrics>((group) => {
      const groupAssignments = assignments.filter((assignment) => assignment.groupId === group.id);
      const activityUsage: Record<string, number> = {};
      for (const assignment of groupAssignments) increment(activityUsage, assignment.activityId);
      return {
        groupId: group.id,
        totalAssignments: groupAssignments.length,
        distinctActivityCount: Object.keys(activityUsage).length,
        prematureRepetitionCount: prematureByGroup.get(group.id) ?? 0,
        completedCycleCount: completedCyclesByGroup.get(group.id) ?? 0,
        activityUsage,
      };
    })
    .sort((left, right) => left.groupId.localeCompare(right.groupId));

  const activityUsage: Record<string, number> = Object.fromEntries(activities.map((activity) => [activity.id, 0]));
  for (const assignment of assignments) increment(activityUsage, assignment.activityId);
  const requestedGroupBlocks = activeGroups.length * slotCount;
  const successfulAssignments = assignments.length;

  return {
    byGroup,
    global: {
      requestedGroupBlocks,
      successfulAssignments,
      unassignedCells: unassignedCellCount,
      coveragePercentage: requestedGroupBlocks === 0 ? 100 : (successfulAssignments / requestedGroupBlocks) * 100,
      prematureRepetitionCount: effects.filter((effect) => effect.prematureRepetition).length,
      activityUsage,
      activityUsageStandardDeviation: standardDeviation(Object.values(activityUsage)),
    },
  };
}
