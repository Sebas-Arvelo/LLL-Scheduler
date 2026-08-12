import type { Activity, GroupCategory, Season, TimeBlock } from './domain';
import { generateSchedule } from './domain';
import {
  buildCampGroups,
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
});
