import type { ActivityEligibility, GroupCategory } from './domain';
import { DEMO_ACTIVITIES } from './activity-catalog';

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
