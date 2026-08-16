import type { ActivityEligibility, GroupCategory, Season, TimeBlock } from './domain';
import { DEMO_ACTIVITIES } from './activity-catalog';

export const DEMO_SEASON: Season = {
  id: 'season-demo-2026',
  name: 'Temporada 2026',
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
    name: 'M1',
    order: 1,
    startTime: '10:00',
    endTime: '10:50',
    active: true,
  },
  {
    id: 'block-2',
    seasonId: DEMO_SEASON.id,
    name: 'M2',
    order: 2,
    startTime: '10:50',
    endTime: '11:40',
    active: true,
  },
  {
    id: 'block-m3',
    seasonId: DEMO_SEASON.id,
    name: 'M3',
    order: 3,
    startTime: '11:40',
    endTime: '12:30',
    active: true,
  },
  {
    id: 'block-3',
    seasonId: DEMO_SEASON.id,
    name: 'T1',
    order: 4,
    startTime: '14:30',
    endTime: '15:20',
    active: true,
  },
  {
    id: 'block-4',
    seasonId: DEMO_SEASON.id,
    name: 'T2',
    order: 5,
    startTime: '15:20',
    endTime: '16:10',
    active: true,
  },
];
