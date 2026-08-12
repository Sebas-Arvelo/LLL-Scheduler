import { AppComponent } from './app.component';

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
});
