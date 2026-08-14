import { AppComponent } from '../../app.component';
import { buildSavedScheduleData, restoreSavedSchedule } from './saved-schedule';
import { sortSavedSchedules, type SavedScheduleSummary } from './saved-schedule.service';

describe('Supabase saved schedule mapping', () => {
  it('stores the generated plan needed by both views without projected cycles', () => {
    const component = new AppComponent();
    component.generate();

    const data = buildSavedScheduleData({
      season: component.generatedSeason!,
      categories: component.generatedCategories,
      groups: component.generatedGroups,
      activities: component.generatedActivities,
      eligibility: component.generatedEligibility,
      timeBlocks: component.generatedTimeBlocks,
      result: component.generationResult!,
    });

    expect(data.schemaVersion).toBe(1);
    expect(data.result.assignments.length).toBe(288);
    expect(data.result.metrics.global.successfulAssignments).toBe(288);
    expect(data.result.blocks.length).toBe(8);
    expect(data.result).not.toEqual(jasmine.objectContaining({ projectedCycles: jasmine.anything() }));
  });

  it('restores an exact visualizable result without running the scheduler again', () => {
    const component = new AppComponent();
    component.generate();
    const original = component.generationResult!;
    const data = buildSavedScheduleData({
      season: component.generatedSeason!,
      categories: component.generatedCategories,
      groups: component.generatedGroups,
      activities: component.generatedActivities,
      eligibility: component.generatedEligibility,
      timeBlocks: component.generatedTimeBlocks,
      result: original,
    });

    const restored = restoreSavedSchedule(data);

    expect(restored.result.assignments).toEqual(original.assignments);
    expect(restored.result.unassigned).toEqual(original.unassigned);
    expect(restored.result.blocks).toEqual(original.blocks);
    expect(restored.result.metrics).toEqual(original.metrics);
    expect(restored.result.projectedCycles).toEqual([]);
  });

  it('orders saved schedules by created_at descending without mutating the source list', () => {
    const source: SavedScheduleSummary[] = [
      { id: 'old', userId: 'user-1', name: 'Anterior', createdAt: '2026-08-01T10:00:00Z', updatedAt: '2026-08-01T10:00:00Z' },
      { id: 'new', userId: 'user-1', name: 'Reciente', createdAt: '2026-08-03T10:00:00Z', updatedAt: '2026-08-03T10:00:00Z' },
    ];

    expect(sortSavedSchedules(source).map((schedule) => schedule.id)).toEqual(['new', 'old']);
    expect(source.map((schedule) => schedule.id)).toEqual(['old', 'new']);
  });
});
