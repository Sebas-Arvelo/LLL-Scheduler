import { readEnvironment } from '../config/environment';
import { createDatabasePool, type DatabasePool, withTransaction } from './database';

export const DEMO_SEASON_ID = 'season-demo-2026';
export const DEMO_COUNTS = { seasons: 1, categories: 4, groups: 36, activities: 18, eligibility: 72, blocks: 5 } as const;

const categories = [
  ['sabana', 'Cabañas de Sabana', 12],
  ['bosque', 'Cabañas de Bosque', 12],
  ['aventura', 'Grupos de Aventura', 6],
  ['cit', 'Grupos de CIT', 6],
] as const;

const activities = [
  ['futbol-5', 'Fútbol 5', 'Deporte', 36],
  ['futbol-campo', 'Fútbol Campo', 'Deporte', 36],
  ['kickingball', 'Kickingball', 'Deporte', 36],
  ['ultimate', 'Ultimate', 'Deporte', 36],
  ['voleybol', 'Voleybol', 'Deporte', 36],
  ['arcillita', 'Arcillita', 'Excursión', 36],
  ['cascaditas', 'Cascaditas', 'Excursión', 36],
  ['periodico', 'Periódico', 'Manualidades', 36],
  ['proyecto', 'Proyecto', 'Manualidades', 36],
  ['pulseritas', 'Pulseritas', 'Manualidades', 36],
  ['tablita', 'Tablita', 'Manualidades', 36],
  ['mundialito', 'Mundialito Eliminatorias', 'Competencia', 36],
  ['hidroslide', 'Hidroslide', 'Piscina', 36],
  ['piscina', 'Piscina', 'Piscina', 36],
  ['botes', 'Botes', 'Salida', 36],
  ['caballos', 'Caballos', 'Salida', 3],
  ['ordeno', 'Ordeño', 'Salida', 36],
  ['paseo-bici', 'Paseo en Bici', 'Salida', 36],
] as const;

const blocks = [
  ['block-1', 'M1', 1, '10:00', '10:50'],
  ['block-2', 'M2', 2, '10:50', '11:40'],
  ['block-m3', 'M3', 3, '11:40', '12:30'],
  ['block-3', 'T1', 4, '14:30', '15:20'],
  ['block-4', 'T2', 5, '15:20', '16:10'],
] as const;

export async function seedDemo(pool: DatabasePool): Promise<void> {
  await withTransaction(pool, async (client) => {
    await client.query(
      `INSERT INTO seasons (id, name, start_date, end_date, active)
         VALUES ($1, $2, $3, $4, true)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name, start_date = EXCLUDED.start_date,
           end_date = EXCLUDED.end_date, active = EXCLUDED.active, updated_at = now()`,
      [DEMO_SEASON_ID, 'Temporada 2026', '2026-08-01', '2026-08-21'],
    );

    for (const [categoryId, name, groupCount] of categories) {
      await client.query(
        `INSERT INTO group_categories (id, name, active) VALUES ($1, $2, true)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, active = EXCLUDED.active, updated_at = now()`,
        [categoryId, name],
      );
      for (let index = 1; index <= groupCount; index += 1) {
        await client.query(
          `INSERT INTO camp_groups (id, season_id, category_id, name, participant_count, active)
           VALUES ($1, $2, $3, $4, 8, true)
           ON CONFLICT (id) DO UPDATE SET
             season_id = EXCLUDED.season_id, category_id = EXCLUDED.category_id,
             name = EXCLUDED.name, participant_count = EXCLUDED.participant_count,
             active = EXCLUDED.active, updated_at = now()`,
          [`${categoryId}-${index}`, DEMO_SEASON_ID, categoryId, `${name} ${index}`],
        );
      }
    }

    for (const [activityId, name, displayCategory, maxGroups] of activities) {
      await client.query(
        `INSERT INTO activities (id, name, display_category, max_groups, active)
         VALUES ($1, $2, $3, $4, true)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name, display_category = EXCLUDED.display_category,
           max_groups = EXCLUDED.max_groups, active = EXCLUDED.active, updated_at = now()`,
        [activityId, name, displayCategory, maxGroups],
      );
      for (const [categoryId] of categories) {
        await client.query(
          `INSERT INTO activity_eligibility (activity_id, group_category_id)
           VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [activityId, categoryId],
        );
      }
    }

    for (const [blockId, name, order, startTime, endTime] of blocks) {
      await client.query(
        `INSERT INTO time_blocks (id, season_id, name, sort_order, start_time, end_time, active)
         VALUES ($1, $2, $3, $4, $5, $6, true)
         ON CONFLICT (id) DO UPDATE SET
           season_id = EXCLUDED.season_id, name = EXCLUDED.name,
           sort_order = EXCLUDED.sort_order, start_time = EXCLUDED.start_time,
           end_time = EXCLUDED.end_time, active = EXCLUDED.active, updated_at = now()`,
        [blockId, DEMO_SEASON_ID, name, order, startTime, endTime],
      );
    }
  });
}

async function seedDemoCommand(): Promise<void> {
  const environment = readEnvironment();
  if (environment.nodeEnv === 'production') throw new Error('The demo seed is disabled in production.');
  const pool = createDatabasePool(environment);
  try {
    await seedDemo(pool);
    process.stdout.write(`Demo configuration seeded for ${DEMO_SEASON_ID}.\n`);
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  seedDemoCommand().catch((error: unknown) => {
    process.stderr.write(`Demo seed failed: ${error instanceof Error ? error.message : 'Unknown error'}\n`);
    process.exitCode = 1;
  });
}
