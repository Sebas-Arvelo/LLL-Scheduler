import type { Activity, GroupCategory, Season, TimeBlock } from './domain';
import { generateSchedule } from './domain';
import {
  buildCampGroups,
  buildActivitySlotView,
  buildScheduleGenerationInput,
  buildScheduleGrid,
  enumerateLocalDates,
  unassignedReasonMessage,
} from './schedule-ui';

const season: Season = {
  id: 'season',
  name: 'Season',
  startDate: '2026-08-01',
  endDate: '2026-08-31',
  active: true,
};
const categories: GroupCategory[] = [{ id: 'sabana', name: 'Sabana', active: true }];
const blocks: TimeBlock[] = [
  { id: 'late', seasonId: season.id, name: 'Tarde', order: 2, active: true },
  { id: 'off', seasonId: season.id, name: 'Inactivo', order: 3, active: false },
  { id: 'early', seasonId: season.id, name: 'Mañana', order: 1, active: true },
];
const activities: Activity[] = [{ id: 'kayak', name: 'Kayak', active: true, maxGroups: 2 }];

describe('schedule UI transformations', () => {
  it('enumerates inclusive civil dates without depending on the browser timezone', () => {
    expect(enumerateLocalDates('2026-08-10', '2026-08-12')).toEqual([
      '2026-08-10',
      '2026-08-11',
      '2026-08-12',
    ]);
    expect(enumerateLocalDates('2026-08-12', '2026-08-10')).toEqual([]);
    expect(enumerateLocalDates('not-a-date', '2026-08-10')).toEqual([]);
  });

  it('builds domain groups with count, activity state and category participant defaults', () => {
    const groups = buildCampGroups(categories, [
      { categoryId: 'sabana', count: 2.9, participantCount: 11, active: true },
    ]);

    expect(groups).toEqual([
      { id: 'sabana-1', name: 'Sabana 1', categoryId: 'sabana', active: true, participantCount: 11 },
      { id: 'sabana-2', name: 'Sabana 2', categoryId: 'sabana', active: true, participantCount: 11 },
    ]);
  });

  it('builds a ScheduleGenerationInput using only active blocks and ID-based eligibility', () => {
    const groups = buildCampGroups(categories, [
      { categoryId: 'sabana', count: 1, participantCount: 10, active: true },
    ]);
    const eligibility = [{ activityId: 'kayak', groupCategoryId: 'sabana' }];
    const input = buildScheduleGenerationInput({
      season,
      startDate: '2026-08-10',
      endDate: '2026-08-11',
      timeBlocks: blocks,
      groups,
      activities,
      groupCategories: categories,
      activityEligibility: eligibility,
      seed: 27,
    });

    expect(input.dates).toEqual(['2026-08-10', '2026-08-11']);
    expect(input.timeBlocks.map((block) => block.id)).toEqual(['late', 'early']);
    expect(input.activityEligibility).toEqual(eligibility);
    expect(input.seed).toBe(27);
    expect(input.history).toEqual([]);
  });

  it('turns real engine assignments and unassigned reasons into matrix cells', () => {
    const groups = buildCampGroups(categories, [
      { categoryId: 'sabana', count: 1, participantCount: 10, active: true },
    ]);
    const input = buildScheduleGenerationInput({
      season,
      startDate: '2026-08-10',
      endDate: '2026-08-10',
      timeBlocks: blocks.slice(0, 1),
      groups,
      activities,
      groupCategories: categories,
      activityEligibility: [],
      seed: 27,
    });
    const result = generateSchedule(input);
    const grid = buildScheduleGrid(result, groups, categories, activities, blocks);

    expect(result.metrics.global.unassignedCells).toBe(1);
    expect(grid.rows[0].cells[0].activityName).toBeUndefined();
    expect(grid.rows[0].cells[0].unassignedReason).toBe(
      'No hay actividades elegibles para la categoría del grupo.',
    );
    expect(unassignedReasonMessage('PARTICIPANT_COUNT_REQUIRED')).toContain('participantes');
  });

  it('groups every assignment from only the selected slot by activity with capacity totals', () => {
    const slotGroups = buildCampGroups(categories, [
      { categoryId: 'sabana', count: 3, participantCount: 10, active: true },
    ]);
    const slotActivities: Activity[] = [
      { id: 'kayak', name: 'Kayak', displayCategory: 'Agua', active: true, maxGroups: 3, maxParticipants: 35 },
    ];
    const input = buildScheduleGenerationInput({
      season,
      startDate: '2026-08-10',
      endDate: '2026-08-10',
      timeBlocks: blocks,
      groups: slotGroups,
      activities: slotActivities,
      groupCategories: categories,
      activityEligibility: slotActivities.map((activity) => ({
        activityId: activity.id,
        groupCategoryId: 'sabana',
      })),
      seed: 31,
    });
    const result = generateSchedule(input);
    const view = buildActivitySlotView(
      result,
      '2026-08-10',
      'early',
      slotGroups,
      categories,
      slotActivities,
      blocks,
    )!;
    const selectedAssignments = result.assignments.filter(
      (assignment) => assignment.date === '2026-08-10' && assignment.timeBlockId === 'early',
    );

    expect(view.activities.flatMap((activity) => activity.groups).length).toBe(selectedAssignments.length);
    expect(view.activities.every((activity) => activity.usedGroups === activity.groups.length)).toBeTrue();
    expect(new Set(view.activities.map((activity) => activity.activityId))).toEqual(
      new Set(selectedAssignments.map((assignment) => assignment.activityId)),
    );
    const kayak = view.activities.find((activity) => activity.activityId === 'kayak')!;
    expect(kayak.maxGroups).toBe(3);
    expect(kayak.maxParticipants).toBe(35);
    expect(kayak.usedParticipants).toBe(30);
  });

  it('includes translated unassigned groups and excludes assignments from other blocks', () => {
    const slotGroups = buildCampGroups(categories, [
      { categoryId: 'sabana', count: 2, participantCount: 10, active: true },
    ]);
    const scarceActivities: Activity[] = [{ id: 'kayak', name: 'Kayak', active: true, maxGroups: 1 }];
    const input = buildScheduleGenerationInput({
      season,
      startDate: '2026-08-10',
      endDate: '2026-08-10',
      timeBlocks: blocks,
      groups: slotGroups,
      activities: scarceActivities,
      groupCategories: categories,
      activityEligibility: [{ activityId: 'kayak', groupCategoryId: 'sabana' }],
      seed: 32,
    });
    const result = generateSchedule(input);
    const view = buildActivitySlotView(
      result,
      '2026-08-10',
      'early',
      slotGroups,
      categories,
      scarceActivities,
      blocks,
    )!;
    const selectedGroupIds = result.assignments
      .filter((assignment) => assignment.timeBlockId === 'early')
      .map((assignment) => assignment.groupId);

    expect(view.activities.flatMap((activity) => activity.groups.map((group) => group.groupId))).toEqual(
      selectedGroupIds,
    );
    expect(view.unassigned.length).toBe(1);
    expect(view.unassigned[0].reasonCode).toBe('CAPACITY_EXHAUSTED');
    expect(view.unassigned[0].reasonMessage).toContain('capacidad');
    expect(buildActivitySlotView(result, '2026-08-11', 'early', slotGroups, categories, scarceActivities, blocks))
      .toBeUndefined();
  });

  it('produces the same operational view model for the same result and slot', () => {
    const slotGroups = buildCampGroups(categories, [
      { categoryId: 'sabana', count: 1, participantCount: 10, active: true },
    ]);
    const input = buildScheduleGenerationInput({
      season,
      startDate: '2026-08-10',
      endDate: '2026-08-10',
      timeBlocks: blocks,
      groups: slotGroups,
      activities,
      groupCategories: categories,
      activityEligibility: [{ activityId: 'kayak', groupCategoryId: 'sabana' }],
      seed: 33,
    });
    const result = generateSchedule(input);

    expect(buildActivitySlotView(result, '2026-08-10', 'early', slotGroups, categories, activities, blocks)).toEqual(
      buildActivitySlotView(result, '2026-08-10', 'early', slotGroups, categories, activities, blocks),
    );
  });
});
