import { readEnvironment } from '../config/environment';
import { createDatabasePool, withTransaction } from './database';

const SEASON_ID = 'season-demo-2026';

const categories = [
  ['sabana', 'Cabañas de Sabana', 12],
  ['bosque', 'Cabañas de Bosque', 12],
  ['aventura', 'Grupos de Aventura', 6],
  ['cit', 'Grupos de CIT', 6],
] as const;

const activities = [
  ['futbol-5', 'Deporte: Fútbol 5', 'Deporte', 36],
  ['futbol-campo', 'Deporte: Fútbol Campo', 'Deporte', 36],
  ['kickingball', 'Deporte: Kickingball', 'Deporte', 36],
  ['ultimate', 'Deporte: Ultimate', 'Deporte', 36],
  ['voleybol', 'Deporte: Voleybol', 'Deporte', 36],
  ['arcillita', 'Excursión: Arcillita', 'Excursión', 36],
  ['cascaditas', 'Excursión: Cascaditas', 'Excursión', 36],
  ['periodico', 'Manualidades: Periódico', 'Manualidades', 36],
  ['proyecto', 'Manualidades: Proyecto', 'Manualidades', 36],
  ['pulseritas', 'Manualidades: Pulseritas', 'Manualidades', 36],
  ['tablita', 'Manualidades: Tablita', 'Manualidades', 36],
  ['mundialito', 'Mundialito Eliminatorias', 'Competencia', 36],
  ['hidroslide', 'Piscina: Hidroslide', 'Piscina', 36],
  ['piscina', 'Piscina: Piscina', 'Piscina', 36],
  ['botes', 'Salida: Botes', 'Salida', 36],
  ['caballos', 'Salida: Caballos', 'Salida', 3],
  ['ordeno', 'Salida: Ordeño', 'Salida', 36],
  ['paseo-bici', 'Salida: Paseo en Bici', 'Salida', 36],
] as const;

const blocks = [
  ['block-1', 'Bloque 1', 1, '09:00', '10:15'],
  ['block-2', 'Bloque 2', 2, '10:30', '11:45'],
  ['block-3', 'Bloque 3', 3, '14:00', '15:15'],
  ['block-4', 'Bloque 4', 4, '15:30', '16:45'],
] as const;

async function seedDemo(): Promise<void> {
  const environment = readEnvironment();
  if (environment.nodeEnv === 'production') throw new Error('The demo seed is disabled in production.');
  const pool = createDatabasePool(environment);
  try {
    await withTransaction(pool, async (client) => {
      await client.query(
        `INSERT INTO seasons (id, name, start_date, end_date, active)
         VALUES ($1, $2, $3, $4, true)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name, start_date = EXCLUDED.start_date,
           end_date = EXCLUDED.end_date, active = EXCLUDED.active, updated_at = now()`,
        [SEASON_ID, 'Temporada demo 2026', '2026-08-01', '2026-08-21'],
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
             VALUES ($1, $2, $3, $4, 10, true)
             ON CONFLICT (id) DO UPDATE SET
               season_id = EXCLUDED.season_id, category_id = EXCLUDED.category_id,
               name = EXCLUDED.name, participant_count = EXCLUDED.participant_count,
               active = EXCLUDED.active, updated_at = now()`,
            [`${categoryId}-${index}`, SEASON_ID, categoryId, `${name} ${index}`],
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
          [blockId, SEASON_ID, name, order, startTime, endTime],
        );
      }
    });
    process.stdout.write(`Demo configuration seeded for ${SEASON_ID}.\n`);
  } finally {
    await pool.end();
  }
}

seedDemo().catch((error: unknown) => {
  process.stderr.write(`Demo seed failed: ${error instanceof Error ? error.message : 'Unknown error'}\n`);
  process.exitCode = 1;
});
