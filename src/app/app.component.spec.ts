import { AppComponent } from './app.component';
import type { CreateScheduleRequest, ScheduleApi, StoredSchedule } from './core/api/schedule-api';

function storedScheduleFor(request: CreateScheduleRequest): StoredSchedule {
  return {
    schedule: {
      id: '6759862c-22a9-474f-8ec8-0e7f68a2c971',
      seasonId: request.seasonId,
      name: request.name,
      rangeStart: request.rangeStart,
      rangeEnd: request.rangeEnd,
      seed: request.seed,
      algorithmVersion: request.algorithmVersion,
      status: 'generated',
      configurationSnapshot: request.configurationSnapshot,
      createdAt: '2026-08-13T12:00:00.000Z',
      updatedAt: '2026-08-13T12:00:00.000Z',
    },
    assignments: request.assignments,
    unassigned: request.unassigned,
  };
}

describe('AppComponent real scheduling integration', () => {
  it('starts without presenting demo data as a generated schedule', () => {
    const component = new AppComponent();

    expect(component.generationResult).toBeUndefined();
    expect(component.scheduleGrid.rows).toEqual([]);
    expect(component.activitySlotView).toBeUndefined();
  });

  it('generates the demo matrix with the multi-block domain engine', () => {
    const component = new AppComponent();

    component.generate();

    expect(component.totalGroups).toBe(36);
    expect(component.generationResult?.diagnostics.engineVersion).toBe('multi-block-projection-v1');
    expect(component.scheduleGrid.rows.length).toBe(36);
    expect(component.scheduleGrid.columns.length).toBe(8);
    expect(component.generationResult?.assignments.length).toBe(288);
    expect(component.generationResult?.metrics.global.unassignedCells).toBe(0);
    expect(component.scheduleGrid.rows.every((row) => row.cells.every((cell) => !!cell.activityName))).toBeTrue();

    const assignments = component.generationResult!.assignments;
    const assignmentKeys = assignments.map(
      (assignment) => `${assignment.groupId}/${assignment.date}/${assignment.timeBlockId}`,
    );
    const categoryByGroup = new Map(component.groups.map((group) => [group.id, group.categoryId]));
    expect(new Set(assignmentKeys).size).toBe(288);
    expect(
      assignments.every((assignment) =>
        component.isEligible(assignment.activityId, categoryByGroup.get(assignment.groupId)!),
      ),
    ).toBeTrue();
  });

  it('edits eligibility as an ID relation instead of storing category names in Activity', () => {
    const component = new AppComponent();

    component.setEligibility('caballos', 'cit', false);
    expect(component.isEligible('caballos', 'cit')).toBeFalse();
    expect(component.activities.find((activity) => activity.id === 'caballos')).not.toEqual(
      jasmine.objectContaining({ categoryIds: jasmine.anything() }),
    );

    component.setEligibility('caballos', 'cit', true);
    expect(component.isEligible('caballos', 'cit')).toBeTrue();
  });

  it('explains missing participant counts before using participant capacities', () => {
    const component = new AppComponent();
    component.activities[0].maxParticipants = 20;
    component.groupConfigurations[0].participantCount = undefined;

    component.generate();

    expect(component.uiErrors).toContain(
      'Indica participantes por grupo para usar actividades con máximo de participantes.',
    );
    expect(component.generationResult).toBeUndefined();
  });

  it('marks an existing schedule as stale after configuration changes until regeneration', () => {
    const component = new AppComponent();
    component.generate();
    const generatedResult = component.generationResult;

    component.setEligibility('caballos', 'cit', false);

    expect(component.scheduleStale).toBeTrue();
    expect(component.generationResult).toBe(generatedResult);

    component.generate();
    expect(component.scheduleStale).toBeFalse();
  });

  it('navigates operational slots without mixing their assignments', () => {
    const component = new AppComponent();
    component.generate();
    const firstView = component.activitySlotView!;

    component.selectActivityBlock('block-2');
    const secondView = component.activitySlotView!;
    const secondSlotGroupIds = secondView.activities.flatMap((activity) =>
      activity.groups.map((group) => group.groupId),
    );

    expect(firstView.timeBlockId).toBe('block-1');
    expect(secondView.timeBlockId).toBe('block-2');
    expect(secondSlotGroupIds.length).toBe(36);
    expect(new Set(secondSlotGroupIds).size).toBe(36);
    expect(
      component.generationResult!.assignments
        .filter(
          (assignment) =>
            assignment.date === secondView.date && assignment.timeBlockId === secondView.timeBlockId,
        )
        .length,
    ).toBe(36);
  });

  it('saves the generated plan as planned assignments with its exact configuration snapshot', async () => {
    const component = new AppComponent();
    let capturedRequest: CreateScheduleRequest | undefined;
    component.scheduleApi = {
      saveSchedule: async (request) => {
        capturedRequest = request;
        return storedScheduleFor(request);
      },
      getSchedule: async () => { throw new Error('Not used by this test.'); },
      getSeasonConfiguration: async () => { throw new Error('Not used by this test.'); },
    } satisfies ScheduleApi;

    component.generate();
    await component.saveSchedule();

    expect(component.saveState).toBe('saved');
    expect(component.savedScheduleId).toBe('6759862c-22a9-474f-8ec8-0e7f68a2c971');
    expect(capturedRequest?.assignments.length).toBe(288);
    expect(capturedRequest?.assignments.every((assignment) => assignment.status === 'planned')).toBeTrue();
    expect(capturedRequest?.configurationSnapshot.groups.length).toBe(36);
    expect(capturedRequest?.configurationSnapshot.eligibility).toEqual(component.generatedEligibility);
    expect(capturedRequest).not.toEqual(jasmine.objectContaining({ projectedCycles: jasmine.anything() }));
  });

  it('does not save a stale generation', async () => {
    const component = new AppComponent();
    const saveSchedule = jasmine.createSpy('saveSchedule');
    component.scheduleApi = {
      saveSchedule,
      getSchedule: async () => { throw new Error('Not used by this test.'); },
      getSeasonConfiguration: async () => { throw new Error('Not used by this test.'); },
    } as ScheduleApi;

    component.generate();
    component.markScheduleStale();
    await component.saveSchedule();

    expect(saveSchedule).not.toHaveBeenCalled();
    expect(component.saveState).toBe('idle');
  });

  it('rejects seeds that the persistence contract cannot store', () => {
    const component = new AppComponent();
    component.seed = -1;

    component.generate();

    expect(component.generationResult).toBeUndefined();
    expect(component.uiErrors).toContain('La semilla debe ser un entero entre 0 y 4294967295.');
  });
});
