import {
  deriveRealHistory,
  filterExecutionStateForUser,
  progressForAssignments,
  summarizeProgress,
  transitionProgress,
  transitionRequirement,
  type AssignmentProgress,
  type RealExecutionState,
} from './real-execution';

const now = '2026-08-15T12:00:00.000Z';

function progress(status: AssignmentProgress['status']): AssignmentProgress {
  return {
    id: 'progress-1', userId: 'user-1', savedScheduleId: 'schedule-1', groupId: 'group-1',
    activityId: 'kayak', date: '2026-08-15', timeBlockId: 'morning', status,
    ...(status === 'completed' ? { completedAt: now, cycleId: 'cycle-1' } : {}),
    createdAt: now, updatedAt: now,
  };
}

function state(requirements: Array<{ id: string; activityId: string; status: 'pending' | 'completed' | 'exempted' }> = [
  { id: 'req-1', activityId: 'kayak', status: 'pending' },
]): RealExecutionState {
  return {
    progress: [progress('planned')],
    cycles: [{
      id: 'cycle-1', userId: 'user-1', groupId: 'group-1', cycleNumber: 1,
      status: 'active', startedAt: now, requirements: requirements.map((item) => ({ ...item, cycleId: 'cycle-1' })),
    }],
  };
}

describe('real assignment history and cycles', () => {
  it('counts only completed progress as real history', () => {
    expect(deriveRealHistory([progress('planned')])).toEqual([]);
    expect(deriveRealHistory([progress('cancelled')])).toEqual([]);
    expect(deriveRealHistory([progress('completed')]).map((item) => item.activityId)).toEqual(['kayak']);
  });

  it('summarizes planned, completed, cancelled and completion percentage', () => {
    const items = [progress('planned'), { ...progress('completed'), id: 'p2' }, { ...progress('cancelled'), id: 'p3' }];
    const summary = summarizeProgress(items);
    expect(summary.planned).toBe(1);
    expect(summary.completed).toBe(1);
    expect(summary.cancelled).toBe(1);
    expect(summary.completedPercentage).toBeCloseTo(100 / 3, 10);
  });

  it('completes a requirement and closes the cycle when all requirements are resolved', () => {
    const transitioned = transitionProgress(state(), 'progress-1', 'completed', now);
    expect(transitioned.cycles[0].requirements[0].status).toBe('completed');
    expect(transitioned.cycles[0].status).toBe('completed');
    expect(transitioned.progress[0].cycleId).toBe('cycle-1');
  });

  it('uses exempted requirements to close a cycle', () => {
    const initial = state([
      { id: 'req-1', activityId: 'kayak', status: 'completed' },
      { id: 'req-2', activityId: 'climbing', status: 'pending' },
    ]);
    const transitioned = transitionRequirement(initial, 'req-2', 'exempted', now);
    expect(transitioned.cycles[0].status).toBe('completed');
  });

  it('restores the requirement and reopens the cycle on completed to planned', () => {
    const completed = transitionProgress(state(), 'progress-1', 'completed', now);
    const reverted = transitionProgress(completed, 'progress-1', 'planned', '2026-08-15T13:00:00.000Z');
    expect(reverted.progress[0].completedAt).toBeUndefined();
    expect(reverted.cycles[0].requirements[0].status).toBe('pending');
    expect(reverted.cycles[0].status).toBe('active');
  });

  it('keeps a requirement completed while another real completion supports it', () => {
    const completed = transitionProgress(state(), 'progress-1', 'completed', now);
    const withAnotherCompletion: RealExecutionState = {
      ...completed,
      progress: [
        ...completed.progress,
        { ...completed.progress[0], id: 'progress-2', date: '2026-08-16' },
      ],
    };
    const reverted = transitionProgress(withAnotherCompletion, 'progress-1', 'planned', '2026-08-15T13:00:00Z');
    expect(reverted.cycles[0].requirements[0].status).toBe('completed');
    expect(reverted.cycles[0].status).toBe('completed');
  });

  it('refuses to reopen an old cycle after a later cycle exists', () => {
    const completed = transitionProgress(state(), 'progress-1', 'completed', now);
    const withLaterCycle: RealExecutionState = {
      ...completed,
      cycles: [
        ...completed.cycles,
        { ...completed.cycles[0], id: 'cycle-2', cycleNumber: 2, status: 'active', completedAt: undefined },
      ],
    };
    expect(() => transitionProgress(withLaterCycle, 'progress-1', 'planned', '2026-08-15T13:00:00Z'))
      .toThrowError(/ciclo anterior/);
  });

  it('does not mix execution state belonging to two users', () => {
    const mixed: RealExecutionState = {
      progress: [progress('planned'), { ...progress('completed'), id: 'other-progress', userId: 'user-2' }],
      cycles: [state().cycles[0], { ...state().cycles[0], id: 'cycle-2', userId: 'user-2' }],
    };
    const filtered = filterExecutionStateForUser(mixed, 'user-1');
    expect(filtered.progress.map((item) => item.id)).toEqual(['progress-1']);
    expect(filtered.cycles.map((item) => item.id)).toEqual(['cycle-1']);
  });

  it('combines the snapshot with progress without duplicating an assignment', () => {
    const assignments = [{ groupId: 'group-1', activityId: 'kayak', date: '2026-08-15', timeBlockId: 'morning', source: 'automatic' as const, status: 'confirmed' as const, locked: false }];
    const merged = progressForAssignments(assignments, [progress('completed'), progress('completed')]);
    expect(merged.length).toBe(1);
    expect(merged[0].status).toBe('completed');
  });
});
