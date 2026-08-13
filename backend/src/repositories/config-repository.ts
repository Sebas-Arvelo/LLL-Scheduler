import type { SeasonConfiguration } from '../contracts';
import type { DatabasePool } from '../db/database';

export interface ConfigRepository {
  getSeasonConfiguration(seasonId: string): Promise<SeasonConfiguration | undefined>;
}

function dateValue(value: unknown): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value);
}

function timeValue(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  return String(value).slice(0, 5);
}

export class PgConfigRepository implements ConfigRepository {
  constructor(private readonly pool: DatabasePool) {}

  async getSeasonConfiguration(seasonId: string): Promise<SeasonConfiguration | undefined> {
    const seasonResult = await this.pool.query<{
      id: string;
      name: string;
      start_date: unknown;
      end_date: unknown;
      active: boolean;
    }>('SELECT id, name, start_date, end_date, active FROM seasons WHERE id = $1', [seasonId]);
    const season = seasonResult.rows[0];
    if (!season) return undefined;

    const [categoriesResult, groupsResult, activitiesResult, eligibilityResult, blocksResult] = await Promise.all([
      this.pool.query<{ id: string; name: string; active: boolean }>(
        'SELECT id, name, active FROM group_categories ORDER BY name, id',
      ),
      this.pool.query<{
        id: string;
        name: string;
        category_id: string;
        active: boolean;
        participant_count: number | null;
      }>(
        `SELECT id, name, category_id, active, participant_count
         FROM camp_groups WHERE season_id = $1 ORDER BY category_id, name, id`,
        [seasonId],
      ),
      this.pool.query<{
        id: string;
        name: string;
        active: boolean;
        max_groups: number;
        max_participants: number | null;
        display_category: string | null;
        description: string | null;
      }>(
        `SELECT id, name, active, max_groups, max_participants, display_category, description
         FROM activities ORDER BY display_category NULLS LAST, name, id`,
      ),
      this.pool.query<{ activity_id: string; group_category_id: string }>(
        `SELECT activity_id, group_category_id
         FROM activity_eligibility ORDER BY activity_id, group_category_id`,
      ),
      this.pool.query<{
        id: string;
        season_id: string;
        name: string;
        sort_order: number;
        start_time: unknown;
        end_time: unknown;
        active: boolean;
      }>(
        `SELECT id, season_id, name, sort_order, start_time, end_time, active
         FROM time_blocks WHERE season_id = $1 ORDER BY sort_order, id`,
        [seasonId],
      ),
    ]);

    return {
      season: {
        id: season.id,
        name: season.name,
        startDate: dateValue(season.start_date),
        endDate: dateValue(season.end_date),
        active: season.active,
      },
      categories: categoriesResult.rows,
      groups: groupsResult.rows.map((group) => ({
        id: group.id,
        name: group.name,
        categoryId: group.category_id,
        active: group.active,
        ...(group.participant_count !== null ? { participantCount: group.participant_count } : {}),
      })),
      activities: activitiesResult.rows.map((activity) => ({
        id: activity.id,
        name: activity.name,
        active: activity.active,
        maxGroups: activity.max_groups,
        ...(activity.max_participants !== null ? { maxParticipants: activity.max_participants } : {}),
        ...(activity.display_category !== null ? { displayCategory: activity.display_category } : {}),
        ...(activity.description !== null ? { description: activity.description } : {}),
      })),
      eligibility: eligibilityResult.rows.map((entry) => ({
        activityId: entry.activity_id,
        groupCategoryId: entry.group_category_id,
      })),
      timeBlocks: blocksResult.rows.map((block) => ({
        id: block.id,
        seasonId: block.season_id,
        name: block.name,
        order: block.sort_order,
        active: block.active,
        ...(timeValue(block.start_time) ? { startTime: timeValue(block.start_time) } : {}),
        ...(timeValue(block.end_time) ? { endTime: timeValue(block.end_time) } : {}),
      })),
    };
  }
}
