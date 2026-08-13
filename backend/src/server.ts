import { createApp } from './app';
import { readEnvironment } from './config/environment';
import { createDatabasePool } from './db/database';
import { PgConfigRepository } from './repositories/config-repository';
import { PgScheduleRepository } from './repositories/schedule-repository';

const environment = readEnvironment();
const pool = createDatabasePool(environment);
const app = createApp({
  configRepository: new PgConfigRepository(pool),
  scheduleRepository: new PgScheduleRepository(pool),
  databaseHealth: async () => {
    await pool.query('SELECT 1');
    return true;
  },
  corsOrigin: environment.corsOrigin,
  production: environment.nodeEnv === 'production',
});

const server = app.listen(environment.port, () => {
  process.stdout.write(`LLL Scheduler API listening on http://localhost:${environment.port}\n`);
});

function shutdown(): void {
  server.close(() => {
    pool.end().finally(() => process.exit(0));
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
