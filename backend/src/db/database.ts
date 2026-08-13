import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';

import type { BackendEnvironment } from '../config/environment';
import { requireDatabaseUrl } from '../config/environment';

export interface Queryable {
  query<T extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]): Promise<QueryResult<T>>;
}

export interface TransactionClient extends Queryable {
  release(): void;
}

export interface DatabasePool extends Queryable {
  connect(): Promise<TransactionClient>;
  end(): Promise<void>;
}

export function createDatabasePool(environment: BackendEnvironment): DatabasePool {
  const pool = new Pool({
    connectionString: requireDatabaseUrl(environment),
    max: 10,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    ssl: environment.databaseSsl ? { rejectUnauthorized: true } : undefined,
  });
  return pool as unknown as DatabasePool;
}

export async function withTransaction<T>(pool: DatabasePool, operation: (client: TransactionClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
