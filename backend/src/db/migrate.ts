import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

import { readEnvironment } from '../config/environment';
import { createDatabasePool, type DatabasePool, withTransaction } from './database';

export interface MigrationResult {
  applied: readonly string[];
  skipped: readonly string[];
}

export async function runMigrations(
  pool: DatabasePool,
  migrationDirectory = resolve(process.cwd(), 'backend/src/db/migrations'),
): Promise<MigrationResult> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  const appliedResult = await pool.query<{ name: string }>('SELECT name FROM schema_migrations');
  const previouslyApplied = new Set(appliedResult.rows.map((row) => row.name));
  const files = (await readdir(migrationDirectory)).filter((name) => name.endsWith('.sql')).sort();
  const applied: string[] = [];

  for (const file of files) {
    if (previouslyApplied.has(file)) continue;
    const sql = await readFile(resolve(migrationDirectory, file), 'utf8');
    await withTransaction(pool, async (client) => {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
    });
    applied.push(file);
  }

  return {
    applied,
    skipped: files.filter((file) => previouslyApplied.has(file)),
  };
}

async function migrate(): Promise<void> {
  const pool = createDatabasePool(readEnvironment());
  try {
    const result = await runMigrations(pool);
    for (const file of result.applied) {
      process.stdout.write(`Applied ${file}\n`);
    }
    process.stdout.write(result.applied.length === 0 ? 'Database is already up to date.\n' : 'Migrations complete.\n');
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  migrate().catch((error: unknown) => {
    process.stderr.write(`Migration failed: ${error instanceof Error ? error.message : 'Unknown error'}\n`);
    process.exitCode = 1;
  });
}
