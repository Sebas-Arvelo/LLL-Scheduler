import type { Activity } from '../activities';
import type { ActivityCycleSnapshot } from '../cycles';
import type { CampGroup } from '../groups';
import type { ActivityId, GroupId } from '../identifiers';
import type {
  ActivityAvailability,
  Assignment,
  SchedulingDiagnosticIssue,
  SchedulingInput,
  SchedulingMetrics,
  SchedulingResult,
  UnassignedGroup,
} from '../scheduling';
import {
  validateActivity,
  validateActivityAvailability,
  validateActivityEligibility,
  validateCampGroup,
  validateTimeBlock,
} from '../validation';
import { matchingEdgeKey, solveMinCostMatching, type MatchingSolution } from './min-cost-matching';

export const BLOCK_SCHEDULER_ALGORITHM_VERSION = 'min-cost-block-matching-v1';

interface EffectiveActivity {
  activity: Activity;
  available: boolean;
  maxGroups: number;
  maxParticipants?: number;
}

interface SearchState {
  forbiddenEdges: ReadonlySet<string>;
  signature: string;
  solution: MatchingSolution;
}

const DEFAULT_SEED = 0;
const DEFAULT_COSTS = {
  pendingCycleActivity: 10_000_000_000,
  historicalBalance: 100_000,
  recentUse: 10_000,
  fairness: 100,
} as const;

function stableHash(seed: number, value: string): number {
  let hash = (2166136261 ^ seed) >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d) >>> 0;
  hash ^= hash >>> 15;
  return hash >>> 0;
}

function targetKey(date: string, timeBlockId: string, activityId: string): string {
  return `${date}\u0000${timeBlockId}\u0000${activityId}`;
}

function appliesToTarget(assignment: Assignment, input: SchedulingInput): boolean {
  return assignment.date === input.date && assignment.timeBlockId === input.timeBlock.id;
}

function diagnostic(
  code: SchedulingDiagnosticIssue['code'],
  message: string,
  context?: Readonly<Record<string, unknown>>,
): SchedulingDiagnosticIssue {
  return { code, message, ...(context ? { context } : {}) };
}

function effectiveActivities(
  input: SchedulingInput,
  errors: SchedulingDiagnosticIssue[],
): Map<ActivityId, EffectiveActivity> {
  const availability = new Map<string, ActivityAvailability>();
  for (const entry of input.hardConstraints.activityAvailability) {
    if (entry.date !== input.date || entry.timeBlockId !== input.timeBlock.id) {
      continue;
    }
    const key = targetKey(entry.date, entry.timeBlockId, entry.activityId);
    if (availability.has(key)) {
      errors.push(
        diagnostic('DUPLICATE_AVAILABILITY', 'An activity has multiple availability records for the target block.', {
          activityId: entry.activityId,
        }),
      );
      continue;
    }
    availability.set(key, entry);
  }

  return new Map(
    input.activities.map((activity) => {
      const override = availability.get(targetKey(input.date, input.timeBlock.id, activity.id));
      return [
        activity.id,
        {
          activity,
          available: activity.active && (override?.available ?? true),
          maxGroups: override?.maxGroupsOverride ?? activity.maxGroups,
          maxParticipants: override?.maxParticipantsOverride ?? activity.maxParticipants,
        },
      ];
    }),
  );
}

function currentCycleByGroup(snapshots: readonly ActivityCycleSnapshot[]): Map<GroupId, ActivityCycleSnapshot> {
  const result = new Map<GroupId, ActivityCycleSnapshot>();
  for (const snapshot of snapshots) {
    if (snapshot.cycle.status !== 'active') {
      continue;
    }
    const current = result.get(snapshot.cycle.groupId);
    if (!current || snapshot.cycle.cycleNumber > current.cycle.cycleNumber) {
      result.set(snapshot.cycle.groupId, snapshot);
    }
  }
  return result;
}

