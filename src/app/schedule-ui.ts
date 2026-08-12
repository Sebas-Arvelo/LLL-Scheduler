import type {
  Activity,
  ActivityEligibility,
  Assignment,
  CampGroup,
  GroupCategory,
  LocalDate,
  ScheduleGenerationInput,
  ScheduleGenerationResult,
  Season,
  TimeBlock,
  UnassignedGroup,
  UnassignedReasonCode,
} from './domain';

export interface GroupCategoryConfiguration {
  categoryId: string;
  count: number;
  participantCount?: number;
  active: boolean;
}

export interface ScheduleGridColumn {
  key: string;
  date: LocalDate;
  timeBlockId: string;
  label: string;
  timeLabel?: string;
}

export interface ScheduleGridCell {
  key: string;
  activityName?: string;
  unassignedReason?: string;
}

export interface ScheduleGridRow {
  group: CampGroup;
  categoryName: string;
  cells: readonly ScheduleGridCell[];
}

export interface ScheduleGridView {
  columns: readonly ScheduleGridColumn[];
  rows: readonly ScheduleGridRow[];
}

const REASON_MESSAGES: Readonly<Record<UnassignedReasonCode, string>> = {
  NO_ELIGIBLE_ACTIVITY: 'No hay actividades elegibles para la categoría del grupo.',
  CAPACITY_EXHAUSTED: 'La capacidad disponible del bloque se agotó.',
  GROUP_UNAVAILABLE: 'El grupo no está disponible en este bloque.',
  NO_AVAILABLE_ACTIVITY: 'No hay actividades disponibles en este bloque.',
  PARTICIPANT_COUNT_REQUIRED: 'Falta indicar la cantidad de participantes del grupo.',
  INVALID_INPUT: 'La configuración del bloque no es válida.',
  NO_FEASIBLE_ASSIGNMENT: 'No se encontró una asignación que respete todas las restricciones.',
};

function parseLocalDate(value: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return undefined;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toISOString().slice(0, 10) === value ? date : undefined;
}

export function enumerateLocalDates(startDate: string, endDate: string): readonly LocalDate[] {
  const start = parseLocalDate(startDate);
  const end = parseLocalDate(endDate);
  if (!start || !end || start > end) return [];

  const dates: LocalDate[] = [];
  for (let instant = start.getTime(); instant <= end.getTime(); instant += 86_400_000) {
    dates.push(new Date(instant).toISOString().slice(0, 10));
  }
  return dates;
}

export function buildCampGroups(
  categories: readonly GroupCategory[],
  configurations: readonly GroupCategoryConfiguration[],
): readonly CampGroup[] {
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  return configurations.flatMap((configuration) => {
    const category = categoryById.get(configuration.categoryId);
    if (!category) return [];
    const count = Math.max(0, Math.floor(Number(configuration.count) || 0));
    const participantCount = Number(configuration.participantCount);
    return Array.from({ length: count }, (_, index) => ({
      id: `${category.id}-${index + 1}`,
      name: `${category.name} ${index + 1}`,
      categoryId: category.id,
      active: category.active && configuration.active,
      ...(Number.isInteger(participantCount) && participantCount > 0 ? { participantCount } : {}),
    }));
  });
}

export function buildScheduleGenerationInput(options: {
  season: Season;
  startDate: string;
  endDate: string;
  timeBlocks: readonly TimeBlock[];
  groups: readonly CampGroup[];
  activities: readonly Activity[];
  groupCategories: readonly GroupCategory[];
  activityEligibility: readonly ActivityEligibility[];
  seed: number;
}): ScheduleGenerationInput {
  return {
    season: { ...options.season },
    dates: enumerateLocalDates(options.startDate, options.endDate),
    timeBlocks: options.timeBlocks.filter((block) => block.active).map((block) => ({
      id: block.id,
      seasonId: block.seasonId,
      name: block.name,
      order: block.order,
      active: true,
      ...(block.startTime ? { startTime: block.startTime } : {}),
      ...(block.endTime ? { endTime: block.endTime } : {}),
    })),
    groups: options.groups.map((group) => ({ ...group })),
    activities: options.activities.map((activity) => ({ ...activity })),
    groupCategories: options.groupCategories.map((category) => ({ ...category })),
    activityEligibility: options.activityEligibility.map((entry) => ({ ...entry })),
    initialCycleSnapshots: [],
    history: [],
    lockedAssignments: [],
    hardConstraints: { activityAvailability: [], groupUnavailability: [] },
    seed: Number.isFinite(options.seed) ? Math.trunc(options.seed) : 0,
  };
}

export function unassignedReasonMessage(reasonCode: UnassignedReasonCode): string {
  return REASON_MESSAGES[reasonCode];
}

export function buildScheduleGrid(
  result: ScheduleGenerationResult,
  groups: readonly CampGroup[],
  categories: readonly GroupCategory[],
  activities: readonly Activity[],
  timeBlocks: readonly TimeBlock[],
): ScheduleGridView {
  const activityById = new Map(activities.map((activity) => [activity.id, activity]));
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const blockById = new Map(timeBlocks.map((block) => [block.id, block]));
  const columns = result.blocks.map<ScheduleGridColumn>(({ slot }) => {
    const block = blockById.get(slot.timeBlockId);
    return {
      key: `${slot.date}\u0000${slot.timeBlockId}`,
      date: slot.date,
      timeBlockId: slot.timeBlockId,
      label: `${slot.date} · ${block?.name ?? slot.timeBlockId}`,
      ...(block?.startTime || block?.endTime
        ? { timeLabel: `${block.startTime ?? '—'}–${block.endTime ?? '—'}` }
        : {}),
    };
  });
  const assignmentByCell = new Map<string, Assignment>(
    result.assignments.map((assignment) => [
      `${assignment.groupId}\u0000${assignment.date}\u0000${assignment.timeBlockId}`,
      assignment,
    ]),
  );
  const unassignedByCell = new Map<string, UnassignedGroup>(
    result.unassigned.flatMap(({ slot, groups: missingGroups }) =>
      missingGroups.map((unassigned) => [
        `${unassigned.groupId}\u0000${slot.date}\u0000${slot.timeBlockId}`,
        unassigned,
      ] as const),
    ),
  );
  const rows = groups
    .filter((group) => group.active)
    .map<ScheduleGridRow>((group) => ({
      group,
      categoryName: categoryById.get(group.categoryId)?.name ?? group.categoryId,
      cells: columns.map((column) => {
        const key = `${group.id}\u0000${column.key}`;
        const assignment = assignmentByCell.get(key);
        const unassigned = unassignedByCell.get(key);
        return {
          key,
          ...(assignment ? { activityName: activityById.get(assignment.activityId)?.name ?? assignment.activityId } : {}),
          ...(unassigned ? { unassignedReason: unassignedReasonMessage(unassigned.reasonCode) } : {}),
        };
      }),
    }));
  return { columns, rows };
}
