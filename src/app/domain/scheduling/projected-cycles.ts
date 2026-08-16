import type { Activity, ActivityEligibility } from '../activities';
import type { ActivityCycleSnapshot, CycleRequirement } from '../cycles';
import type { CampGroup } from '../groups';
import type { ActivityId, CycleId, GroupId } from '../identifiers';
import type {
  ProjectedCycleSnapshot,
  ProjectedGroupCycleState,
  ScheduleSlot,
} from '../schedule-generation';
import type { Assignment } from '../scheduling';

export interface ProjectedAssignmentEffect {
  groupId: GroupId;
  activityId: ActivityId;
  prematureRepetition: boolean;
  completedCycleId?: CycleId;
}

export interface ProjectedCycleUpdate {
  states: readonly ProjectedGroupCycleState[];
  effects: readonly ProjectedAssignmentEffect[];
}

function cloneRequirement(requirement: CycleRequirement): CycleRequirement {
  return { ...requirement };
}

function cloneSnapshot(snapshot: ActivityCycleSnapshot): ActivityCycleSnapshot {
  return {
    cycle: { ...snapshot.cycle },
    requirements: snapshot.requirements.map(cloneRequirement),
  };
}

function cycleIsSatisfied(snapshot: ActivityCycleSnapshot): boolean {
  return snapshot.requirements.every((requirement) => requirement.status !== 'pending');
}

function projectedInstant(slot: ScheduleSlot): string {
  return `${slot.date}T00:00:00.000Z`;
}

export function initializeProjectedCycles(
  groups: readonly CampGroup[],
  snapshots: readonly ActivityCycleSnapshot[],
): readonly ProjectedGroupCycleState[] {
  return groups.map((group) => {
    const groupCycles = snapshots
      .filter((snapshot) => snapshot.cycle.groupId === group.id)
      .sort((left, right) => left.cycle.cycleNumber - right.cycle.cycleNumber)
      .map<ProjectedCycleSnapshot>((snapshot) => {
        const cloned = cloneSnapshot(snapshot);
        return {
          snapshot:
            cloned.cycle.status === 'active' && cycleIsSatisfied(cloned)
              ? { ...cloned, cycle: { ...cloned.cycle, status: 'completed' } }
              : cloned,
          origin: 'initial',
        };
      });
    const active = [...groupCycles]
      .reverse()
      .find((cycle) => cycle.snapshot.cycle.status === 'active' && !cycleIsSatisfied(cycle.snapshot));
    return {
      groupId: group.id,
      cycles: groupCycles,
      ...(active ? { currentCycleId: active.snapshot.cycle.id } : {}),
    };
  });
}

function createCycle(
  state: ProjectedGroupCycleState,
  group: CampGroup,
  slot: ScheduleSlot,
  activities: readonly Activity[],
  eligibility: ReadonlySet<string>,
): ProjectedGroupCycleState {
  if (state.currentCycleId !== undefined) return state;

  const requiredActivityIds = activities
    .filter(
      (activity) =>
        activity.active &&
        (activity.countsTowardCycle ?? true) &&
        eligibility.has(`${activity.id}\u0000${group.categoryId}`),
    )
    .map((activity) => activity.id)
    .sort();
  if (requiredActivityIds.length === 0) return state;

  const cycleNumber = Math.max(0, ...state.cycles.map((cycle) => cycle.snapshot.cycle.cycleNumber)) + 1;
  const cycleId: CycleId = `projected-cycle:${group.id}:${cycleNumber}`;
  const projected: ProjectedCycleSnapshot = {
    origin: 'opened_during_generation',
    startedInSlot: { ...slot },
    snapshot: {
      cycle: {
        id: cycleId,
        groupId: group.id,
        cycleNumber,
        status: 'active',
        startedAt: projectedInstant(slot),
      },
      requirements: requiredActivityIds.map((activityId) => ({
        cycleId,
        activityId,
        status: 'pending',
      })),
    },
  };
  return { ...state, cycles: [...state.cycles, projected], currentCycleId: cycleId };
}

export function ensureProjectedCyclesForSlot(
  states: readonly ProjectedGroupCycleState[],
  groups: readonly CampGroup[],
  activities: readonly Activity[],
  activityEligibility: readonly ActivityEligibility[],
  slot: ScheduleSlot,
): readonly ProjectedGroupCycleState[] {
  const groupsById = new Map(groups.map((group) => [group.id, group]));
  const eligibility = new Set(
    activityEligibility.map((entry) => `${entry.activityId}\u0000${entry.groupCategoryId}`),
  );
  return states.map((state) => {
    const group = groupsById.get(state.groupId);
    return group?.active ? createCycle(state, group, slot, activities, eligibility) : state;
  });
}

export function activeCycleSnapshots(
  states: readonly ProjectedGroupCycleState[],
): readonly ActivityCycleSnapshot[] {
  return states.flatMap((state) => {
    const current = state.cycles.find((cycle) => cycle.snapshot.cycle.id === state.currentCycleId);
    return current ? [cloneSnapshot(current.snapshot)] : [];
  });
}

export function applyAssignmentsToProjectedCycles(
  states: readonly ProjectedGroupCycleState[],
  assignments: readonly Assignment[],
  slot: ScheduleSlot,
): ProjectedCycleUpdate {
  const assignmentsByGroup = new Map(assignments.map((assignment) => [assignment.groupId, assignment]));
  const effects: ProjectedAssignmentEffect[] = [];

  const nextStates = states.map((state) => {
    const assignment = assignmentsByGroup.get(state.groupId);
    if (!assignment || !state.currentCycleId) return state;
    const currentIndex = state.cycles.findIndex((cycle) => cycle.snapshot.cycle.id === state.currentCycleId);
    if (currentIndex < 0) return state;

    const current = state.cycles[currentIndex];
    const pendingBefore = current.snapshot.requirements.filter((requirement) => requirement.status === 'pending');
    const belongsToCycle = current.snapshot.requirements.some(
      (requirement) => requirement.activityId === assignment.activityId,
    );
    if (!belongsToCycle) {
      effects.push({
        groupId: assignment.groupId,
        activityId: assignment.activityId,
        prematureRepetition: false,
      });
      return state;
    }
    const matchedPending = pendingBefore.some((requirement) => requirement.activityId === assignment.activityId);
    const requirements = current.snapshot.requirements.map<CycleRequirement>((requirement) =>
      requirement.activityId === assignment.activityId && requirement.status === 'pending'
        ? { ...requirement, status: 'completed' }
        : cloneRequirement(requirement),
    );
    const completed = requirements.every((requirement) => requirement.status !== 'pending');
    const updatedCycle: ProjectedCycleSnapshot = {
      ...current,
      snapshot: {
        cycle: completed
          ? { ...current.snapshot.cycle, status: 'completed', completedAt: projectedInstant(slot) }
          : { ...current.snapshot.cycle },
        requirements,
      },
      ...(completed ? { completedInSlot: { ...slot } } : {}),
    };
    const cycles = state.cycles.map((cycle, index) => (index === currentIndex ? updatedCycle : cycle));
    effects.push({
      groupId: assignment.groupId,
      activityId: assignment.activityId,
      prematureRepetition: pendingBefore.length > 0 && !matchedPending,
      ...(completed ? { completedCycleId: current.snapshot.cycle.id } : {}),
    });
    return completed ? { groupId: state.groupId, cycles } : { ...state, cycles };
  });

  return { states: nextStates, effects };
}
