import { CommonModule } from '@angular/common';
import { Component, type OnDestroy, type OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { DEMO_ACTIVITIES } from './activity-catalog';
import {
  type Activity,
  type ActivityEligibility,
  type CampGroup,
  type GroupCategory,
  type LocalDate,
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
  buildActivitySlotView,
  buildCampGroups,
  buildScheduleGenerationInput,
  buildScheduleGrid,
  enumerateLocalDates,
  type ActivitySlotView,
  type GroupCategoryConfiguration,
  type ScheduleGridRow,
  type ScheduleGridCell,
  type ScheduleGridView,
} from './schedule-ui';
import { AuthService, type AuthenticatedUser, type AuthGateway } from './core/supabase/auth.service';
import { buildSavedScheduleData, restoreSavedSchedule } from './core/supabase/saved-schedule';
import {
  SavedScheduleService,
  type SavedScheduleGateway,
  type SavedScheduleSummary,
} from './core/supabase/saved-schedule.service';
import {
  AssignmentProgressService,
  type AssignmentProgressGateway,
} from './core/supabase/assignment-progress.service';
import {
  assignmentProgressKey,
  currentRealCycles,
  deriveRealHistory,
  summarizeProgress,
  type AssignmentProgress,
  type AssignmentProgressStatus,
  type RealActivityCycle,
  type RealExecutionState,
} from './execution/real-execution';

interface ProjectedCycleView {
  groupName: string;
  cycleNumber: number;
  status: string;
  pending: readonly string[];
  completed: readonly string[];
}

interface RealCycleView {
  groupId: string;
  groupName: string;
  currentCycle?: RealActivityCycle;
  completedCycleCount: number;
  completedActivities: readonly string[];
  pending: readonly { id: string; name: string }[];
  exempted: readonly { id: string; name: string }[];
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
export class AppComponent implements OnInit, OnDestroy {
  authService: AuthGateway = new AuthService();
  savedScheduleService: SavedScheduleGateway = new SavedScheduleService();
  assignmentProgressService: AssignmentProgressGateway = new AssignmentProgressService();
  authLoading = true;
  authBusy = false;
  authMode: 'signIn' | 'signUp' = 'signIn';
  authEmail = '';
  authPassword = '';
  authMessage = '';
  currentUser?: AuthenticatedUser;
  savedSchedules: readonly SavedScheduleSummary[] = [];
  savedSchedulesLoading = false;
  savedSchedulesMessage = '';
  scheduleName = '';
  private unsubscribeAuth?: () => void;
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
  viewMode: 'groups' | 'activities' = 'groups';
  scheduleStale = false;
  selectedActivityDate = '';
  selectedActivityBlockId = '';
  generationResult?: ScheduleGenerationResult;
  scheduleGrid: ScheduleGridView = { columns: [], rows: [] };
  activitySlotView?: ActivitySlotView;
  generatedGroups: readonly CampGroup[] = [];
  generatedActivities: readonly Activity[] = [];
  generatedCategories: readonly GroupCategory[] = [];
  generatedTimeBlocks: readonly TimeBlock[] = [];
  generatedSeason?: Season;
  generatedEligibility: readonly ActivityEligibility[] = [];
  saveState: 'idle' | 'saving' | 'saved' | 'error' = 'idle';
  saveMessage = '';
  savedScheduleId?: string;
  executionState: RealExecutionState = { progress: [], cycles: [] };
  executionStateStatus: 'idle' | 'loading' | 'updating' | 'updated' | 'error' = 'idle';
  executionMessage = '';
  updatingProgressId?: string;
  uiErrors: string[] = [];

  ngOnInit(): void {
    void this.initializeSession();
  }

  ngOnDestroy(): void {
    this.unsubscribeAuth?.();
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
    const groupById = new Map(this.generatedGroups.map((group) => [group.id, group]));
    const activityById = new Map(this.generatedActivities.map((activity) => [activity.id, activity]));
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

  get progressSummary() {
    return summarizeProgress(this.executionState.progress);
  }

  get realHistory() {
    return deriveRealHistory(this.executionState.history ?? this.executionState.progress);
  }

  get currentRealCycles(): readonly RealActivityCycle[] {
    return currentRealCycles(this.executionState.cycles);
  }

  get realCycleViews(): readonly RealCycleView[] {
    const activityById = new Map(this.generatedActivities.map((activity) => [activity.id, activity.name]));
    const historyByGroup = new Map<string, Set<string>>();
    for (const entry of this.realHistory) {
      const names = historyByGroup.get(entry.groupId) ?? new Set<string>();
      names.add(activityById.get(entry.activityId) ?? entry.activityId);
      historyByGroup.set(entry.groupId, names);
    }
    return this.generatedGroups.map((group) => {
      const groupCycles = this.executionState.cycles.filter((cycle) => cycle.groupId === group.id);
      const selected = groupCycles.find((cycle) => cycle.status === 'active') ?? groupCycles.at(-1);
      return {
        groupId: group.id,
        groupName: group.name,
        ...(selected ? { currentCycle: selected } : {}),
        completedCycleCount: groupCycles.filter((cycle) => cycle.status === 'completed').length,
        completedActivities: [...(historyByGroup.get(group.id) ?? [])].sort(),
        pending: selected?.requirements.filter((item) => item.status === 'pending')
          .map((item) => ({ id: item.id, name: activityById.get(item.activityId) ?? item.activityId })) ?? [],
        exempted: selected?.requirements.filter((item) => item.status === 'exempted')
          .map((item) => ({ id: item.id, name: activityById.get(item.activityId) ?? item.activityId })) ?? [],
      };
    });
  }

  get availableActivityDates(): readonly LocalDate[] {
    return [...new Set(this.generationResult?.blocks.map((block) => block.slot.date) ?? [])].sort();
  }

  get availableActivityBlocks(): readonly TimeBlock[] {
    const blockIds = new Set(
      this.generationResult?.blocks
        .filter((block) => block.slot.date === this.selectedActivityDate)
        .map((block) => block.slot.timeBlockId) ?? [],
    );
    return this.generatedTimeBlocks
      .filter((block) => blockIds.has(block.id))
      .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
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
    this.markScheduleStale();
  }

  setMaxParticipants(activity: Activity, value: number | null): void {
    const normalized = Number(value);
    if (Number.isInteger(normalized) && normalized > 0) activity.maxParticipants = normalized;
    else delete activity.maxParticipants;
    this.markScheduleStale();
  }

  markScheduleStale(): void {
    if (this.generationResult) {
      this.scheduleStale = true;
      if (this.saveState !== 'saving') {
        this.saveState = 'idle';
        this.saveMessage = '';
        this.savedScheduleId = undefined;
      }
    }
  }

  setViewMode(mode: 'groups' | 'activities'): void {
    this.viewMode = mode;
  }

  selectActivityDate(date: LocalDate): void {
    this.selectedActivityDate = date;
    this.selectedActivityBlockId = this.availableActivityBlocks[0]?.id ?? '';
    this.refreshActivitySlotView();
  }

  selectActivityBlock(timeBlockId: string): void {
    this.selectedActivityBlockId = timeBlockId;
    this.refreshActivitySlotView();
  }

  generate(): void {
    this.uiErrors = this.validateUiConfiguration();
    if (this.uiErrors.length > 0) {
      this.generationResult = undefined;
      this.scheduleGrid = { columns: [], rows: [] };
      this.activitySlotView = undefined;
      this.scheduleStale = false;
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
    this.generatedGroups = groups.map((group) => ({ ...group }));
    this.generatedSeason = { ...this.season };
    this.generatedActivities = this.activities.map((activity) => ({ ...activity }));
    this.generatedCategories = this.groupCategories.map((category) => ({ ...category }));
    this.generatedEligibility = this.activityEligibility.map((entry) => ({ ...entry }));
    this.generatedTimeBlocks = this.timeBlocks.map((block) => ({ ...block }));
    this.scheduleGrid = buildScheduleGrid(
      this.generationResult,
      this.generatedGroups,
      this.generatedCategories,
      this.generatedActivities,
      this.generatedTimeBlocks,
    );
    this.scheduleStale = false;
    this.saveState = 'idle';
    this.saveMessage = '';
    this.savedScheduleId = undefined;
    this.executionState = { progress: [], cycles: [] };
    this.executionStateStatus = 'idle';
    this.executionMessage = '';
    if (!this.scheduleName.trim()) {
      this.scheduleName = `${this.season.name} · ${this.startDate}–${this.endDate}`;
    }
    const firstSlot = this.generationResult.blocks[0]?.slot;
    this.selectedActivityDate = firstSlot?.date ?? '';
    this.selectedActivityBlockId = firstSlot?.timeBlockId ?? '';
    this.refreshActivitySlotView();
  }

  async saveSchedule(): Promise<void> {
    if (!this.generationResult || !this.generatedSeason || this.scheduleStale || this.saveState === 'saving') return;
    if (!this.currentUser) {
      this.saveState = 'error';
      this.saveMessage = 'Inicia sesión para guardar una programación.';
      return;
    }
    const name = this.scheduleName.trim();
    if (!name) {
      this.saveState = 'error';
      this.saveMessage = 'Indica un nombre para la programación.';
      return;
    }
    if (this.generationResult.status === 'invalid_input') {
      this.saveState = 'error';
      this.saveMessage = 'No se puede guardar una programación con errores de entrada.';
      return;
    }

    this.saveState = 'saving';
    this.saveMessage = '';
    try {
      const stored = await this.savedScheduleService.save({
        userId: this.currentUser.id,
        name,
        seasonName: this.generatedSeason.name,
        rangeStart: this.startDate,
        rangeEnd: this.endDate,
        seed: this.generationResult.diagnostics.seed,
        algorithmVersion: this.generationResult.diagnostics.engineVersion,
        scheduleData: buildSavedScheduleData({
          season: this.generatedSeason,
          categories: this.generatedCategories,
          groups: this.generatedGroups,
          activities: this.generatedActivities,
          eligibility: this.generatedEligibility,
          timeBlocks: this.generatedTimeBlocks,
          result: this.generationResult,
        }),
      });
      this.savedScheduleId = stored.id;
      this.executionStateStatus = 'loading';
      this.executionState = await this.assignmentProgressService.initialize(
        stored.id,
        this.currentUser.id,
        stored.scheduleData.configuration.groups.map((group) => group.id),
      );
      this.executionStateStatus = 'updated';
      this.executionMessage = 'Progreso inicializado.';
      this.saveState = 'saved';
      this.saveMessage = 'Programación guardada correctamente.';
      await this.loadSavedSchedules();
    } catch (error) {
      this.savedScheduleId = undefined;
      this.saveState = 'error';
      this.saveMessage = error instanceof Error ? error.message : 'No se pudo guardar la programación.';
    }
  }

  async submitAuth(): Promise<void> {
    if (this.authBusy) return;
    const email = this.authEmail.trim();
    if (!email || this.authPassword.length < 6) {
      this.authMessage = 'Indica un email válido y una contraseña de al menos 6 caracteres.';
      return;
    }
    this.authBusy = true;
    this.authMessage = '';
    try {
      if (this.authMode === 'signIn') {
        this.currentUser = await this.authService.signIn(email, this.authPassword);
        await this.loadSavedSchedules();
      } else {
        const result = await this.authService.signUp(email, this.authPassword);
        if (result.confirmationRequired) {
          this.authMessage = 'Cuenta creada. Revisa tu email para confirmarla antes de iniciar sesión.';
          this.authMode = 'signIn';
        } else if (result.user) {
          this.currentUser = result.user;
          await this.loadSavedSchedules();
        }
      }
    } catch (error) {
      this.authMessage = error instanceof Error ? error.message : 'No se pudo completar la autenticación.';
    } finally {
      this.authBusy = false;
    }
  }

  async signOut(): Promise<void> {
    try {
      await this.authService.signOut();
      this.currentUser = undefined;
      this.savedSchedules = [];
      this.authPassword = '';
      this.clearExecutionState();
    } catch (error) {
      this.savedSchedulesMessage = error instanceof Error ? error.message : 'No se pudo cerrar la sesión.';
    }
  }

  async openSavedSchedule(id: string): Promise<void> {
    if (!this.currentUser) return;
    this.savedSchedulesMessage = '';
    try {
      const stored = await this.savedScheduleService.get(id, this.currentUser.id);
      const restored = restoreSavedSchedule(stored.scheduleData);
      this.executionStateStatus = 'loading';
      this.executionMessage = 'Cargando progreso…';
      const executionState = await this.assignmentProgressService.initialize(
        stored.id,
        this.currentUser.id,
        restored.groups.map((group) => group.id),
      );
      this.season = { ...restored.season };
      this.groupCategories = restored.categories.map((category) => ({ ...category }));
      this.activities = restored.activities.map((activity) => ({ ...activity }));
      this.activityEligibility = restored.eligibility.map((entry) => ({ ...entry }));
      this.timeBlocks = restored.timeBlocks.map((block) => ({ ...block }));
      this.groupConfigurations = restored.categories.map((category) => {
        const groups = restored.groups.filter((group) => group.categoryId === category.id);
        return {
          categoryId: category.id,
          count: groups.length,
          participantCount: groups[0]?.participantCount,
          active: groups.some((group) => group.active),
        };
      });
      this.generatedSeason = restored.season;
      this.generatedCategories = restored.categories;
      this.generatedGroups = restored.groups;
      this.generatedActivities = restored.activities;
      this.generatedEligibility = restored.eligibility;
      this.generatedTimeBlocks = restored.timeBlocks;
      this.generationResult = restored.result;
      this.scheduleGrid = buildScheduleGrid(
        restored.result,
        restored.groups,
        restored.categories,
        restored.activities,
        restored.timeBlocks,
      );
      this.startDate = stored.rangeStart ?? restored.result.blocks[0]?.slot.date ?? this.startDate;
      this.endDate = stored.rangeEnd ?? restored.result.blocks.at(-1)?.slot.date ?? this.endDate;
      this.seed = stored.seed ?? restored.result.diagnostics.seed;
      this.scheduleName = stored.name;
      this.savedScheduleId = stored.id;
      this.scheduleStale = false;
      this.showProjectedCycles = false;
      this.saveState = 'saved';
      this.saveMessage = 'Programación guardada abierta.';
      this.executionState = executionState;
      this.executionStateStatus = 'updated';
      this.executionMessage = 'Progreso actualizado.';
      const firstSlot = restored.result.blocks[0]?.slot;
      this.selectedActivityDate = firstSlot?.date ?? '';
      this.selectedActivityBlockId = firstSlot?.timeBlockId ?? '';
      this.refreshActivitySlotView();
    } catch (error) {
      this.savedSchedulesMessage = error instanceof Error ? error.message : 'No se pudo abrir la programación.';
    }
  }

  async deleteSavedSchedule(schedule: SavedScheduleSummary): Promise<void> {
    if (!this.currentUser || !window.confirm(`¿Eliminar “${schedule.name}”?`)) return;
    this.savedSchedulesMessage = '';
    try {
      await this.savedScheduleService.delete(schedule.id, this.currentUser.id);
      this.savedSchedules = this.savedSchedules.filter((item) => item.id !== schedule.id);
      if (this.savedScheduleId === schedule.id) {
        this.savedScheduleId = undefined;
        this.saveState = 'idle';
        this.saveMessage = '';
        this.executionState = { progress: [], cycles: [] };
        this.executionStateStatus = 'idle';
      }
    } catch (error) {
      this.savedSchedulesMessage = error instanceof Error ? error.message : 'No se pudo eliminar la programación.';
    }
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

  trackByActivityView(_: number, activity: { activityId: string }): string {
    return activity.activityId;
  }

  progressForCell(groupId: string, cell: ScheduleGridCell): AssignmentProgress | undefined {
    if (!cell.assignment) return undefined;
    return this.executionState.progress.find((item) => assignmentProgressKey(item) === assignmentProgressKey({
      groupId,
      date: cell.assignment!.date,
      timeBlockId: cell.assignment!.timeBlockId,
    }));
  }

  progressForAssignment(groupId: string, date: string, timeBlockId: string): AssignmentProgress | undefined {
    const key = assignmentProgressKey({ groupId, date, timeBlockId });
    return this.executionState.progress.find((item) => assignmentProgressKey(item) === key);
  }

  progressStatusLabel(status: AssignmentProgressStatus): string {
    return status === 'completed' ? 'Completada' : status === 'cancelled' ? 'Cancelada' : 'Planificada';
  }

  async changeProgressStatus(progress: AssignmentProgress, status: AssignmentProgressStatus): Promise<void> {
    if (!this.currentUser || !this.savedScheduleId || this.executionStateStatus === 'updating') return;
    this.executionStateStatus = 'updating';
    this.updatingProgressId = progress.id;
    this.executionMessage = 'Actualizando progreso…';
    try {
      await this.assignmentProgressService.setStatus(progress.id, status, this.currentUser.id);
      await this.reloadExecution();
      this.executionStateStatus = 'updated';
      this.executionMessage = 'Progreso actualizado.';
    } catch (error) {
      this.executionStateStatus = 'error';
      this.executionMessage = error instanceof Error ? error.message : 'No se pudo actualizar el progreso.';
    } finally {
      this.updatingProgressId = undefined;
    }
  }

  async changeRequirementStatus(requirementId: string, status: 'pending' | 'exempted'): Promise<void> {
    if (!this.currentUser || this.executionStateStatus === 'updating') return;
    this.executionStateStatus = 'updating';
    this.executionMessage = 'Actualizando ciclo…';
    try {
      await this.assignmentProgressService.setRequirementStatus(requirementId, status, this.currentUser.id);
      await this.reloadExecution();
      this.executionStateStatus = 'updated';
      this.executionMessage = 'Ciclo actualizado.';
    } catch (error) {
      this.executionStateStatus = 'error';
      this.executionMessage = error instanceof Error ? error.message : 'No se pudo actualizar el ciclo.';
    }
  }

  private async reloadExecution(): Promise<void> {
    if (!this.currentUser || !this.savedScheduleId) return;
    this.executionState = await this.assignmentProgressService.load(
      this.savedScheduleId,
      this.currentUser.id,
      this.generatedGroups.map((group) => group.id),
    );
  }

  private refreshActivitySlotView(): void {
    this.activitySlotView =
      this.generationResult && this.selectedActivityDate && this.selectedActivityBlockId
        ? buildActivitySlotView(
            this.generationResult,
            this.selectedActivityDate,
            this.selectedActivityBlockId,
            this.generatedGroups,
            this.generatedCategories,
            this.generatedActivities,
            this.generatedTimeBlocks,
          )
        : undefined;
  }

  private async initializeSession(): Promise<void> {
    try {
      this.currentUser = await this.authService.initialize();
      this.unsubscribeAuth = this.authService.onAuthStateChange((user) => {
        this.currentUser = user;
        if (user) void this.loadSavedSchedules();
        else {
          this.savedSchedules = [];
          this.clearExecutionState();
        }
      });
      if (this.currentUser) await this.loadSavedSchedules();
    } catch (error) {
      this.authMessage = error instanceof Error ? error.message : 'No se pudo recuperar la sesión.';
    } finally {
      this.authLoading = false;
    }
  }

  private async loadSavedSchedules(): Promise<void> {
    if (!this.currentUser) return;
    this.savedSchedulesLoading = true;
    this.savedSchedulesMessage = '';
    try {
      this.savedSchedules = await this.savedScheduleService.list(this.currentUser.id);
    } catch (error) {
      this.savedSchedulesMessage = error instanceof Error ? error.message : 'No se pudieron cargar tus programaciones.';
    } finally {
      this.savedSchedulesLoading = false;
    }
  }

  private clearExecutionState(): void {
    this.savedScheduleId = undefined;
    this.executionState = { progress: [], cycles: [] };
    this.executionStateStatus = 'idle';
    this.executionMessage = '';
    this.updatingProgressId = undefined;
  }

  private validateUiConfiguration(): string[] {
    const errors: string[] = [];
    const dates = enumerateLocalDates(this.startDate, this.endDate);
    if (!Number.isSafeInteger(this.seed) || this.seed < 0 || this.seed > 4_294_967_295) {
      errors.push('La semilla debe ser un entero entre 0 y 4294967295.');
    }
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
