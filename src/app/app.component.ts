import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { DEMO_ACTIVITIES } from './activity-catalog';
import {
  type Activity,
  type ActivityEligibility,
  type GroupCategory,
  type ProjectedCycleSnapshot,
  type ScheduleGenerationResult,
  type SchedulingDiagnosticCode,
  type Season,
  type TimeBlock,
  generateSchedule,
} from './domain';
import {
  DEMO_ACTIVITY_ELIGIBILITY,
  DEMO_GROUP_CATEGORIES,
  DEMO_SEASON,
  DEMO_TIME_BLOCKS,
} from './demo-fixtures';
import {
  buildCampGroups,
  buildScheduleGenerationInput,
  buildScheduleGrid,
  enumerateLocalDates,
  type GroupCategoryConfiguration,
  type ScheduleGridRow,
  type ScheduleGridView,
} from './schedule-ui';

interface ProjectedCycleView {
  groupName: string;
  cycleNumber: number;
  status: string;
  pending: readonly string[];
  completed: readonly string[];
}

const DIAGNOSTIC_MESSAGES: Readonly<Record<SchedulingDiagnosticCode, string>> = {
  INACTIVE_GROUP_SKIPPED: 'Se omitió un grupo inactivo.',
  INVALID_SCHEDULING_INPUT: 'La configuración general contiene fechas, bloques o referencias inválidas.',
  LOCKED_ASSIGNMENT_OUTSIDE_TARGET: 'Existe una asignación bloqueada fuera del bloque procesado.',
  LOCKED_ASSIGNMENT_OUTSIDE_GENERATION: 'Existe una asignación bloqueada fuera del rango generado.',
  INVALID_LOCKED_ASSIGNMENT: 'Una asignación bloqueada no cumple las restricciones actuales.',
  DUPLICATE_AVAILABILITY: 'Hay reglas de disponibilidad duplicadas.',
  PARTICIPANT_COUNT_REQUIRED: 'Falta participantCount para aplicar una capacidad máxima de participantes.',
};

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class AppComponent implements OnInit {
  season: Season = { ...DEMO_SEASON };
  groupCategories: GroupCategory[] = DEMO_GROUP_CATEGORIES.map((category) => ({ ...category }));
  groupConfigurations: GroupCategoryConfiguration[] = DEMO_GROUP_CATEGORIES.map((category) => ({
    categoryId: category.id,
    count: category.id === 'sabana' || category.id === 'bosque' ? 12 : 6,
    participantCount: 10,
    active: true,
  }));
  activities: Activity[] = DEMO_ACTIVITIES.map((activity) => ({ ...activity }));
  activityEligibility: ActivityEligibility[] = DEMO_ACTIVITY_ELIGIBILITY.map((entry) => ({ ...entry }));
  timeBlocks: TimeBlock[] = DEMO_TIME_BLOCKS.map((block) => ({ ...block }));

  startDate = '2026-08-10';
  endDate = '2026-08-11';
  seed = 2026;
  activitySearch = '';
  showProjectedCycles = false;
  generationResult?: ScheduleGenerationResult;
  scheduleGrid: ScheduleGridView = { columns: [], rows: [] };
  uiErrors: string[] = [];

  ngOnInit(): void {
    this.generate();
  }

  get groups() {
    return buildCampGroups(this.groupCategories, this.groupConfigurations);
  }

  get totalGroups(): number {
    return this.groups.length;
  }

  get activeGroupCount(): number {
    return this.groups.filter((group) => group.active).length;
  }

  get activeActivities(): number {
    return this.activities.filter((activity) => activity.active).length;
  }

  get filteredActivities(): readonly Activity[] {
    const search = this.activitySearch.trim().toLocaleLowerCase();
    return this.activities.filter(
      (activity) =>
        search.length === 0 ||
        activity.name.toLocaleLowerCase().includes(search) ||
        (activity.displayCategory ?? '').toLocaleLowerCase().includes(search),
    );
  }

  get activeBlocks(): number {
    return this.timeBlocks.filter((block) => block.active).length;
  }

  get requestedDays(): number {
    return enumerateLocalDates(this.startDate, this.endDate).length;
  }

  get completedProjectedCycles(): number {
    return this.generationResult?.metrics.byGroup.reduce((sum, group) => sum + group.completedCycleCount, 0) ?? 0;
  }

  get diagnosticMessages(): readonly { kind: 'error' | 'warning'; text: string }[] {
    if (!this.generationResult) return [];
    const messages = [
      ...this.generationResult.diagnostics.errors.map((issue) => ({
        kind: 'error' as const,
        text: DIAGNOSTIC_MESSAGES[issue.code],
      })),
      ...this.generationResult.diagnostics.warnings.map((issue) => ({
        kind: 'warning' as const,
        text: DIAGNOSTIC_MESSAGES[issue.code],
      })),
    ];
    return messages.filter(
      (message, index) => messages.findIndex((candidate) => candidate.kind === message.kind && candidate.text === message.text) === index,
    );
  }

  get projectedCycles(): readonly ProjectedCycleView[] {
    if (!this.generationResult) return [];
    const groupById = new Map(this.groups.map((group) => [group.id, group]));
    const activityById = new Map(this.activities.map((activity) => [activity.id, activity]));
    return this.generationResult.projectedCycles.map((state) => {
      const selected =
        state.cycles.find((cycle) => cycle.snapshot.cycle.id === state.currentCycleId) ?? state.cycles.at(-1);
      return this.toProjectedCycleView(
        groupById.get(state.groupId)?.name ?? state.groupId,
        selected,
        activityById,
      );
    });
  }

  configurationFor(categoryId: string): GroupCategoryConfiguration {
    return this.groupConfigurations.find((configuration) => configuration.categoryId === categoryId)!;
  }

  rowsForCategory(categoryId: string): readonly ScheduleGridRow[] {
    return this.scheduleGrid.rows.filter((row) => row.group.categoryId === categoryId);
  }

  isEligible(activityId: string, categoryId: string): boolean {
    return this.activityEligibility.some(
      (entry) => entry.activityId === activityId && entry.groupCategoryId === categoryId,
    );
  }

  setEligibility(activityId: string, categoryId: string, eligible: boolean): void {
    const matches = (entry: ActivityEligibility) =>
      entry.activityId === activityId && entry.groupCategoryId === categoryId;
    if (eligible && !this.activityEligibility.some(matches)) {
      this.activityEligibility = [...this.activityEligibility, { activityId, groupCategoryId: categoryId }];
    } else if (!eligible) {
      this.activityEligibility = this.activityEligibility.filter((entry) => !matches(entry));
    }
  }

  setMaxParticipants(activity: Activity, value: number | null): void {
    const normalized = Number(value);
    if (Number.isInteger(normalized) && normalized > 0) activity.maxParticipants = normalized;
    else delete activity.maxParticipants;
  }

  generate(): void {
    this.uiErrors = this.validateUiConfiguration();
    if (this.uiErrors.length > 0) {
      this.generationResult = undefined;
      this.scheduleGrid = { columns: [], rows: [] };
      return;
    }

    const groups = this.groups;
    const input = buildScheduleGenerationInput({
      season: this.season,
      startDate: this.startDate,
      endDate: this.endDate,
      timeBlocks: this.timeBlocks,
      groups,
      activities: this.activities,
      groupCategories: this.groupCategories,
      activityEligibility: this.activityEligibility,
      seed: this.seed,
    });
    this.generationResult = generateSchedule(input);
    this.scheduleGrid = buildScheduleGrid(
      this.generationResult,
      groups,
      this.groupCategories,
      this.activities,
      this.timeBlocks,
    );
  }

  trackById(_: number, item: { id: string }): string {
    return item.id;
  }

  trackByKey(_: number, item: { key: string }): string {
    return item.key;
  }

  trackByGridRow(_: number, row: ScheduleGridRow): string {
    return row.group.id;
  }

  private validateUiConfiguration(): string[] {
    const errors: string[] = [];
    const dates = enumerateLocalDates(this.startDate, this.endDate);
    if (dates.length === 0) errors.push('Selecciona un rango de fechas válido.');
    if (dates.some((date) => date < this.season.startDate || date > this.season.endDate)) {
      errors.push('El rango debe estar completamente dentro de la temporada.');
    }
    if (this.activeBlocks === 0) errors.push('Activa al menos un bloque.');
    if (this.activeGroupCount === 0) errors.push('Configura al menos un grupo activo.');
    if (this.activeActivities === 0) errors.push('Activa al menos una actividad.');
    const activeBlocks = this.timeBlocks.filter((block) => block.active);
    if (activeBlocks.some((block) => !block.name.trim() || !Number.isInteger(block.order) || block.order < 0)) {
      errors.push('Cada bloque activo necesita nombre y un orden entero válido.');
    }
    if (new Set(activeBlocks.map((block) => block.order)).size !== activeBlocks.length) {
      errors.push('Los bloques activos no pueden compartir el mismo orden.');
    }
    const activeActivities = this.activities.filter((activity) => activity.active);
    if (
      activeActivities.some(
        (activity) =>
          !activity.name.trim() ||
          !Number.isInteger(activity.maxGroups) ||
          activity.maxGroups < 1 ||
          (activity.maxParticipants !== undefined &&
            (!Number.isInteger(activity.maxParticipants) || activity.maxParticipants < 1)),
      )
    ) {
      errors.push('Las actividades activas necesitan nombre y capacidades enteras mayores que cero.');
    }
    if (
      activeActivities.some((activity) => activity.maxParticipants !== undefined) &&
      this.groupConfigurations.some(
        (configuration) =>
          configuration.active &&
          configuration.count > 0 &&
          (!Number.isInteger(Number(configuration.participantCount)) || Number(configuration.participantCount) < 1),
      )
    ) {
      errors.push('Indica participantes por grupo para usar actividades con máximo de participantes.');
    }
    return errors;
  }

  private toProjectedCycleView(
    groupName: string,
    cycle: ProjectedCycleSnapshot | undefined,
    activityById: ReadonlyMap<string, Activity>,
  ): ProjectedCycleView {
    if (!cycle) return { groupName, cycleNumber: 0, status: 'Sin ciclo', pending: [], completed: [] };
    const activityName = (activityId: string) => activityById.get(activityId)?.name ?? activityId;
    return {
      groupName,
      cycleNumber: cycle.snapshot.cycle.cycleNumber,
      status: cycle.snapshot.cycle.status === 'completed' ? 'Completado' : 'Activo',
      pending: cycle.snapshot.requirements
        .filter((requirement) => requirement.status === 'pending')
        .map((requirement) => activityName(requirement.activityId)),
      completed: cycle.snapshot.requirements
        .filter((requirement) => requirement.status === 'completed')
        .map((requirement) => activityName(requirement.activityId)),
    };
  }
}