function invalidLockedAssignmentReasons(
  assignment: Assignment,
  input: SchedulingInput,
  groupsById: ReadonlyMap<GroupId, CampGroup>,
  activities: ReadonlyMap<ActivityId, EffectiveActivity>,
  eligibility: ReadonlySet<string>,
  unavailableGroups: ReadonlySet<GroupId>,
): string[] {
  const reasons: string[] = [];
  const group = groupsById.get(assignment.groupId);
  const effectiveActivity = activities.get(assignment.activityId);

  if (!assignment.locked) reasons.push('assignment is not marked as locked');
  if (assignment.status === 'cancelled') reasons.push('cancelled assignments cannot occupy capacity');
  if (!group) reasons.push('group does not exist in the input');
  if (group && !group.active) reasons.push('group is inactive');
  if (unavailableGroups.has(assignment.groupId)) reasons.push('group is unavailable');
  if (!effectiveActivity) reasons.push('activity does not exist in the input');
  if (effectiveActivity && !effectiveActivity.activity.active) reasons.push('activity is inactive');
  if (effectiveActivity && !effectiveActivity.available) reasons.push('activity is unavailable');
  if (group && effectiveActivity && !eligibility.has(matchingEdgeKey(assignment.activityId, group.categoryId))) {
    reasons.push('group category is not eligible for the activity');
  }
  if (group && effectiveActivity?.maxParticipants !== undefined && group.participantCount === undefined) {
    reasons.push('participantCount is required by the activity capacity');
  }
  return reasons;
}

function compareSearchState(left: SearchState, right: SearchState): number {
  if (left.solution.flow !== right.solution.flow) return right.solution.flow - left.solution.flow;
  if (left.solution.cost !== right.solution.cost) return left.solution.cost - right.solution.cost;
  return left.signature.localeCompare(right.signature);
}

function participantViolation(
  matches: ReadonlyMap<GroupId, ActivityId>,
  groupsById: ReadonlyMap<GroupId, CampGroup>,
  activities: ReadonlyMap<ActivityId, EffectiveActivity>,
  lockedParticipantLoad: ReadonlyMap<ActivityId, number>,
): { activityId: ActivityId; groupIds: GroupId[] } | undefined {
  const assignedByActivity = new Map<ActivityId, GroupId[]>();
  for (const [groupId, activityId] of matches) {
    const groupIds = assignedByActivity.get(activityId) ?? [];
    groupIds.push(groupId);
    assignedByActivity.set(activityId, groupIds);
  }

  for (const activityId of [...assignedByActivity.keys()].sort()) {
    const maximum = activities.get(activityId)?.maxParticipants;
    if (maximum === undefined) continue;
    const groupIds = assignedByActivity.get(activityId)!;
    const generatedLoad = groupIds.reduce((sum, groupId) => sum + groupsById.get(groupId)!.participantCount!, 0);
    if ((lockedParticipantLoad.get(activityId) ?? 0) + generatedLoad > maximum) {
      return { activityId, groupIds: [...groupIds].sort() };
    }
  }
  return undefined;
}

function solveWithParticipantCapacity(
  groupIds: readonly GroupId[],
  activityIds: readonly ActivityId[],
  candidatesByGroup: ReadonlyMap<GroupId, readonly ActivityId[]>,
  activityCapacities: ReadonlyMap<ActivityId, number>,
  edgeCost: (groupId: GroupId, activityId: ActivityId) => number,
  groupsById: ReadonlyMap<GroupId, CampGroup>,
  activities: ReadonlyMap<ActivityId, EffectiveActivity>,
  lockedParticipantLoad: ReadonlyMap<ActivityId, number>,
): MatchingSolution {
  const makeState = (forbiddenEdges: ReadonlySet<string>): SearchState => {
    const signature = [...forbiddenEdges].sort().join('|');
    return {
      forbiddenEdges,
      signature,
      solution: solveMinCostMatching({
        groupIds,
        activityIds,
        candidatesByGroup,
        activityCapacities,
        forbiddenEdges,
        edgeCost,
      }),
    };
  };

  const queue: SearchState[] = [makeState(new Set())];
  const visited = new Set<string>(['']);

  while (queue.length > 0) {
    queue.sort(compareSearchState);
    const state = queue.shift()!;
    const violation = participantViolation(state.solution.matches, groupsById, activities, lockedParticipantLoad);
    if (!violation) return state.solution;

    for (const groupId of violation.groupIds) {
      const forbiddenEdges = new Set(state.forbiddenEdges);
      forbiddenEdges.add(matchingEdgeKey(groupId, violation.activityId));
      const signature = [...forbiddenEdges].sort().join('|');
      if (!visited.has(signature)) {
        visited.add(signature);
        queue.push(makeState(forbiddenEdges));
      }
    }
  }

  return { matches: new Map(), flow: 0, cost: 0 };
}

