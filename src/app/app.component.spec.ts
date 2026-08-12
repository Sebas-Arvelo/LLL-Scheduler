import { AppComponent } from './app.component';

describe('AppComponent real scheduling integration', () => {
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
});
