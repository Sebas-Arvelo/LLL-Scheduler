import { Assignment, CampActivity, CampGroup, DailyPlan } from './models';

interface GroupCycleState {
  order: CampActivity[];
  usedActivityIds: Set<string>;
}

function createSeededRandom(seed: number): () => number {
  let value = seed >>> 0;

  return () => {
    value += 0x6D2B79F5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], seed: number): T[] {
  const random = createSeededRandom(seed);
  const copy = [...items];

  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }

  return copy;
}

function rotate<T>(items: T[], offset: number): T[] {
  if (items.length === 0) {
    return [];
  }

  const normalizedOffset = offset % items.length;
  return [...items.slice(normalizedOffset), ...items.slice(0, normalizedOffset)];
}

function buildCycleState(activities: CampActivity[], seed: number, groupIndex: number): GroupCycleState {
  const shuffled = shuffle(activities, seed + groupIndex * 17);
  return {
    order: rotate(shuffled, groupIndex),
    usedActivityIds: new Set<string>(),
  };
}

function pickActivity(state: GroupCycleState, activities: CampActivity[], dayLoad: Map<string, number>): CampActivity {
  const remainingInCycle = state.order.filter((activity) => !state.usedActivityIds.has(activity.id));
  const candidates = remainingInCycle.length > 0 ? remainingInCycle : state.order;

  for (const candidate of candidates) {
    const usedToday = dayLoad.get(candidate.id) ?? 0;
    if (usedToday < candidate.capacity) {
      state.usedActivityIds.add(candidate.id);
      return candidate;
    }
  }

  const fallback = [...activities].sort((left, right) => {
    const leftRemaining = left.capacity - (dayLoad.get(left.id) ?? 0);
    const rightRemaining = right.capacity - (dayLoad.get(right.id) ?? 0);
    return rightRemaining - leftRemaining;
  })[0];

  state.usedActivityIds.add(fallback.id);
  return fallback;
}

export function buildSchedule(groups: CampGroup[], activities: CampActivity[], days: number, seed: number): DailyPlan[] {
  const activeActivities = activities.filter((activity) => activity.enabled);
  if (groups.length === 0 || activeActivities.length === 0 || days <= 0) {
    return [];
  }

  const normalizedActivities = activeActivities.map((activity) => ({
    ...activity,
    capacity: Math.max(1, Math.floor(activity.capacity || groups.length)),
  }));

  const groupStates = groups.map((group, index) => ({
    group,
    state: buildCycleState(normalizedActivities, seed, index),
  }));

  const plans: DailyPlan[] = [];

  for (let day = 1; day <= days; day += 1) {
    const dayLoad = new Map<string, number>();
    const assignments: Assignment[] = [];

    for (const { group, state } of groupStates) {
      const activity = pickActivity(state, normalizedActivities, dayLoad);
      dayLoad.set(activity.id, (dayLoad.get(activity.id) ?? 0) + 1);
      assignments.push({ group, activity });

      if (state.usedActivityIds.size === normalizedActivities.length) {
        state.usedActivityIds.clear();
      }
    }

    plans.push({ day, assignments });
  }

  return plans;
}
