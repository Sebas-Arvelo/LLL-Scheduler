import type { Assignment, AssignmentStatus, CycleRequirementStatus } from '../domain';

export type AssignmentProgressStatus = 'planned' | 'completed' | 'cancelled';

export interface AssignmentProgress {
  id: string;
  userId: string;
  savedScheduleId: string;
  groupId: string;
  activityId: string;
  date: string;
  timeBlockId: string;
  status: AssignmentProgressStatus;
  cycleId?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RealCycleRequirement {
  id: string;
  cycleId: string;
  activityId: string;
  status: CycleRequirementStatus;
}

export interface RealActivityCycle {
  id: string;
  userId: string;
  groupId: string;
  cycleNumber: number;
  status: 'active' | 'completed';
  startedAt: string;
  completedAt?: string;
  requirements: readonly RealCycleRequirement[];
}

export interface RealExecutionState {
  /** Progress rows belonging to the schedule currently open. */
  progress: readonly AssignmentProgress[];
  /** Completed rows for these groups across all saved schedules. */
  history?: readonly AssignmentProgress[];
  cycles: readonly RealActivityCycle[];
}

export interface ProgressSummary {
  planned: number;
  completed: number;
  cancelled: number;
  completedPercentage: number;
}

export interface RealHistoryEntry extends Assignment {
  progressId: string;
  savedScheduleId: string;
  completedAt: string;
}

export function assignmentProgressKey(parts: {
  groupId: string;
  date: string;
  timeBlockId: string;
}): string {
  return `${parts.groupId}\u0000${parts.date}\u0000${parts.timeBlockId}`;
}

export function summarizeProgress(progress: readonly AssignmentProgress[]): ProgressSummary {
  const summary = progress.reduce(
    (current, item) => ({ ...current, [item.status]: current[item.status] + 1 }),
    { planned: 0, completed: 0, cancelled: 0 },
  );
  const total = progress.length;
  return {
    ...summary,
    completedPercentage: total === 0 ? 0 : (summary.completed / total) * 100,
  };
}

/** Only observed completions become input history for a future scheduler run. */
export function deriveRealHistory(progress: readonly AssignmentProgress[]): readonly RealHistoryEntry[] {
  return progress
    .filter((item) => item.status === 'completed' && !!item.completedAt)
    .map((item) => ({
      progressId: item.id,
      savedScheduleId: item.savedScheduleId,
      groupId: item.groupId,
      activityId: item.activityId,
      date: item.date,
      timeBlockId: item.timeBlockId,
      ...(item.cycleId ? { cycleId: item.cycleId } : {}),
      source: 'automatic',
      status: 'completed',
      locked: false,
      completedAt: item.completedAt!,
    }));
}

export function currentRealCycles(cycles: readonly RealActivityCycle[]): readonly RealActivityCycle[] {
  return cycles.filter((cycle) => cycle.status === 'active');
}

export function progressForAssignments(
  assignments: readonly Assignment[],
  progress: readonly AssignmentProgress[],
): readonly { assignment: Assignment; progress?: AssignmentProgress; status: AssignmentProgressStatus }[] {
  const progressByKey = new Map(progress.map((item) => [assignmentProgressKey(item), item]));
  return assignments.map((assignment) => {
    const savedProgress = progressByKey.get(assignmentProgressKey(assignment));
    return {
      assignment,
      ...(savedProgress ? { progress: savedProgress } : {}),
      status: savedProgress?.status ?? 'planned',
    };
  });
}

export function filterExecutionStateForUser(state: RealExecutionState, userId: string): RealExecutionState {
  const progress = state.progress.filter((item) => item.userId === userId);
  const cycleIds = new Set(state.cycles.filter((cycle) => cycle.userId === userId).map((cycle) => cycle.id));
  return {
    progress,
    ...(state.history ? { history: state.history.filter((item) => item.userId === userId) } : {}),
    cycles: state.cycles.filter((cycle) => cycleIds.has(cycle.id)),
  };
}

/**
 * Pure mirror of the database transition rules. It keeps domain behavior testable
 * without Supabase and provides the contract future generation will consume.
 */
export function transitionProgress(
  state: RealExecutionState,
  progressId: string,
  status: AssignmentProgressStatus,
  occurredAt: string,
): RealExecutionState {
  const target = state.progress.find((item) => item.id === progressId);
  if (!target) throw new Error('No existe el progreso indicado.');
  if (target.status === status) return structuredClone(state);

  let cycles = structuredClone(state.cycles) as RealActivityCycle[];
  let cycleId = target.cycleId;

  if (status === 'completed') {
    const cycle = cycles.find((item) => item.groupId === target.groupId && item.status === 'active');
    if (cycle) {
      const requirement = cycle.requirements.find((item) => item.activityId === target.activityId);
      if (requirement) {
        cycleId = cycle.id;
        requirement.status = 'completed';
        if (cycle.requirements.every((item) => item.status === 'completed' || item.status === 'exempted')) {
          cycle.status = 'completed';
          cycle.completedAt = occurredAt;
        }
      }
    }
  } else if (target.status === 'completed' && cycleId) {
    const cycle = cycles.find((item) => item.id === cycleId);
    if (cycle) {
      const hasAnotherCompletion = state.progress.some(
        (item) =>
          item.id !== target.id &&
          item.status === 'completed' &&
          item.cycleId === cycleId &&
          item.activityId === target.activityId,
      );
      const requirement = cycle.requirements.find((item) => item.activityId === target.activityId);
      if (requirement && !hasAnotherCompletion) requirement.status = 'pending';
      if (cycle.status === 'completed' && cycle.requirements.some((item) => item.status === 'pending')) {
        const hasLaterCycle = cycles.some(
          (item) => item.groupId === cycle.groupId && item.cycleNumber > cycle.cycleNumber,
        );
        if (hasLaterCycle) throw new Error('No se puede reabrir un ciclo anterior después de iniciar otro.');
        cycle.status = 'active';
        delete cycle.completedAt;
      }
    }
    cycleId = undefined;
  }

  return {
    progress: state.progress.map((item) => item.id === progressId ? {
      ...item,
      status,
      ...(cycleId ? { cycleId } : { cycleId: undefined }),
      ...(status === 'completed' ? { completedAt: occurredAt } : { completedAt: undefined }),
      updatedAt: occurredAt,
    } : { ...item }),
    cycles,
    ...(state.history ? { history: structuredClone(state.history) } : {}),
  };
}

export function transitionRequirement(
  state: RealExecutionState,
  requirementId: string,
  status: Extract<CycleRequirementStatus, 'pending' | 'exempted'>,
  occurredAt: string,
): RealExecutionState {
  const cycles = structuredClone(state.cycles) as RealActivityCycle[];
  const cycle = cycles.find((item) => item.requirements.some((requirement) => requirement.id === requirementId));
  if (!cycle) throw new Error('No existe el requisito indicado.');
  const requirement = cycle.requirements.find((item) => item.id === requirementId)!;
  if (requirement.status === 'completed') throw new Error('Una actividad completada no puede exonerarse.');
  requirement.status = status;
  const isComplete = cycle.requirements.every((item) => item.status === 'completed' || item.status === 'exempted');
  cycle.status = isComplete ? 'completed' : 'active';
  if (isComplete) cycle.completedAt = occurredAt;
  else delete cycle.completedAt;
  return {
    progress: structuredClone(state.progress),
    cycles,
    ...(state.history ? { history: structuredClone(state.history) } : {}),
  };
}

export function toAssignmentStatus(status: AssignmentProgressStatus): AssignmentStatus {
  return status === 'planned' ? 'confirmed' : status;
}
