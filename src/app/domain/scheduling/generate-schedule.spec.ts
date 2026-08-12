import type {
  Activity,
  ActivityCycleSnapshot,
  ActivityEligibility,
  Assignment,
  CampGroup,
  GroupCategory,
  ScheduleGenerationInput,
  ScheduleGenerationResult,
  Season,
  TimeBlock,
} from '../index';
import { generateSchedule } from './generate-schedule';

const SEASON: Season = {
  id: 'season-1',
  name: 'Season 1',
  startDate: '2026-08-01',
  endDate: '2026-08-31',
  active: true,
};
const CATEGORIES: GroupCategory[] = [
  { id: 'sabana', name: 'Sabana', active: true },
  { id: 'bosque', name: 'Bosque', active: true },
  { id: 'aventura', name: 'Aventura', active: true },
  { id: 'cit', name: 'CIT', active: true },
];

function group(id: string, categoryId = 'sabana', participantCount = 10): CampGroup {
  return { id, name: id, categoryId, active: true, participantCount };
}

function activity(id: string, overrides: Partial<Activity> = {}): Activity {
  return { id, name: id, active: true, maxGroups: 20, ...overrides };
}

function block(id: string, order: number): TimeBlock {
  return { id, seasonId: SEASON.id, name: id, order, active: true };
}

function eligibilityForAll(
  activities: readonly Activity[],
  categories: readonly GroupCategory[] = CATEGORIES,
): ActivityEligibility[] {
  return activities.flatMap((item) =>
    categories.map((category) => ({ activityId: item.id, groupCategoryId: category.id })),
  );
}

function cycle(groupId: string, requiredActivityIds: readonly string[], cycleNumber = 1): ActivityCycleSnapshot {
  const cycleId = `cycle:${groupId}:${cycleNumber}`;
  return {
    cycle: {
      id: cycleId,
      groupId,
      cycleNumber,
      status: 'active',
      startedAt: '2026-07-01T00:00:00.000Z',
    },
    requirements: requiredActivityIds.map((activityId) => ({ cycleId, activityId, status: 'pending' })),
  };
}

function generationInput(options: {
  dates?: readonly string[];
  blocks?: readonly TimeBlock[];
  groups: readonly CampGroup[];
  activities: readonly Activity[];
  eligibility?: readonly ActivityEligibility[];
  cycles?: readonly ActivityCycleSnapshot[];
  locked?: readonly Assignment[];
  unavailableActivities?: readonly { activityId: string; date: string; timeBlockId: string }[];
  unavailableGroups?: readonly { groupId: string; date: string; timeBlockId: string }[];
  seed?: number;
}): ScheduleGenerationInput {
  return {
    season: SEASON,
    dates: options.dates ?? ['2026-08-10'],
    timeBlocks: options.blocks ?? [block('block-1', 1)],
    groups: options.groups,
    activities: options.activities,
    groupCategories: CATEGORIES,
    activityEligibility: options.eligibility ?? eligibilityForAll(options.activities),
    initialCycleSnapshots: options.cycles ?? [],
    history: [],
    lockedAssignments: options.locked ?? [],
    hardConstraints: {
      activityAvailability: (options.unavailableActivities ?? []).map((entry) => ({
        ...entry,
        available: false,
      })),
      groupUnavailability: options.unavailableGroups ?? [],
    },
    seed: options.seed ?? 19,
  };
}

function assignmentsFor(result: ScheduleGenerationResult, groupId: string): string[] {
  return result.assignments.filter((item) => item.groupId === groupId).map((item) => item.activityId);
}

function expectMultiBlockInvariants(result: ScheduleGenerationResult, input: ScheduleGenerationInput): void {
  const groupById = new Map(input.groups.map((item) => [item.id, item]));
  const activityById = new Map(input.activities.map((item) => [item.id, item]));
  const eligible = new Set(input.activityEligibility.map((item) => `${item.activityId}\u0000${item.groupCategoryId}`));
  const assignmentKeys = result.assignments.map((item) => `${item.date}\u0000${item.timeBlockId}\u0000${item.groupId}`);
  expect(new Set(assignmentKeys).size).toBe(assignmentKeys.length);

  for (const blockResult of result.blocks) {
    const slotAssignments = result.assignments.filter(
      (item) => item.date === blockResult.slot.date && item.timeBlockId === blockResult.slot.timeBlockId,
    );
    for (const assignment of slotAssignments) {
      const assignedGroup = groupById.get(assignment.groupId)!;
      const assignedActivity = activityById.get(assignment.activityId)!;
      expect(assignedGroup.active).toBeTrue();
      expect(assignedActivity.active).toBeTrue();
      expect(eligible.has(`${assignment.activityId}\u0000${assignedGroup.categoryId}`)).toBeTrue();
    }
    for (const assignedActivity of input.activities) {
      const used = slotAssignments.filter((item) => item.activityId === assignedActivity.id);
      expect(used.length).toBeLessThanOrEqual(assignedActivity.maxGroups);
      if (assignedActivity.maxParticipants !== undefined) {
        const participants = used.reduce(
          (sum, item) => sum + (groupById.get(item.groupId)?.participantCount ?? Number.POSITIVE_INFINITY),
          0,
        );
        expect(participants).toBeLessThanOrEqual(assignedActivity.maxParticipants);
      }
    }
    const unassignedIds = new Set(blockResult.result.unassigned.map((item) => item.groupId));
    expect(slotAssignments.some((item) => unassignedIds.has(item.groupId))).toBeFalse();
  }

  const sortedSlots = [...result.blocks].sort(
    (left, right) =>
      left.slot.date.localeCompare(right.slot.date) ||
      left.slot.timeBlockOrder - right.slot.timeBlockOrder ||
      left.slot.timeBlockId.localeCompare(right.slot.timeBlockId),
  );
  expect(result.blocks.map((item) => item.slot)).toEqual(sortedSlots.map((item) => item.slot));

  for (const locked of input.lockedAssignments) {
    const inRange = result.blocks.some(
      (item) => item.slot.date === locked.date && item.slot.timeBlockId === locked.timeBlockId,
    );
    if (inRange) expect(result.assignments).toContain(locked);
  }
}

