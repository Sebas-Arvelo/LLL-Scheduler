import type { ActivityEligibility, GroupCategory, Season, TimeBlock } from './domain';
import { DEMO_ACTIVITIES } from './activity-catalog';

export const DEMO_SEASON: Season = {
  id: 'season-demo-2026',
  name: 'Temporada demo 2026',
  startDate: '2026-08-01',
  endDate: '2026-08-21',
  active: true,
};

export const DEMO_GROUP_CATEGORIES: readonly GroupCategory[] = [
  { id: 'sabana', name: 'Cabañas de Sabana', active: true },
  { id: 'bosque', name: 'Cabañas de Bosque', active: true },
  { id: 'aventura', name: 'Grupos de Aventura', active: true },
  { id: 'cit', name: 'Grupos de CIT', active: true },
];

export const DEMO_ACTIVITY_ELIGIBILITY: readonly ActivityEligibility[] = DEMO_ACTIVITIES.flatMap((activity) =>
  DEMO_GROUP_CATEGORIES.map((category) => ({
    activityId: activity.id,
    groupCategoryId: category.id,
  })),
);

export const DEMO_TIME_BLOCKS: readonly TimeBlock[] = [
  {
    id: 'block-1',
    seasonId: DEMO_SEASON.id,
    name: 'Bloque 1',
    order: 1,
    startTime: '09:00',
    endTime: '10:15',
    active: true,
  },
  {
    id: 'block-2',
    seasonId: DEMO_SEASON.id,
    name: 'Bloque 2',
    order: 2,
    startTime: '10:30',
    endTime: '11:45',
    active: true,
  },
  {
    id: 'block-3',
    seasonId: DEMO_SEASON.id,
    name: 'Bloque 3',
    order: 3,
    startTime: '14:00',
    endTime: '15:15',
    active: true,
  },
  {
    id: 'block-4',
    seasonId: DEMO_SEASON.id,
    name: 'Bloque 4',
    order: 4,
    startTime: '15:30',
    endTime: '16:45',
    active: true,
  },
];
