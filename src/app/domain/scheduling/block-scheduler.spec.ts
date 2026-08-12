import type {
  Activity,
  ActivityCycleSnapshot,
  ActivityEligibility,
  Assignment,
  CampGroup,
  GroupCategory,
  SchedulingInput,
  SchedulingResult,
} from '../index';
import { scheduleBlock } from './block-scheduler';

const DATE = '2026-07-01';
const BLOCK = { id: 'block-1', seasonId: 'season-1', name: 'Block 1', order: 1, active: true } as const;
const CATEGORIES: readonly GroupCategory[] = [
  { id: 'alpha', name: 'Alpha', active: true },
  { id: 'beta', name: 'Beta', active: true },
];

function group(id: string, categoryId = 'alpha', participantCount?: number): CampGroup {
  return { id, name: id, categoryId, active: true, ...(participantCount === undefined ? {} : { participantCount }) };
}

function activity(id: string, overrides: Partial<Activity> = {}): Activity {
  return { id, name: id, active: true, maxGroups: 10, ...overrides };
}

function allEligible(groups: readonly CampGroup[], activities: readonly Activity[]): ActivityEligibility[] {
  const categoryIds = [...new Set(groups.map((item) => item.categoryId))];
  return activities.flatMap((item) =>
    categoryIds.map((categoryId) => ({ activityId: item.id, groupCategoryId: categoryId })),
  );
}

function input(options: {
  groups: readonly CampGroup[];
  activities: readonly Activity[];
  eligibility?: readonly ActivityEligibility[];
  cycles?: readonly ActivityCycleSnapshot[];
  history?: readonly Assignment[];
  locked?: readonly Assignment[];
  unavailableActivities?: readonly string[];
  unavailableGroups?: readonly string[];
  seed?: number;
}): SchedulingInput {
  return {
    date: DATE,
    timeBlock: BLOCK,
    groups: options.groups,
    activities: options.activities,
    groupCategories: CATEGORIES,
    activityEligibility: options.eligibility ?? allEligible(options.groups, options.activities),
    cycleSnapshots: options.cycles ?? [],
    history: options.history ?? [],
    lockedAssignments: options.locked ?? [],
    hardConstraints: {
      activityAvailability: (options.unavailableActivities ?? []).map((activityId) => ({
        activityId,
        date: DATE,
        timeBlockId: BLOCK.id,
        available: false,
      })),
      groupUnavailability: (options.unavailableGroups ?? []).map((groupId) => ({
        groupId,
        date: DATE,
        timeBlockId: BLOCK.id,
      })),
    },
    seed: options.seed,
  };
}

function cycle(groupId: string, pending: readonly string[], completed: readonly string[] = []): ActivityCycleSnapshot {
  return {
    cycle: {
      id: `cycle-${groupId}`,
      groupId,
      cycleNumber: 1,
      status: 'active',
      startedAt: '2026-06-01T12:00:00.000Z',
    },
    requirements: [
      ...pending.map((activityId) => ({ cycleId: `cycle-${groupId}`, activityId, status: 'pending' as const })),
      ...completed.map((activityId) => ({ cycleId: `cycle-${groupId}`, activityId, status: 'completed' as const })),
    ],
  };
}

function locked(groupId: string, activityId: string): Assignment {
  return {
    id: `assignment-${groupId}`,
    groupId,
    activityId,
    date: DATE,
    timeBlockId: BLOCK.id,
    source: 'manual',
    status: 'confirmed',
    locked: true,
  };
}

function assignmentMap(result: SchedulingResult): Record<string, string> {
  return Object.fromEntries(result.assignments.map((assignment) => [assignment.groupId, assignment.activityId]));
}