describe('multi-block schedule generation', () => {
  it('generates dates and blocks in chronological order regardless of input order', () => {
    const input = generationInput({
      dates: ['2026-08-11', '2026-08-10'],
      blocks: [block('late', 2), block('early', 1)],
      groups: [group('g1')],
      activities: [activity('a'), activity('b'), activity('c'), activity('d')],
    });
    const result = generateSchedule(input);

    expect(result.blocks.map(({ slot }) => `${slot.date}/${slot.timeBlockId}`)).toEqual([
      '2026-08-10/early',
      '2026-08-10/late',
      '2026-08-11/early',
      '2026-08-11/late',
    ]);
    expectMultiBlockInvariants(result, input);
  });

  it('rotates through two complete cycles without an unnecessary repetition', () => {
    const activities = ['a', 'b', 'c', 'd'].map((id) => activity(id));
    const input = generationInput({
      dates: ['2026-08-10', '2026-08-11'],
      blocks: [block('b1', 1), block('b2', 2), block('b3', 3), block('b4', 4)],
      groups: [group('g1')],
      activities,
      cycles: [cycle('g1', ['a', 'b', 'c', 'd'])],
    });
    const result = generateSchedule(input);
    const sequence = assignmentsFor(result, 'g1');

    expect(new Set(sequence.slice(0, 4)).size).toBe(4);
    expect(new Set(sequence.slice(4, 8)).size).toBe(4);
    expect(result.metrics.byGroup[0].completedCycleCount).toBe(2);
    expect(result.metrics.byGroup[0].prematureRepetitionCount).toBe(0);
    expectMultiBlockInvariants(result, input);
  });

  it('respects category-specific eligibility across every block', () => {
    const groups = [
      group('s', 'sabana'),
      group('b', 'bosque'),
      group('a', 'aventura'),
      group('c', 'cit'),
    ];
    const activities = [activity('all'), activity('cabins'), activity('adventure'), activity('cit-only')];
    const eligibility: ActivityEligibility[] = [
      ...CATEGORIES.map((category) => ({ activityId: 'all', groupCategoryId: category.id })),
      { activityId: 'cabins', groupCategoryId: 'sabana' },
      { activityId: 'cabins', groupCategoryId: 'bosque' },
      { activityId: 'adventure', groupCategoryId: 'aventura' },
      { activityId: 'cit-only', groupCategoryId: 'cit' },
    ];
    const input = generationInput({
      blocks: [block('b1', 1), block('b2', 2), block('b3', 3)],
      groups,
      activities,
      eligibility,
    });
    const result = generateSchedule(input);

    expectMultiBlockInvariants(result, input);
  });

  it('resets activity capacity for each block', () => {
    const input = generationInput({
      blocks: [block('b1', 1), block('b2', 2)],
      groups: [group('g1'), group('g2'), group('g3'), group('g4')],
      activities: [activity('kayak', { maxGroups: 2 })],
    });
    const result = generateSchedule(input);

    expect(result.blocks.map((item) => item.result.assignments.length)).toEqual([2, 2]);
    expect(result.assignments.length).toBe(4);
    expectMultiBlockInvariants(result, input);
  });

  it('reserves a future locked assignment only in its own block and projects it into the cycle', () => {
    const futureLocked: Assignment = {
      id: 'locked-future',
      groupId: 'g1',
      activityId: 'a',
      date: '2026-08-10',
      timeBlockId: 'b2',
      cycleId: 'cycle:g1:1',
      source: 'manual',
      status: 'confirmed',
      locked: true,
    };
    const input = generationInput({
      blocks: [block('b1', 1), block('b2', 2)],
      groups: [group('g1'), group('g2')],
      activities: [activity('a', { maxGroups: 1 })],
      cycles: [cycle('g1', ['a']), cycle('g2', ['a'])],
      locked: [futureLocked],
      unavailableGroups: [{ groupId: 'g1', date: '2026-08-10', timeBlockId: 'b1' }],
    });
    const result = generateSchedule(input);

    expect(result.blocks[0].result.assignments).toEqual([
      jasmine.objectContaining({ groupId: 'g2', activityId: 'a' }),
    ]);
    expect(result.blocks[1].result.assignments).toContain(futureLocked);
    const g1Cycle = result.projectedCycles.find((state) => state.groupId === 'g1')!.cycles[0];
    expect(g1Cycle.snapshot.requirements[0].status).toBe('completed');
    expectMultiBlockInvariants(result, input);
  });

  it('completes cycle 1 and opens cycle 2 with a fresh snapshot for the following block', () => {
    const activities = ['a', 'b', 'c'].map((id) => activity(id));
    const input = generationInput({
      blocks: [block('b1', 1), block('b2', 2), block('b3', 3), block('b4', 4)],
      groups: [group('g1')],
      activities,
      cycles: [cycle('g1', ['a', 'b', 'c'])],
    });
    const result = generateSchedule(input);
    const state = result.projectedCycles[0];

    expect(state.cycles[0].snapshot.cycle.status).toBe('completed');
    expect(state.cycles[1].snapshot.cycle.cycleNumber).toBe(2);
    expect(state.cycles[1].snapshot.requirements.map((item) => item.activityId)).toEqual(['a', 'b', 'c']);
    expect(state.cycles[1].snapshot.requirements.filter((item) => item.status === 'completed').length).toBe(1);
  });

  it('adds a new activity only to the next projected cycle', () => {
    const activities = ['a', 'b', 'c', 'd'].map((id) => activity(id));
    const input = generationInput({
      blocks: [block('b1', 1), block('b2', 2), block('b3', 3), block('b4', 4)],
      groups: [group('g1')],
      activities,
      cycles: [cycle('g1', ['a', 'b', 'c'])],
    });
    const result = generateSchedule(input);
    const cycles = result.projectedCycles[0].cycles;

    expect(cycles[0].snapshot.requirements.map((item) => item.activityId)).toEqual(['a', 'b', 'c']);
    expect(cycles[1].snapshot.requirements.map((item) => item.activityId)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('does not advance a cycle when the group is unassigned', () => {
    const input = generationInput({
      blocks: [block('b1', 1), block('b2', 2)],
      groups: [group('g1')],
      activities: [activity('a')],
      cycles: [cycle('g1', ['a'])],
      unavailableGroups: [{ groupId: 'g1', date: '2026-08-10', timeBlockId: 'b1' }],
    });
    const result = generateSchedule(input);

    expect(result.blocks[0].result.unassigned[0].reasonCode).toBe('GROUP_UNAVAILABLE');
    expect(result.blocks[1].result.assignments[0].activityId).toBe('a');
    expect(result.projectedCycles[0].cycles[0].snapshot.cycle.status).toBe('completed');
  });

  it('records premature repetitions and coverage metrics', () => {
    const input = generationInput({
      blocks: [block('b1', 1)],
      groups: [group('g1')],
      activities: [activity('pending'), activity('repeat')],
      cycles: [cycle('g1', ['pending', 'repeat'])],
      unavailableActivities: [{ activityId: 'pending', date: '2026-08-10', timeBlockId: 'b1' }],
    });
    input.initialCycleSnapshots[0].requirements[1].status = 'completed';
    const result = generateSchedule(input);

    expect(assignmentsFor(result, 'g1')).toEqual(['repeat']);
    expect(result.metrics.global.prematureRepetitionCount).toBe(1);
    expect(result.metrics.global.coveragePercentage).toBe(100);
  });

  it('is deterministic and does not mutate its input', () => {
    const input = generationInput({
      dates: ['2026-08-11', '2026-08-10'],
      blocks: [block('b2', 2), block('b1', 1)],
      groups: [group('g2'), group('g1')],
      activities: [activity('b'), activity('a')],
      seed: 88,
    });
    const before = JSON.stringify(input);

    expect(generateSchedule(input)).toEqual(generateSchedule(input));
    expect(JSON.stringify(input)).toBe(before);
  });

  it('rejects blocks that belong to another season', () => {
    const foreignBlock = { ...block('foreign', 1), seasonId: 'another-season' };
    const result = generateSchedule(
      generationInput({ blocks: [foreignBlock], groups: [group('g1')], activities: [activity('a')] }),
    );

    expect(result.status).toBe('invalid_input');
    expect(result.blocks).toEqual([]);
    expect(result.diagnostics.errors[0].code).toBe('INVALID_SCHEDULING_INPUT');
  });
});