export function scheduleBlock(input: SchedulingInput): SchedulingResult {
  const seed = Number.isFinite(input.seed) ? Math.trunc(input.seed!) >>> 0 : DEFAULT_SEED;
  const warnings: SchedulingDiagnosticIssue[] = [];
  const errors: SchedulingDiagnosticIssue[] = [];
  const groupsById = new Map<GroupId, CampGroup>();
  const duplicateGroupIds = new Set<GroupId>();
  for (const group of input.groups) {
    if (groupsById.has(group.id)) duplicateGroupIds.add(group.id);
    groupsById.set(group.id, group);
  }
  const domainIssues = [
    ...validateTimeBlock(input.timeBlock),
    ...input.groups.flatMap((group) => validateCampGroup(group)),
    ...input.activities.flatMap((activity) => validateActivity(activity)),
    ...input.activityEligibility.flatMap((entry) =>
      validateActivityEligibility(entry, input.activities, input.groupCategories),
    ),
    ...input.hardConstraints.activityAvailability.flatMap((entry) => validateActivityAvailability(entry)),
  ];
  if (domainIssues.length > 0) {
    errors.push(
      diagnostic('INVALID_SCHEDULING_INPUT', 'Scheduling input failed domain validation.', {
        issues: domainIssues,
      }),
    );
  }
  if (duplicateGroupIds.size > 0) {
    errors.push(
      diagnostic('INVALID_SCHEDULING_INPUT', 'Group IDs must be unique.', { groupIds: [...duplicateGroupIds].sort() }),
    );
  }

  const activityIds = input.activities.map((activity) => activity.id);
  if (new Set(activityIds).size !== activityIds.length) {
    errors.push(diagnostic('INVALID_SCHEDULING_INPUT', 'Activity IDs must be unique.'));
  }
  if (!input.timeBlock.active) {
    errors.push(diagnostic('INVALID_SCHEDULING_INPUT', 'The target time block is inactive.'));
  }

  const activities = effectiveActivities(input, errors);
  const eligibility = new Set(
    input.activityEligibility.map((entry) => matchingEdgeKey(entry.activityId, entry.groupCategoryId)),
  );
  const unavailableGroups = new Set(
    input.hardConstraints.groupUnavailability
      .filter((entry) => entry.date === input.date && entry.timeBlockId === input.timeBlock.id)
      .map((entry) => entry.groupId),
  );
  const inactiveGroups = input.groups.filter((group) => !group.active);
  for (const group of inactiveGroups) {
    warnings.push(
      diagnostic('INACTIVE_GROUP_SKIPPED', 'Inactive group was excluded from scheduling.', { groupId: group.id }),
    );
  }

  const relevantLocked: Assignment[] = [];
  for (const assignment of input.lockedAssignments) {
    if (!appliesToTarget(assignment, input)) {
      warnings.push(
        diagnostic('LOCKED_ASSIGNMENT_OUTSIDE_TARGET', 'Locked assignment does not belong to the target block.', {
          groupId: assignment.groupId,
          activityId: assignment.activityId,
        }),
      );
      continue;
    }
    relevantLocked.push(assignment);
    const reasons = invalidLockedAssignmentReasons(
      assignment,
      input,
      groupsById,
      activities,
      eligibility,
      unavailableGroups,
    );
    if (reasons.length > 0) {
      errors.push(
        diagnostic('INVALID_LOCKED_ASSIGNMENT', 'Locked assignment violates hard constraints.', {
          groupId: assignment.groupId,
          activityId: assignment.activityId,
          reasons,
        }),
      );
    }
  }

  const duplicateLockedGroups = relevantLocked
    .map((assignment) => assignment.groupId)
    .filter((groupId, index, all) => all.indexOf(groupId) !== index);
  if (duplicateLockedGroups.length > 0) {
    errors.push(
      diagnostic('INVALID_LOCKED_ASSIGNMENT', 'A group has more than one locked assignment in the target block.', {
        groupIds: [...new Set(duplicateLockedGroups)].sort(),
      }),
    );
  }

  const lockedGroupLoad = new Map<ActivityId, number>();
  const lockedParticipantLoad = new Map<ActivityId, number>();
  for (const assignment of relevantLocked) {
    lockedGroupLoad.set(assignment.activityId, (lockedGroupLoad.get(assignment.activityId) ?? 0) + 1);
    const participantCount = groupsById.get(assignment.groupId)?.participantCount;
    if (participantCount !== undefined) {
      lockedParticipantLoad.set(
        assignment.activityId,
        (lockedParticipantLoad.get(assignment.activityId) ?? 0) + participantCount,
      );
    }
  }
  for (const [activityId, groupLoad] of lockedGroupLoad) {
    const activity = activities.get(activityId);
    if (!activity) continue;
    if (groupLoad > activity.maxGroups) {
      errors.push(
        diagnostic('INVALID_LOCKED_ASSIGNMENT', 'Locked assignments exceed maxGroups.', {
          activityId,
          groupLoad,
          maxGroups: activity.maxGroups,
        }),
      );
    }
    const participantLoad = lockedParticipantLoad.get(activityId) ?? 0;
    if (activity.maxParticipants !== undefined && participantLoad > activity.maxParticipants) {
      errors.push(
        diagnostic('INVALID_LOCKED_ASSIGNMENT', 'Locked assignments exceed maxParticipants.', {
          activityId,
          participantLoad,
          maxParticipants: activity.maxParticipants,
        }),
      );
    }
  }

  const activeGroups = input.groups.filter((group) => group.active);
  const lockedGroupIds = new Set(relevantLocked.map((assignment) => assignment.groupId));
  const baseMetrics = {
    candidateCount: 0,
    inputGroupCount: input.groups.length,
    evaluatedGroupCount: activeGroups.filter((group) => !lockedGroupIds.has(group.id)).length,
    inactiveGroupCount: inactiveGroups.length,
    lockedAssignmentCount: relevantLocked.length,
  };

  if (errors.length > 0) {
    const unassigned = activeGroups
      .filter((group) => !lockedGroupIds.has(group.id))
      .map<UnassignedGroup>((group) => ({
        groupId: group.id,
        reasonCode: 'INVALID_INPUT',
        message: 'Scheduling was not attempted because the input contains invalid locked assignments or configuration.',
      }));
    return {
      status: 'invalid_input',
      assignments: [...relevantLocked],
      unassigned,
      diagnostics: {
        algorithmVersion: BLOCK_SCHEDULER_ALGORITHM_VERSION,
        seed,
        metrics: {
          ...baseMetrics,
          assignedGroupCount: relevantLocked.length,
          unassignedGroupCount: unassigned.length,
        },
        warnings,
        errors,
      },
    };
  }

  const preUnassigned: UnassignedGroup[] = [];
  const candidatesByGroup = new Map<GroupId, ActivityId[]>();
  const activeCategoryIds = new Set(input.groupCategories.filter((category) => category.active).map((category) => category.id));
  const usableActivities = [...activities.values()].filter((entry) => entry.activity.active);

  for (const group of activeGroups.filter((candidate) => !lockedGroupIds.has(candidate.id)).sort((a, b) => a.id.localeCompare(b.id))) {
    if (unavailableGroups.has(group.id)) {
      preUnassigned.push({
        groupId: group.id,
        reasonCode: 'GROUP_UNAVAILABLE',
        message: 'The group is unavailable for the requested date and time block.',
      });
      continue;
    }

    const eligible = usableActivities.filter(
      (entry) =>
        activeCategoryIds.has(group.categoryId) && eligibility.has(matchingEdgeKey(entry.activity.id, group.categoryId)),
    );
    if (eligible.length === 0) {
      preUnassigned.push({
        groupId: group.id,
        reasonCode: 'NO_ELIGIBLE_ACTIVITY',
        message: 'No active activity is eligible for the group category.',
      });
      continue;
    }

    const available = eligible.filter((entry) => entry.available);
    if (available.length === 0) {
      preUnassigned.push({
        groupId: group.id,
        reasonCode: 'NO_AVAILABLE_ACTIVITY',
        message: 'Eligible activities are unavailable for the requested block.',
      });
      continue;
    }

    let excludedForUnknownParticipants = false;
    const candidates = available
      .filter((entry) => {
        if (entry.maxParticipants === undefined) return true;
        if (group.participantCount === undefined) {
          excludedForUnknownParticipants = true;
          return false;
        }
        return group.participantCount <= entry.maxParticipants - (lockedParticipantLoad.get(entry.activity.id) ?? 0);
      })
      .map((entry) => entry.activity.id);

    if (excludedForUnknownParticipants) {
      warnings.push(
        diagnostic('PARTICIPANT_COUNT_REQUIRED', 'One or more candidate activities require a known participantCount.', {
          groupId: group.id,
        }),
      );
    }
    if (candidates.length === 0) {
      preUnassigned.push({
        groupId: group.id,
        reasonCode: excludedForUnknownParticipants ? 'PARTICIPANT_COUNT_REQUIRED' : 'CAPACITY_EXHAUSTED',
        message: excludedForUnknownParticipants
          ? 'The group cannot be evaluated against participant capacity without participantCount.'
          : 'The group exceeds the remaining participant capacity of every eligible activity.',
      });
      continue;
    }
    candidatesByGroup.set(group.id, candidates);
  }

  const schedulableGroupIds = [...candidatesByGroup.keys()];
  const schedulableActivityIds = [...new Set([...candidatesByGroup.values()].flat())];
  const activityCapacities = new Map<ActivityId, number>();
  for (const activityId of schedulableActivityIds) {
    const activity = activities.get(activityId)!;
    activityCapacities.set(activityId, Math.max(0, activity.maxGroups - (lockedGroupLoad.get(activityId) ?? 0)));
  }

  const cycleByGroup = currentCycleByGroup(input.cycleSnapshots);
  const completedHistory = input.history.filter((assignment) => assignment.status === 'completed');
  const historyCount = new Map<string, number>();
  const groupHistoryCount = new Map<GroupId, number>();
  const recentHistoryCount = new Map<string, number>();
  for (const assignment of completedHistory) {
    const key = matchingEdgeKey(assignment.groupId, assignment.activityId);
    historyCount.set(key, (historyCount.get(key) ?? 0) + 1);
    groupHistoryCount.set(assignment.groupId, (groupHistoryCount.get(assignment.groupId) ?? 0) + 1);
  }
  for (const groupId of schedulableGroupIds) {
    const recent = completedHistory
      .filter((assignment) => assignment.groupId === groupId)
      .sort((left, right) => right.date.localeCompare(left.date))
      .slice(0, 3);
    for (const assignment of recent) {
      const key = matchingEdgeKey(groupId, assignment.activityId);
      recentHistoryCount.set(key, (recentHistoryCount.get(key) ?? 0) + 1);
    }
  }

  const costs = { ...DEFAULT_COSTS, ...input.preferences?.weights };
  const edgeCost = (groupId: GroupId, activityId: ActivityId): number => {
    const snapshot = cycleByGroup.get(groupId);
    const pending = new Set(
      snapshot?.requirements.filter((requirement) => requirement.status === 'pending').map((requirement) => requirement.activityId) ?? [],
    );
    const repeatCost = pending.size > 0 && !pending.has(activityId) ? costs.pendingCycleActivity : 0;
    const balanceCost = (historyCount.get(matchingEdgeKey(groupId, activityId)) ?? 0) * costs.historicalBalance;
    const recentCost = (recentHistoryCount.get(matchingEdgeKey(groupId, activityId)) ?? 0) * costs.recentUse;
    const fairnessCost = (groupHistoryCount.get(groupId) ?? 0) * costs.fairness;
    const tieCost = stableHash(seed, `${groupId}\u0000${activityId}`) % 97;
    return repeatCost + balanceCost + recentCost + fairnessCost + tieCost;
  };

  const solution = solveWithParticipantCapacity(
    schedulableGroupIds,
    schedulableActivityIds,
    candidatesByGroup,
    activityCapacities,
    edgeCost,
    groupsById,
    activities,
    lockedParticipantLoad,
  );

  const generatedAssignments = [...solution.matches]
    .sort(([left], [right]) => left.localeCompare(right))
    .map<Assignment>(([groupId, activityId]) => ({
      groupId,
      activityId,
      date: input.date,
      timeBlockId: input.timeBlock.id,
      cycleId: cycleByGroup.get(groupId)?.cycle.id,
      source: 'automatic',
      status: 'proposed',
      locked: false,
    }));
  const allAssignments = [...relevantLocked, ...generatedAssignments];

  const finalGroupLoad = new Map(lockedGroupLoad);
  const finalParticipantLoad = new Map(lockedParticipantLoad);
  for (const assignment of generatedAssignments) {
    finalGroupLoad.set(assignment.activityId, (finalGroupLoad.get(assignment.activityId) ?? 0) + 1);
    finalParticipantLoad.set(
      assignment.activityId,
      (finalParticipantLoad.get(assignment.activityId) ?? 0) + (groupsById.get(assignment.groupId)?.participantCount ?? 0),
    );
  }

  const unmatched = schedulableGroupIds.filter((groupId) => !solution.matches.has(groupId));
  const unmatchedResults = unmatched.map<UnassignedGroup>((groupId) => {
    const group = groupsById.get(groupId)!;
    const candidates = candidatesByGroup.get(groupId)!;
    const allAtCapacity = candidates.every((activityId) => {
      const activity = activities.get(activityId)!;
      if ((finalGroupLoad.get(activityId) ?? 0) >= activity.maxGroups) return true;
      return (
        activity.maxParticipants !== undefined &&
        (finalParticipantLoad.get(activityId) ?? 0) + (group.participantCount ?? 0) > activity.maxParticipants
      );
    });
    return {
      groupId,
      reasonCode: allAtCapacity ? 'CAPACITY_EXHAUSTED' : 'NO_FEASIBLE_ASSIGNMENT',
      message: allAtCapacity
        ? 'Every valid activity reached its group or participant capacity.'
        : 'No globally feasible assignment was found for the group.',
    };
  });
  const unassigned = [...preUnassigned, ...unmatchedResults].sort((left, right) => left.groupId.localeCompare(right.groupId));
  const metrics: SchedulingMetrics = {
    ...baseMetrics,
    candidateCount: [...candidatesByGroup.values()].reduce((sum, candidates) => sum + candidates.length, 0),
    assignedGroupCount: allAssignments.length,
    unassignedGroupCount: unassigned.length,
  };

  return {
    status: 'success',
    assignments: allAssignments,
    unassigned,
    diagnostics: {
      algorithmVersion: BLOCK_SCHEDULER_ALGORITHM_VERSION,
      seed,
      metrics,
      warnings,
      errors,
    },
  };
}