function expectValidResult(result: SchedulingResult, schedulingInput: SchedulingInput): void {
  expect(result.status).toBe('success');
  expect(result.diagnostics.errors).toEqual([]);

  const groupIds = result.assignments.map((assignment) => assignment.groupId);
  expect(new Set(groupIds).size).toBe(groupIds.length);

  const unassignedIds = new Set(result.unassigned.map((item) => item.groupId));
  expect(groupIds.some((groupId) => unassignedIds.has(groupId))).toBeFalse();

  const activitiesById = new Map(schedulingInput.activities.map((item) => [item.id, item]));
  const groupsById = new Map(schedulingInput.groups.map((item) => [item.id, item]));
  const eligibility = new Set(
    schedulingInput.activityEligibility.map((item) => `${item.activityId}\u0000${item.groupCategoryId}`),
  );
  const unavailable = new Set(
    schedulingInput.hardConstraints.activityAvailability
      .filter((item) => item.date === schedulingInput.date && item.timeBlockId === schedulingInput.timeBlock.id && !item.available)
      .map((item) => item.activityId),
  );

  for (const assignment of result.assignments) {
    const assignedActivity = activitiesById.get(assignment.activityId)!;
    const assignedGroup = groupsById.get(assignment.groupId)!;
    expect(assignedActivity.active).toBeTrue();
    expect(assignedGroup.active).toBeTrue();
    expect(unavailable.has(assignment.activityId)).toBeFalse();
    expect(eligibility.has(`${assignment.activityId}\u0000${assignedGroup.categoryId}`)).toBeTrue();
  }

  for (const assignedActivity of schedulingInput.activities) {
    const assignments = result.assignments.filter((item) => item.activityId === assignedActivity.id);
    const availability = schedulingInput.hardConstraints.activityAvailability.find(
      (item) =>
        item.activityId === assignedActivity.id &&
        item.date === schedulingInput.date &&
        item.timeBlockId === schedulingInput.timeBlock.id,
    );
    const maxGroups = availability?.maxGroupsOverride ?? assignedActivity.maxGroups;
    const maxParticipants = availability?.maxParticipantsOverride ?? assignedActivity.maxParticipants;
    expect(assignments.length).toBeLessThanOrEqual(maxGroups);
    if (maxParticipants !== undefined) {
      const participants = assignments.reduce(
        (sum, item) => sum + (groupsById.get(item.groupId)?.participantCount ?? Number.POSITIVE_INFINITY),
        0,
      );
      expect(participants).toBeLessThanOrEqual(maxParticipants);
    }
  }

  for (const lockedAssignment of schedulingInput.lockedAssignments.filter(
    (item) => item.date === schedulingInput.date && item.timeBlockId === schedulingInput.timeBlock.id,
  )) {
    expect(result.assignments).toContain(lockedAssignment);
  }
}

