import type {
  Activity,
  ActivityEligibility,
  CampGroup,
  GroupCategory,
  ScheduleGenerationInput,
  Season,
  TimeBlock,
} from '../../index';

export type RealisticScenarioKind = 'standard' | 'participant-capacities' | 'scarce';

const CATEGORY_SIZES = [
  ['sabana', 'Sabana', 12],
  ['bosque', 'Bosque', 12],
  ['aventura', 'Aventura', 6],
  ['cit', 'CIT', 6],
] as const;

export const REALISTIC_GROUP_CATEGORIES: readonly GroupCategory[] = CATEGORY_SIZES.map(([id, name]) => ({
  id,
  name,
  active: true,
}));

export const REALISTIC_GROUPS: readonly CampGroup[] = CATEGORY_SIZES.flatMap(([categoryId, name, count]) =>
  Array.from({ length: count }, (_, index) => ({
    id: `${categoryId}-${index + 1}`,
    name: `${name} ${index + 1}`,
    categoryId,
    active: true,
    participantCount: 8 + ((index + categoryId.length) % 5),
  })),
);

const ACTIVITY_IDS = [
  'futbol-5',
  'futbol-campo',
  'kickingball',
  'ultimate',
  'voleybol',
  'arcillita',
  'cascaditas',
  'periodico',
  'proyecto',
  'pulseritas',
  'tablita',
  'mundialito',
  'hidroslide',
  'piscina',
  'botes',
  'caballos',
  'ordeno',
  'paseo-bici',
] as const;

function activitiesFor(kind: RealisticScenarioKind): readonly Activity[] {
  return ACTIVITY_IDS.map((id, index) => ({
    id,
    name: id,
    active: true,
    maxGroups: kind === 'scarce' ? 2 : 3,
    ...(kind === 'participant-capacities' && index % 3 === 0 ? { maxParticipants: 29 } : {}),
  }));
}

function eligibilityFor(activities: readonly Activity[]): readonly ActivityEligibility[] {
  return activities.flatMap((activity) =>
    REALISTIC_GROUP_CATEGORIES.map((category) => ({
      activityId: activity.id,
      groupCategoryId: category.id,
    })),
  );
}

export function createRealisticScheduleInput(
  kind: RealisticScenarioKind,
  options: { dayCount?: number; blockCount?: number; seed?: number } = {},
): ScheduleGenerationInput {
  const dayCount = options.dayCount ?? 1;
  const blockCount = options.blockCount ?? 1;
  const season: Season = {
    id: 'benchmark-season',
    name: 'Benchmark season',
    startDate: '2026-08-01',
    endDate: '2026-08-31',
    active: true,
  };
  const dates = Array.from({ length: dayCount }, (_, index) => `2026-08-${String(index + 1).padStart(2, '0')}`);
  const timeBlocks: TimeBlock[] = Array.from({ length: blockCount }, (_, index) => ({
    id: `block-${index + 1}`,
    seasonId: season.id,
    name: `Block ${index + 1}`,
    order: index + 1,
    active: true,
  }));
  const activities = activitiesFor(kind);

  return {
    season,
    dates,
    timeBlocks,
    groups: REALISTIC_GROUPS,
    activities,
    groupCategories: REALISTIC_GROUP_CATEGORIES,
    activityEligibility: eligibilityFor(activities),
    initialCycleSnapshots: [],
    history: [],
    lockedAssignments: [],
    hardConstraints: { activityAvailability: [], groupUnavailability: [] },
    seed: options.seed ?? 2026,
  };
}
