import { AppComponent } from './app.component';
import type { ScheduleGenerationResult } from './domain';
import type { AuthGateway } from './core/supabase/auth.service';
import { buildSavedScheduleData, type SavedScheduleData } from './core/supabase/saved-schedule';
import type {
  SaveScheduleCommand,
  SavedScheduleGateway,
  SavedScheduleRecord,
} from './core/supabase/saved-schedule.service';

function storedScheduleFor(request: SaveScheduleCommand): SavedScheduleRecord {
  return {
    id: '6759862c-22a9-474f-8ec8-0e7f68a2c971',
    userId: request.userId,
    name: request.name,
    seasonName: request.seasonName,
    rangeStart: request.rangeStart,
    rangeEnd: request.rangeEnd,
    seed: request.seed,
    algorithmVersion: request.algorithmVersion,
    scheduleData: request.scheduleData,
    createdAt: '2026-08-13T12:00:00.000Z',
    updatedAt: '2026-08-13T12:00:00.000Z',
  };
}

function savedScheduleGateway(save: (request: SaveScheduleCommand) => Promise<SavedScheduleRecord>): SavedScheduleGateway {
  return {
    save,
    list: async () => [],
    get: async () => { throw new Error('Not used by this test.'); },
    delete: async () => undefined,
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
    let capturedRequest: SaveScheduleCommand | undefined;
    component.currentUser = { id: 'user-1', email: 'camp@example.com' };
    component.savedScheduleService = savedScheduleGateway(async (request) => {
        capturedRequest = request;
        return storedScheduleFor(request);
    });

    component.generate();
    await component.saveSchedule();

    expect(component.saveState).toBe('saved');
    expect(component.savedScheduleId).toBe('6759862c-22a9-474f-8ec8-0e7f68a2c971');
    expect(capturedRequest?.userId).toBe('user-1');
    expect(capturedRequest?.scheduleData.result.assignments.length).toBe(288);
    expect(capturedRequest?.scheduleData.configuration.groups.length).toBe(36);
    expect(capturedRequest?.scheduleData.configuration.eligibility).toEqual(component.generatedEligibility);
    expect((capturedRequest?.scheduleData.result as SavedScheduleData['result'] & { projectedCycles?: unknown }).projectedCycles).toBeUndefined();
  });

  it('does not save a stale generation', async () => {
    const component = new AppComponent();
    const save = jasmine.createSpy('save');
    component.currentUser = { id: 'user-1' };
    component.savedScheduleService = savedScheduleGateway(save);

    component.generate();
    component.markScheduleStale();
    await component.saveSchedule();

    expect(save).not.toHaveBeenCalled();
    expect(component.saveState).toBe('idle');
  });

  it('does not allow an unauthenticated user to save', async () => {
    const component = new AppComponent();
    const save = jasmine.createSpy('save');
    component.savedScheduleService = savedScheduleGateway(save);
    component.generate();

    await component.saveSchedule();

    expect(save).not.toHaveBeenCalled();
    expect(component.saveState).toBe('error');
    expect(component.saveMessage).toContain('Inicia sesión');
  });

  it('rejects seeds that the persistence contract cannot store', () => {
    const component = new AppComponent();
    component.seed = -1;

    component.generate();

    expect(component.generationResult).toBeUndefined();
    expect(component.uiErrors).toContain('La semilla debe ser un entero entre 0 y 4294967295.');
  });

  it('recovers an existing Supabase session and lists only with that user ID', async () => {
    const component = new AppComponent();
    let listedUserId = '';
    component.authService = {
      initialize: async () => ({ id: 'user-session', email: 'session@example.com' }),
      onAuthStateChange: () => () => undefined,
      signIn: async () => { throw new Error('Not used by this test.'); },
      signUp: async () => ({ confirmationRequired: true }),
      signOut: async () => undefined,
    } satisfies AuthGateway;
    component.savedScheduleService = {
      ...savedScheduleGateway(async (command) => storedScheduleFor(command)),
      list: async (userId) => { listedUserId = userId; return []; },
    };

    component.ngOnInit();
    await new Promise((resolve) => setTimeout(resolve));

    expect(component.authLoading).toBeFalse();
    expect(component.currentUser?.id).toBe('user-session');
    expect(listedUserId).toBe('user-session');
  });

  it('opens a saved schedule from its snapshot and rebuilds both views', async () => {
    const component = new AppComponent();
    component.currentUser = { id: 'user-1' };
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
    const stored: SavedScheduleRecord = {
      id: 'saved-1',
      userId: 'user-1',
      name: 'Plan guardado',
      seasonName: component.season.name,
      rangeStart: component.startDate,
      rangeEnd: component.endDate,
      seed: component.seed,
      algorithmVersion: component.generationResult!.diagnostics.engineVersion,
      scheduleData: data,
      createdAt: '2026-08-13T12:00:00Z',
      updatedAt: '2026-08-13T12:00:00Z',
    };
    component.generationResult = undefined;
    component.scheduleGrid = { columns: [], rows: [] };
    component.savedScheduleService = {
      ...savedScheduleGateway(async (command) => storedScheduleFor(command)),
      get: async (_id, userId) => {
        expect(userId).toBe('user-1');
        return stored;
      },
    };

    await component.openSavedSchedule('saved-1');

    const reopenedResult = component.generationResult as ScheduleGenerationResult | undefined;
    expect(reopenedResult?.assignments.length).toBe(288);
    expect(reopenedResult?.projectedCycles).toEqual([]);
    expect(component.scheduleGrid.rows.length).toBe(36);
    expect(component.activitySlotView?.activities.length).toBeGreaterThan(0);
    expect(component.scheduleName).toBe('Plan guardado');
  });
});