describe('block scheduling engine', () => {
  it('prefers each group pending cycle activity', () => {
    const groups = [group('g1'), group('g2'), group('g3')];
    const activities = [activity('a'), activity('b'), activity('c')];
    const schedulingInput = input({
      groups,
      activities,
      cycles: [cycle('g1', ['a']), cycle('g2', ['b']), cycle('g3', ['c'])],
      seed: 7,
    });
    const result = scheduleBlock(schedulingInput);

    expect(assignmentMap(result)).toEqual({ g1: 'a', g2: 'b', g3: 'c' });
    expectValidResult(result, schedulingInput);
  });

  it('never exceeds maxGroups', () => {
    const schedulingInput = input({ groups: [group('g1'), group('g2')], activities: [activity('a', { maxGroups: 1 })] });
    const result = scheduleBlock(schedulingInput);

    expect(result.assignments.length).toBe(1);
    expect(result.unassigned[0].reasonCode).toBe('CAPACITY_EXHAUSTED');
    expectValidResult(result, schedulingInput);
  });

  it('never exceeds maxParticipants', () => {
    const schedulingInput = input({
      groups: [group('g1', 'alpha', 6), group('g2', 'alpha', 5)],
      activities: [activity('a', { maxGroups: 2, maxParticipants: 10 })],
    });
    const result = scheduleBlock(schedulingInput);

    expect(result.assignments.length).toBe(1);
    expectValidResult(result, schedulingInput);
  });

  it('does not invent participantCount when participant capacity exists', () => {
    const schedulingInput = input({
      groups: [group('g1')],
      activities: [activity('a', { maxParticipants: 10 })],
    });
    const result = scheduleBlock(schedulingInput);

    expect(result.assignments).toEqual([]);
    expect(result.unassigned[0].reasonCode).toBe('PARTICIPANT_COUNT_REQUIRED');
    expect(result.diagnostics.warnings[0].code).toBe('PARTICIPANT_COUNT_REQUIRED');
  });

  it('enforces category eligibility', () => {
    const groups = [group('alpha-group', 'alpha'), group('beta-group', 'beta')];
    const activities = [activity('exclusive')];
    const schedulingInput = input({
      groups,
      activities,
      eligibility: [{ activityId: 'exclusive', groupCategoryId: 'alpha' }],
    });
    const result = scheduleBlock(schedulingInput);

    expect(assignmentMap(result)).toEqual({ 'alpha-group': 'exclusive' });
    expect(result.unassigned[0].reasonCode).toBe('NO_ELIGIBLE_ACTIVITY');
    expectValidResult(result, schedulingInput);
  });

  it('never assigns an inactive activity', () => {
    const schedulingInput = input({
      groups: [group('g1')],
      activities: [activity('inactive', { active: false }), activity('active')],
    });
    const result = scheduleBlock(schedulingInput);

    expect(assignmentMap(result)['g1']).toBe('active');
    expectValidResult(result, schedulingInput);
  });

  it('never assigns an unavailable activity', () => {
    const schedulingInput = input({
      groups: [group('g1')],
      activities: [activity('a')],
      unavailableActivities: ['a'],
    });
    const result = scheduleBlock(schedulingInput);

    expect(result.assignments).toEqual([]);
    expect(result.unassigned[0].reasonCode).toBe('NO_AVAILABLE_ACTIVITY');
    expectValidResult(result, schedulingInput);
  });

  it('returns an unavailable group as unassigned', () => {
    const schedulingInput = input({
      groups: [group('g1')],
      activities: [activity('a')],
      unavailableGroups: ['g1'],
    });
    const result = scheduleBlock(schedulingInput);

    expect(result.assignments).toEqual([]);
    expect(result.unassigned[0].reasonCode).toBe('GROUP_UNAVAILABLE');
    expectValidResult(result, schedulingInput);
  });

  it('counts a locked assignment before allocating remaining capacity', () => {
    const lockedAssignment = locked('g1', 'a');
    const schedulingInput = input({
      groups: [group('g1'), group('g2')],
      activities: [activity('a', { maxGroups: 1 })],
      locked: [lockedAssignment],
    });
    const result = scheduleBlock(schedulingInput);

    expect(result.assignments).toEqual([lockedAssignment]);
    expect(result.unassigned[0].groupId).toBe('g2');
    expectValidResult(result, schedulingInput);
  });

  it('counts locked participants before allocating remaining participant capacity', () => {
    const lockedAssignment = locked('g1', 'a');
    const schedulingInput = input({
      groups: [group('g1', 'alpha', 6), group('g2', 'alpha', 5)],
      activities: [activity('a', { maxGroups: 2, maxParticipants: 10 })],
      locked: [lockedAssignment],
    });
    const result = scheduleBlock(schedulingInput);

    expect(result.assignments).toEqual([lockedAssignment]);
    expect(result.unassigned).toEqual([
      jasmine.objectContaining({ groupId: 'g2', reasonCode: 'CAPACITY_EXHAUSTED' }),
    ]);
    expectValidResult(result, schedulingInput);
  });

  it('returns excess groups as unassigned instead of exceeding capacity', () => {
    const schedulingInput = input({
      groups: [group('g1'), group('g2'), group('g3')],
      activities: [activity('a', { maxGroups: 2 })],
    });
    const result = scheduleBlock(schedulingInput);

    expect(result.assignments.length).toBe(2);
    expect(result.unassigned.length).toBe(1);
    expectValidResult(result, schedulingInput);
  });

  it('is independent of input group order for the same seed', () => {
    const groups = [group('g1'), group('g2'), group('g3')];
    const activities = [activity('a', { maxGroups: 2 })];
    const forward = scheduleBlock(input({ groups, activities, seed: 22 }));
    const reversed = scheduleBlock(input({ groups: [...groups].reverse(), activities, seed: 22 }));

    expect(assignmentMap(reversed)).toEqual(assignmentMap(forward));
    expect(reversed.unassigned.map((item) => item.groupId)).toEqual(forward.unassigned.map((item) => item.groupId));
  });

  it('is reproducible with the same seed', () => {
    const schedulingInput = input({
      groups: [group('g1'), group('g2')],
      activities: [activity('a'), activity('b')],
      seed: 1234,
    });

    expect(scheduleBlock(schedulingInput)).toEqual(scheduleBlock(schedulingInput));
  });

  it('can change equivalent tie-breaks with a different seed', () => {
    const groups = [group('g1'), group('g2')];
    const activities = [activity('a'), activity('b')];
    const results = new Set(
      Array.from({ length: 20 }, (_, seed) => JSON.stringify(assignmentMap(scheduleBlock(input({ groups, activities, seed }))))),
    );

    expect(results.size).toBeGreaterThan(1);
  });

  it('solves a global case where a local greedy choice could leave a group unassigned', () => {
    const groups = [group('flexible', 'alpha'), group('restricted', 'beta')];
    const activities = [activity('x', { maxGroups: 1 }), activity('y', { maxGroups: 1 })];
    const schedulingInput = input({
      groups,
      activities,
      eligibility: [
        { activityId: 'x', groupCategoryId: 'alpha' },
        { activityId: 'y', groupCategoryId: 'alpha' },
        { activityId: 'y', groupCategoryId: 'beta' },
      ],
      seed: 2,
    });
    const result = scheduleBlock(schedulingInput);

    expect(assignmentMap(result)).toEqual({ flexible: 'x', restricted: 'y' });
    expect(result.unassigned).toEqual([]);
    expectValidResult(result, schedulingInput);
  });

  it('prefers a pending activity over a repeated activity when both are feasible', () => {
    const schedulingInput = input({
      groups: [group('g1')],
      activities: [activity('pending'), activity('completed')],
      cycles: [cycle('g1', ['pending'], ['completed'])],
    });
    const result = scheduleBlock(schedulingInput);

    expect(assignmentMap(result)['g1']).toBe('pending');
    expectValidResult(result, schedulingInput);
  });

  it('skips inactive groups and records a warning', () => {
    const inactiveGroup = { ...group('inactive'), active: false };
    const result = scheduleBlock(input({ groups: [inactiveGroup], activities: [activity('a')] }));

    expect(result.assignments).toEqual([]);
    expect(result.unassigned).toEqual([]);
    expect(result.diagnostics.warnings[0].code).toBe('INACTIVE_GROUP_SKIPPED');
    expect(result.diagnostics.metrics?.inactiveGroupCount).toBe(1);
  });

  it('returns a structured error and does not generate around an invalid locked assignment', () => {
    const invalidLocked = locked('g1', 'inactive');
    const result = scheduleBlock(
      input({
        groups: [group('g1'), group('g2')],
        activities: [activity('inactive', { active: false }), activity('active')],
        locked: [invalidLocked],
      }),
    );

    expect(result.status).toBe('invalid_input');
    expect(result.assignments).toEqual([invalidLocked]);
    expect(result.assignments.some((item) => item.groupId === 'g2')).toBeFalse();
    expect(result.diagnostics.errors[0].code).toBe('INVALID_LOCKED_ASSIGNMENT');
  });

  it('returns invalid_input for invalid domain capacity instead of treating it as ordinary exhaustion', () => {
    const result = scheduleBlock(
      input({ groups: [group('g1')], activities: [activity('invalid', { maxGroups: 0 })] }),
    );

    expect(result.status).toBe('invalid_input');
    expect(result.unassigned[0].reasonCode).toBe('INVALID_INPUT');
    expect(result.diagnostics.errors[0].code).toBe('INVALID_SCHEDULING_INPUT');
  });

  it('uses only completed history when balancing activities', () => {
    const base = { groupId: 'g1', date: '2026-06-30', timeBlockId: BLOCK.id, source: 'automatic', locked: false } as const;
    const proposedHistory: Assignment[] = Array.from({ length: 5 }, () => ({
      ...base,
      activityId: 'a',
      status: 'proposed',
    }));
    const withoutCompleted = scheduleBlock(
      input({ groups: [group('g1')], activities: [activity('a'), activity('b')], history: proposedHistory, seed: 8 }),
    );
    const withCompleted = scheduleBlock(
      input({
        groups: [group('g1')],
        activities: [activity('a'), activity('b')],
        history: [...proposedHistory, { ...base, activityId: assignmentMap(withoutCompleted)['g1'], status: 'completed' }],
        seed: 8,
      }),
    );

    expect(assignmentMap(withCompleted)['g1']).not.toBe(assignmentMap(withoutCompleted)['g1']);
  });
});
