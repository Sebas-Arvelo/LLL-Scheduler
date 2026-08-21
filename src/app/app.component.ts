import { CommonModule } from '@angular/common';
import { Component, type OnDestroy, type OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { DEMO_ACTIVITIES } from './activity-catalog';
import {
  type Activity,
  type ActivityCycleSnapshot,
  type ActivityEligibility,
  type Assignment,
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
  type ScheduleGridColumn,
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
  completedActivities: readonly {
    progressId: string;
    name: string;
    date: string;
    timeBlockName: string;
    completedAt: string;
  }[];
  pending: readonly { id: string; name: string }[];
  exempted: readonly { id: string; name: string }[];
}

type DayMode = 'regular' | 'morning' | 'custom' | 'special';

const DIAGNOSTIC_MESSAGES: Readonly<Record<SchedulingDiagnosticCode, string>> = {
  INACTIVE_GROUP_SKIPPED: 'Se omitió un grupo inactivo.',
  INVALID_SCHEDULING_INPUT: 'La configuración general contiene fechas, bloques o referencias inválidas.',
  LOCKED_ASSIGNMENT_OUTSIDE_TARGET: 'Existe una asignación bloqueada fuera del bloque procesado.',
  LOCKED_ASSIGNMENT_OUTSIDE_GENERATION: 'Existe una asignación bloqueada fuera del rango generado.',
  INVALID_LOCKED_ASSIGNMENT: 'Una asignación bloqueada no cumple las restricciones actuales.',
  DUPLICATE_AVAILABILITY: 'Hay reglas de disponibilidad duplicadas.',
  PARTICIPANT_COUNT_REQUIRED: 'Falta participantCount para aplicar una capacidad máxima de participantes.',
};

function addLocalDays(value: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return '';
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (date.toISOString().slice(0, 10) !== value) return '';
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function currentLocalDate(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function timeBlocksAreConsecutive(current: TimeBlock, next: TimeBlock): boolean {
  if (current.endTime && next.startTime) return current.endTime === next.startTime;
  const currentName = /^([MT])(\d+)$/i.exec(current.name.trim());
  const nextName = /^([MT])(\d+)$/i.exec(next.name.trim());
  return !!currentName && !!nextName && currentName[1].toUpperCase() === nextName[1].toUpperCase() &&
    Number(nextName[2]) === Number(currentName[2]) + 1;
}

function mergeById<T extends { id: string }>(previous: readonly T[], next: readonly T[]): T[] {
  const merged = new Map(previous.map((item) => [item.id, { ...item }]));
  for (const item of next) merged.set(item.id, { ...item });
  return [...merged.values()];
}

function mergeEligibility(
  previous: readonly ActivityEligibility[],
  next: readonly ActivityEligibility[],
): ActivityEligibility[] {
  return [...new Map([...previous, ...next].map((entry) => [
    `${entry.activityId}\u0000${entry.groupCategoryId}`,
    { ...entry },
  ])).values()];
}

function standardDeviation(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
}

function mergeScheduleResults(
  previous: ScheduleGenerationResult | undefined,
  daily: ScheduleGenerationResult,
  date: string,
): ScheduleGenerationResult {
  if (!previous) return daily;
  const priorAssignments = previous.assignments.filter((assignment) => assignment.date !== date);
  const assignments = [...priorAssignments, ...daily.assignments].sort((left, right) =>
    left.date.localeCompare(right.date) ||
    left.timeBlockId.localeCompare(right.timeBlockId) ||
    left.groupId.localeCompare(right.groupId),
  );
  const blocks = [
    ...previous.blocks.filter((block) => block.slot.date !== date),
    ...daily.blocks,
  ].sort((left, right) =>
    left.slot.date.localeCompare(right.slot.date) ||
    left.slot.timeBlockOrder - right.slot.timeBlockOrder ||
    left.slot.timeBlockId.localeCompare(right.slot.timeBlockId),
  );
  const unassigned = [
    ...previous.unassigned.filter((block) => block.slot.date !== date),
    ...daily.unassigned,
  ].sort((left, right) =>
    left.slot.date.localeCompare(right.slot.date) || left.slot.timeBlockOrder - right.slot.timeBlockOrder,
  );
  const groupIds = [...new Set([
    ...previous.metrics.byGroup.map((group) => group.groupId),
    ...daily.metrics.byGroup.map((group) => group.groupId),
  ])].sort();
  const byGroup = groupIds.map((groupId) => {
    const groupAssignments = assignments.filter((assignment) => assignment.groupId === groupId);
    const activityUsage: Record<string, number> = {};
    for (const assignment of groupAssignments) {
      activityUsage[assignment.activityId] = (activityUsage[assignment.activityId] ?? 0) + 1;
    }
    const previousMetrics = previous.metrics.byGroup.find((group) => group.groupId === groupId);
    const dailyMetrics = daily.metrics.byGroup.find((group) => group.groupId === groupId);
    return {
      groupId,
      totalAssignments: groupAssignments.length,
      distinctActivityCount: Object.keys(activityUsage).length,
      prematureRepetitionCount:
        (previousMetrics?.prematureRepetitionCount ?? 0) + (dailyMetrics?.prematureRepetitionCount ?? 0),
      completedCycleCount: (previousMetrics?.completedCycleCount ?? 0) + (dailyMetrics?.completedCycleCount ?? 0),
      activityUsage,
    };
  });
  const activityUsage: Record<string, number> = {};
  for (const assignment of assignments) {
    activityUsage[assignment.activityId] = (activityUsage[assignment.activityId] ?? 0) + 1;
  }
  const unassignedCells = unassigned.reduce((sum, block) => sum + block.groups.length, 0);
  const requestedGroupBlocks = assignments.length + unassignedCells;
  const prematureRepetitionCount = byGroup.reduce((sum, group) => sum + group.prematureRepetitionCount, 0);
  return {
    status: daily.status === 'invalid_input'
      ? 'invalid_input'
      : unassignedCells > 0
        ? 'partial'
        : 'success',
    assignments,
    unassigned,
    projectedCycles: daily.projectedCycles,
    blocks,
    metrics: {
      byGroup,
      global: {
        requestedGroupBlocks,
        successfulAssignments: assignments.length,
        unassignedCells,
        coveragePercentage: requestedGroupBlocks === 0 ? 100 : assignments.length / requestedGroupBlocks * 100,
        prematureRepetitionCount,
        activityUsage,
        activityUsageStandardDeviation: standardDeviation(Object.values(activityUsage)),
      },
    },
    diagnostics: {
      ...daily.diagnostics,
      blockCount: blocks.length,
      generatedBlockCount: blocks.length,
      branchAndBoundNodes:
        previous.diagnostics.branchAndBoundNodes + daily.diagnostics.branchAndBoundNodes,
      branchAndBoundBranches:
        previous.diagnostics.branchAndBoundBranches + daily.diagnostics.branchAndBoundBranches,
      warnings: [...previous.diagnostics.warnings, ...daily.diagnostics.warnings],
      errors: [...previous.diagnostics.errors, ...daily.diagnostics.errors],
    },
  };
}

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
    participantCount: 8,
    active: true,
  }));
  activities: Activity[] = DEMO_ACTIVITIES.map((activity) => ({ ...activity }));
  activityEligibility: ActivityEligibility[] = DEMO_ACTIVITY_ELIGIBILITY.map((entry) => ({ ...entry }));
  timeBlocks: TimeBlock[] = DEMO_TIME_BLOCKS.map((block) => ({ ...block }));

  startDate = currentLocalDate();
  endDate = this.startDate;
  dayMode: DayMode = 'regular';
  specialDayActivityName = 'Ecoaventura';
  afternoonActivityName = 'Batalla de Araure';
  dailyUnavailableActivityIds: string[] = [];
  dailyActivityStartBlockIds: Record<string, string> = {};
  seed = 2026;
  activitySearch = '';
  showProjectedCycles = false;
  viewMode: 'groups' | 'activities' = 'groups';
  scheduleStale = false;
  selectedActivityDate = '';
  selectedActivityBlockId = '';
  selectedGroupDate = '';
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
  private customActivitySequence = 0;

  constructor() {
    this.syncSeasonDates();
  }

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

  get planningDate(): string {
    return this.startDate;
  }

  get maximumEndDate(): string {
    return addLocalDays(this.startDate, 20);
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
    const currentProgressIds = new Set(this.executionState.progress.map((item) => item.id));
    const previousHistory = (this.executionState.history ?? []).filter(
      (item) => !currentProgressIds.has(item.id),
    );
    return deriveRealHistory([...previousHistory, ...this.executionState.progress]);
  }

  get currentRealCycles(): readonly RealActivityCycle[] {
    return currentRealCycles(this.executionState.cycles);
  }

  get realCycleViews(): readonly RealCycleView[] {
    const activityById = new Map(this.generatedActivities.map((activity) => [activity.id, activity.name]));
    const blockById = new Map(this.generatedTimeBlocks.map((block) => [block.id, block.name]));
    const historyByGroup = new Map<string, RealCycleView['completedActivities'][number][]>();
    for (const entry of this.realHistory) {
      const completed = historyByGroup.get(entry.groupId) ?? [];
      completed.push({
        progressId: entry.progressId,
        name: activityById.get(entry.activityId) ?? entry.activityId,
        date: entry.date,
        timeBlockName: blockById.get(entry.timeBlockId) ?? entry.timeBlockId,
        completedAt: entry.completedAt,
      });
      historyByGroup.set(entry.groupId, completed);
    }
    return this.generatedGroups.map((group) => {
      const groupCycles = this.executionState.cycles.filter((cycle) => cycle.groupId === group.id);
      const selected = groupCycles.find((cycle) => cycle.status === 'active') ?? groupCycles.at(-1);
      return {
        groupId: group.id,
        groupName: group.name,
        ...(selected ? { currentCycle: selected } : {}),
        completedCycleCount: groupCycles.filter((cycle) => cycle.status === 'completed').length,
        completedActivities: [...(historyByGroup.get(group.id) ?? [])]
          .sort((left, right) => right.completedAt.localeCompare(left.completedAt)),
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

  get groupScheduleDates(): readonly LocalDate[] {
    return [...new Set(this.scheduleGrid.columns.map((column) => column.date))];
  }

  get visibleGroupColumns(): readonly ScheduleGridColumn[] {
    const selectedDate = this.selectedGroupDate || this.groupScheduleDates[0];
    return this.scheduleGrid.columns.filter((column) => column.date === selectedDate);
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

  cellForGroupColumn(row: ScheduleGridRow, column: ScheduleGridColumn): ScheduleGridCell | undefined {
    const columnIndex = this.scheduleGrid.columns.findIndex((candidate) => candidate.key === column.key);
    return columnIndex >= 0 ? row.cells[columnIndex] : undefined;
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

  setSeasonName(name: string): void {
    this.season.name = name;
    this.markScheduleStale();
  }

  setStartDate(date: string): void {
    this.setPlanningDate(date);
  }

  setPlanningDate(date: string): void {
    this.startDate = date;
    this.endDate = date;
    this.syncSeasonDates();
    this.markScheduleStale();
  }

  setEndDate(date: string): void {
    this.endDate = date;
    this.syncSeasonDates();
    this.markScheduleStale();
  }

  setDayMode(mode: DayMode): void {
    this.dayMode = mode;
    this.timeBlocks = this.timeBlocks.filter((block) => !block.id.startsWith('special-all-day-'));
    if (mode === 'regular') {
      for (const block of this.timeBlocks) block.active = true;
    } else if (mode === 'morning') {
      for (const block of this.timeBlocks) block.active = /^M\d+$/i.test(block.name.trim());
    } else if (mode === 'special') {
      for (const block of this.timeBlocks) block.active = false;
    }
    this.clearInvalidActivityStartBlocks();
    this.markScheduleStale();
  }

  setBlockActive(block: TimeBlock, active: boolean): void {
    block.active = active;
    this.dayMode = 'custom';
    this.clearInvalidActivityStartBlocks();
    this.markScheduleStale();
  }

  activityStartBlockId(activityId: string): string {
    return this.dailyActivityStartBlockIds[activityId] ?? '';
  }

  activityStartBlockOptions(activity: Activity): readonly TimeBlock[] {
    const duration = activity.durationBlocks ?? 1;
    const blocks = this.timeBlocks
      .filter((block) => block.active)
      .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
    return blocks.filter((_, startIndex) => {
      const selected = blocks.slice(startIndex, startIndex + duration);
      return selected.length === duration && selected.slice(1).every(
        (block, index) => timeBlocksAreConsecutive(selected[index], block),
      );
    });
  }

  setActivityStartBlock(activityId: string, timeBlockId: string): void {
    if (timeBlockId) this.dailyActivityStartBlockIds = { ...this.dailyActivityStartBlockIds, [activityId]: timeBlockId };
    else {
      const { [activityId]: _removed, ...remaining } = this.dailyActivityStartBlockIds;
      this.dailyActivityStartBlockIds = remaining;
    }
    this.markScheduleStale();
  }

  isActivityAvailableToday(activityId: string): boolean {
    return !this.dailyUnavailableActivityIds.includes(activityId);
  }

  setActivityAvailableToday(activityId: string, available: boolean): void {
    this.dailyUnavailableActivityIds = available
      ? this.dailyUnavailableActivityIds.filter((id) => id !== activityId)
      : [...new Set([...this.dailyUnavailableActivityIds, activityId])];
    this.markScheduleStale();
  }

  prepareNextDay(): void {
    const nextDate = addLocalDays(this.planningDate, 1);
    if (!nextDate) return;
    this.setPlanningDate(nextDate);
    this.dayMode = 'regular';
    this.timeBlocks = this.timeBlocks.filter((block) => !block.id.startsWith('special-all-day-'));
    for (const block of this.timeBlocks) block.active = true;
    this.dailyUnavailableActivityIds = [];
    this.dailyActivityStartBlockIds = {};
    this.activitySlotView = undefined;
    this.executionStateStatus = 'idle';
    this.executionMessage = '';
    this.scheduleStale = true;
  }

  addActivity(): void {
    const activity: Activity = {
      id: this.nextCustomActivityId(),
      name: 'Nueva actividad',
      displayCategory: 'Sin tipo',
      minGroups: 1,
      maxGroups: Math.max(this.totalGroups, 1),
      durationBlocks: 1,
      active: true,
    };

    this.activities = [...this.activities, activity];
    this.activityEligibility = [
      ...this.activityEligibility,
      ...this.groupCategories.map((category) => ({
        activityId: activity.id,
        groupCategoryId: category.id,
      })),
    ];
    this.activitySearch = '';
    this.markScheduleStale();
  }

  removeActivity(activity: Activity): void {
    if (!window.confirm(`¿Eliminar “${activity.name}” del catálogo de actividades?`)) return;

    this.activities = this.activities.filter((candidate) => candidate.id !== activity.id);
    this.activityEligibility = this.activityEligibility.filter((entry) => entry.activityId !== activity.id);
    this.setActivityStartBlock(activity.id, '');
    this.markScheduleStale();
  }

  setMinGroups(activity: Activity, value: number): void {
    activity.minGroups = Number(value);
    this.markScheduleStale();
  }

  setActivityDuration(activity: Activity, value: number): void {
    activity.durationBlocks = Number(value);
    this.clearInvalidActivityStartBlocks();
    this.markScheduleStale();
  }

  markScheduleStale(): void {
    if (this.generationResult) {
      this.scheduleStale = true;
      if (this.saveState !== 'saving') {
        this.saveState = 'idle';
        this.saveMessage = '';
      }
    }
  }

  private nextCustomActivityId(): string {
    let id: string;
    do {
      this.customActivitySequence += 1;
      id = `actividad-personalizada-${Date.now()}-${this.customActivitySequence}`;
    } while (this.activities.some((activity) => activity.id === id));
    return id;
  }

  setViewMode(mode: 'groups' | 'activities'): void {
    this.viewMode = mode;
  }

  selectActivityDate(date: LocalDate): void {
    this.selectedActivityDate = date;
    this.selectedActivityBlockId = this.availableActivityBlocks[0]?.id ?? '';
    this.refreshActivitySlotView();
  }

  selectGroupDate(date: LocalDate): void {
    this.selectedGroupDate = date;
  }

  selectActivityBlock(timeBlockId: string): void {
    this.selectedActivityBlockId = timeBlockId;
    this.refreshActivitySlotView();
  }

  generate(): void {
    const previousResult = this.generationResult;
    const previousActivities = this.generatedActivities;
    const previousEligibility = this.generatedEligibility;
    const previousTimeBlocks = this.generatedTimeBlocks;
    this.syncSeasonDates();
    this.uiErrors = this.validateUiConfiguration();
    if (this.uiErrors.length > 0) {
      if (!previousResult) {
        this.scheduleGrid = { columns: [], rows: [] };
        this.activitySlotView = undefined;
      }
      return;
    }

    const groups = this.groups;
    const dailyConfiguration = this.buildDailyGenerationConfiguration(groups);
    const input = buildScheduleGenerationInput({
      season: this.season,
      startDate: this.planningDate,
      endDate: this.planningDate,
      timeBlocks: dailyConfiguration.timeBlocks,
      groups,
      activities: dailyConfiguration.activities,
      groupCategories: this.groupCategories,
      activityEligibility: dailyConfiguration.eligibility,
      initialCycleSnapshots: previousResult?.projectedCycles.length
        ? previousResult.projectedCycles.flatMap((state) => state.cycles.map((cycle) => cycle.snapshot))
        : this.realCycleSnapshots(),
      history: [
        ...this.realCompletedHistory(),
        ...(previousResult?.assignments
          .filter((assignment) =>
            assignment.sessionBlockCount === undefined ||
            assignment.sessionBlockIndex === assignment.sessionBlockCount - 1,
          )
          .map((assignment) => ({ ...assignment, status: 'completed' as const })) ?? []),
      ],
      hardConstraints: dailyConfiguration.hardConstraints,
      seed: this.seed,
    });
    const dailyResult = generateSchedule(input);
    this.generationResult = mergeScheduleResults(previousResult, dailyResult, this.planningDate);
    this.generatedGroups = groups.map((group) => ({ ...group }));
    const generatedDates = [...new Set(this.generationResult.blocks.map((block) => block.slot.date))].sort();
    this.generatedSeason = {
      ...this.season,
      startDate: generatedDates[0] ?? this.planningDate,
      endDate: generatedDates.at(-1) ?? this.planningDate,
    };
    this.generatedActivities = mergeById(previousActivities, dailyConfiguration.activities);
    this.generatedCategories = this.groupCategories.map((category) => ({ ...category }));
    this.generatedEligibility = mergeEligibility(previousEligibility, dailyConfiguration.eligibility);
    this.generatedTimeBlocks = mergeById(previousTimeBlocks, [
      ...this.timeBlocks,
      ...dailyConfiguration.timeBlocks.filter((block) => block.id.startsWith('special-')),
    ]);
    this.scheduleGrid = buildScheduleGrid(
      this.generationResult,
      this.generatedGroups,
      this.generatedCategories,
      this.generatedActivities,
      this.generatedTimeBlocks,
    );
    this.selectedGroupDate = this.planningDate;
    this.scheduleStale = false;
    this.saveState = 'idle';
    this.saveMessage = '';
    if (!this.scheduleName.trim()) {
      this.scheduleName = `${this.season.name} · ${this.planningDate}`;
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
    const existingScheduleId = this.savedScheduleId;
    try {
      const stored = await this.savedScheduleService.save({
        ...(this.savedScheduleId ? { id: this.savedScheduleId } : {}),
        userId: this.currentUser.id,
        name,
        seasonName: this.generatedSeason.name,
        rangeStart: this.generatedSeason.startDate,
        rangeEnd: this.generatedSeason.endDate,
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
      this.savedScheduleId = existingScheduleId;
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
      this.activities = restored.activities
        .filter((activity) => activity.countsTowardCycle !== false)
        .map((activity) => ({ ...activity }));
      const catalogActivityIds = new Set(this.activities.map((activity) => activity.id));
      this.activityEligibility = restored.eligibility
        .filter((entry) => catalogActivityIds.has(entry.activityId))
        .map((entry) => ({ ...entry }));
      const lastGeneratedDate = restored.result.blocks.at(-1)?.slot.date ?? stored.rangeEnd ?? this.planningDate;
      const lastDayBlocks = restored.result.blocks.filter((block) => block.slot.date === lastGeneratedDate);
      const usedBlockIds = new Set(lastDayBlocks.map((block) => block.slot.timeBlockId));
      const isSpecialDay = lastDayBlocks.some((block) => block.slot.timeBlockId.startsWith('special-all-day-'));
      const hasAfternoonActivity = lastDayBlocks.some(
        (block) => block.slot.timeBlockId.startsWith('special-afternoon-'),
      );
      this.timeBlocks = restored.timeBlocks
        .filter((block) => !block.id.startsWith('special-'))
        .map((block) => ({ ...block, active: isSpecialDay ? false : usedBlockIds.has(block.id) }));
      this.dayMode = isSpecialDay
        ? 'special'
        : hasAfternoonActivity
          ? 'morning'
        : this.timeBlocks.filter((block) => block.active).every((block) => /^M\d+$/i.test(block.name.trim())) &&
            this.timeBlocks.some((block) => block.active)
          ? 'morning'
          : this.timeBlocks.every((block) => block.active)
            ? 'regular'
            : 'custom';
      this.specialDayActivityName = restored.activities.find(
        (activity) => activity.id.startsWith(`special-${lastGeneratedDate}-`) && activity.countsTowardCycle === false,
      )?.name ?? this.specialDayActivityName;
      this.afternoonActivityName = restored.activities.find(
        (activity) => activity.id.startsWith(`special-afternoon-${lastGeneratedDate}-`) && activity.countsTowardCycle === false,
      )?.name ?? this.afternoonActivityName;
      this.dailyUnavailableActivityIds = [];
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
      this.selectedGroupDate = this.groupScheduleDates[0] ?? '';
      this.startDate = lastGeneratedDate;
      this.endDate = lastGeneratedDate;
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
    if (dates.length !== 1) errors.push('Selecciona una sola fecha para preparar el día.');
    if (this.dayMode !== 'special' && this.activeBlocks === 0) errors.push('Activa al menos un bloque.');
    if (this.dayMode === 'special' && !this.specialDayActivityName.trim()) {
      errors.push('Indica el nombre de la actividad especial del día.');
    }
    if (this.dayMode === 'morning' && !this.afternoonActivityName.trim()) {
      errors.push('Indica el nombre de la actividad de la tarde.');
    }
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
    if (activeActivities.some((activity) => {
      const selectedBlockId = this.activityStartBlockId(activity.id);
      return selectedBlockId && !this.activityStartBlockOptions(activity).some((block) => block.id === selectedBlockId);
    })) {
      errors.push('El bloque elegido debe estar activo y tener espacio consecutivo para la duración de la actividad.');
    }
    if (
      activeActivities.some(
        (activity) =>
          !activity.name.trim() ||
          !Number.isInteger(activity.minGroups ?? 1) ||
          (activity.minGroups ?? 1) < 1 ||
          !Number.isInteger(activity.maxGroups) ||
          activity.maxGroups < 1 ||
          (activity.minGroups ?? 1) > activity.maxGroups ||
          !Number.isInteger(activity.durationBlocks ?? 1) ||
          (activity.durationBlocks ?? 1) < 1 ||
          (activity.durationBlocks ?? 1) > 3 ||
          (activity.maxParticipants !== undefined &&
            (!Number.isInteger(activity.maxParticipants) || activity.maxParticipants < 1)),
      )
    ) {
      errors.push('Las actividades activas necesitan nombre, duración de 1 a 3 bloques y capacidades válidas.');
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

  private buildDailyGenerationConfiguration(groups: readonly CampGroup[]) {
    if (this.dayMode !== 'special' && this.dayMode !== 'morning') {
      const activeBlocks = this.timeBlocks.filter((block) => block.active);
      return {
        timeBlocks: activeBlocks,
        activities: this.activities,
        eligibility: this.activityEligibility,
        hardConstraints: {
          activityAvailability: activeBlocks.flatMap((block) =>
            this.dailyUnavailableActivityIds.map((activityId) => ({
              activityId,
              date: this.planningDate,
              timeBlockId: block.id,
              available: false,
            }))),
          groupUnavailability: [],
          activityStartBlocks: this.dailyActivityStartBlocks(activeBlocks),
        },
      };
    }

    if (this.dayMode === 'morning') {
      const morningBlocks = this.timeBlocks.filter((block) => block.active);
      const afternoonBlock: TimeBlock = {
        id: `special-afternoon-${this.planningDate}`,
        seasonId: this.season.id,
        name: 'Actividad de la tarde',
        order: Math.max(...morningBlocks.map((block) => block.order), 0) + 1,
        active: true,
      };
      const groupCountByCategory = new Map<string, number>();
      for (const group of groups.filter((item) => item.active)) {
        groupCountByCategory.set(group.categoryId, (groupCountByCategory.get(group.categoryId) ?? 0) + 1);
      }
      const activityPrefix = `special-afternoon-${this.planningDate}-`;
      const afternoonActivities = this.groupCategories
        .filter((category) => (groupCountByCategory.get(category.id) ?? 0) > 0)
        .map<Activity>((category) => ({
          id: `${activityPrefix}${category.id}`,
          name: this.afternoonActivityName.trim(),
          displayCategory: `Actividad de la tarde · ${category.name}`,
          active: true,
          minGroups: 1,
          maxGroups: groupCountByCategory.get(category.id)!,
          countsTowardCycle: false,
        }));
      const afternoonEligibility = afternoonActivities.map<ActivityEligibility>((activity) => ({
        activityId: activity.id,
        groupCategoryId: activity.id.slice(activityPrefix.length),
      }));
      const regularActivityIds = this.activities.filter((activity) => activity.active).map((activity) => activity.id);
      return {
        timeBlocks: [...morningBlocks, afternoonBlock],
        activities: [...this.activities, ...afternoonActivities],
        eligibility: [...this.activityEligibility, ...afternoonEligibility],
        hardConstraints: {
          activityAvailability: [
            ...morningBlocks.flatMap((block) => [
              ...this.dailyUnavailableActivityIds.map((activityId) => ({
                activityId,
                date: this.planningDate,
                timeBlockId: block.id,
                available: false,
              })),
              ...afternoonActivities.map((activity) => ({
                activityId: activity.id,
                date: this.planningDate,
                timeBlockId: block.id,
                available: false,
              })),
            ]),
            ...regularActivityIds.map((activityId) => ({
              activityId,
              date: this.planningDate,
              timeBlockId: afternoonBlock.id,
              available: false,
            })),
          ],
          groupUnavailability: [],
          activityStartBlocks: this.dailyActivityStartBlocks(morningBlocks),
        },
      };
    }

    const specialBlock: TimeBlock = {
      id: `special-all-day-${this.planningDate}`,
      seasonId: this.season.id,
      name: 'Todo el día',
      order: 1,
      active: true,
    };
    const groupCountByCategory = new Map<string, number>();
    for (const group of groups.filter((item) => item.active)) {
      groupCountByCategory.set(group.categoryId, (groupCountByCategory.get(group.categoryId) ?? 0) + 1);
    }
    const specialActivities = this.groupCategories
      .filter((category) => (groupCountByCategory.get(category.id) ?? 0) > 0)
      .map<Activity>((category) => ({
        id: `special-${this.planningDate}-${category.id}`,
        name: this.specialDayActivityName.trim(),
        displayCategory: `Actividad especial · ${category.name}`,
        active: true,
        minGroups: 1,
        maxGroups: groupCountByCategory.get(category.id)!,
        countsTowardCycle: false,
      }));
    const specialEligibility = specialActivities.map<ActivityEligibility>((activity) => ({
      activityId: activity.id,
      groupCategoryId: activity.id.slice(`special-${this.planningDate}-`.length),
    }));
    const regularActivityIds = this.activities.filter((activity) => activity.active).map((activity) => activity.id);
    return {
      timeBlocks: [specialBlock],
      activities: [...this.activities, ...specialActivities],
      eligibility: [...this.activityEligibility, ...specialEligibility],
      hardConstraints: {
        activityAvailability: regularActivityIds.map((activityId) => ({
          activityId,
          date: this.planningDate,
          timeBlockId: specialBlock.id,
          available: false,
        })),
        groupUnavailability: [],
      },
    };
  }

  private dailyActivityStartBlocks(blocks: readonly TimeBlock[]) {
    const activeBlockIds = new Set(blocks.map((block) => block.id));
    return Object.entries(this.dailyActivityStartBlockIds)
      .filter(([, timeBlockId]) => activeBlockIds.has(timeBlockId))
      .map(([activityId, timeBlockId]) => ({
        activityId,
        date: this.planningDate,
        timeBlockId,
      }));
  }

  private clearInvalidActivityStartBlocks(): void {
    this.dailyActivityStartBlockIds = Object.fromEntries(
      Object.entries(this.dailyActivityStartBlockIds).filter(([activityId, timeBlockId]) => {
        const activity = this.activities.find((candidate) => candidate.id === activityId);
        return !!activity && this.activityStartBlockOptions(activity).some((block) => block.id === timeBlockId);
      }),
    );
  }

  private realCycleSnapshots(): readonly ActivityCycleSnapshot[] {
    return this.executionState.cycles.map((cycle) => ({
      cycle: {
        id: cycle.id,
        groupId: cycle.groupId,
        cycleNumber: cycle.cycleNumber,
        status: cycle.status,
        startedAt: cycle.startedAt,
        ...(cycle.completedAt ? { completedAt: cycle.completedAt } : {}),
      },
      requirements: cycle.requirements.map((requirement) => ({
        cycleId: cycle.id,
        activityId: requirement.activityId,
        status: requirement.status,
      })),
    }));
  }

  private realCompletedHistory(): readonly Assignment[] {
    return (this.executionState.history ?? this.executionState.progress)
      .filter((progress) => progress.status === 'completed')
      .map((progress) => ({
        id: progress.id,
        groupId: progress.groupId,
        activityId: progress.activityId,
        date: progress.date,
        timeBlockId: progress.timeBlockId,
        ...(progress.cycleId ? { cycleId: progress.cycleId } : {}),
        source: 'automatic',
        status: 'completed',
        locked: false,
      }));
  }

  private syncSeasonDates(): void {
    if (this.startDate) this.season.startDate = this.startDate;
    if (this.endDate) this.season.endDate = this.endDate;
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
