import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

import { readEnvironment } from '../config/environment';
import { createDatabasePool, withTransaction } from './database';

async function migrate(): Promise<void> {
  const pool = createDatabasePool(readEnvironment());
  const migrationDirectory = resolve(process.cwd(), 'backend/src/db/migrations');
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    const appliedResult = await pool.query<{ name: string }>('SELECT name FROM schema_migrations');
    const applied = new Set(appliedResult.rows.map((row) => row.name));
    const files = (await readdir(migrationDirectory)).filter((name) => name.endsWith('.sql')).sort();

    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = await readFile(resolve(migrationDirectory, file), 'utf8');
      await withTransaction(pool, async (client) => {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      });
      process.stdout.write(`Applied ${file}\n`);
    }
    process.stdout.write(files.every((file) => applied.has(file)) ? 'Database is already up to date.\n' : 'Migrations complete.\n');
  } finally {
    await pool.end();
  }
}

migrate().catch((error: unknown) => {
  process.stderr.write(`Migration failed: ${error instanceof Error ? error.message : 'Unknown error'}\n`);
  process.exitCode = 1;
});
