import { resolve } from 'node:path';

import { config as loadEnvironment } from 'dotenv';

loadEnvironment({ path: resolve(process.cwd(), '.env'), quiet: true });

export type RuntimeEnvironment = 'development' | 'test' | 'production';

export interface BackendEnvironment {
  nodeEnv: RuntimeEnvironment;
  port: number;
  databaseUrl: string;
  databaseSsl: boolean;
  corsOrigin: string;
}

function runtimeEnvironment(value: string | undefined): RuntimeEnvironment {
  return value === 'production' || value === 'test' ? value : 'development';
}

function port(value: string | undefined): number {
  const parsed = Number(value ?? 3000);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error('BACKEND_PORT must be an integer between 1 and 65535.');
  }
  return parsed;
}

function boolean(value: string | undefined): boolean {
  if (value === undefined || value === '') return false;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error('DATABASE_SSL must be true or false.');
}

export function readEnvironment(source: NodeJS.ProcessEnv = process.env): BackendEnvironment {
  return {
    nodeEnv: runtimeEnvironment(source['NODE_ENV']),
    port: port(source['BACKEND_PORT']),
    databaseUrl: source['DATABASE_URL']?.trim() ?? '',
    databaseSsl: boolean(source['DATABASE_SSL']),
    corsOrigin: source['CORS_ORIGIN']?.trim() || 'http://localhost:4200',
  };
}

export function requireDatabaseUrl(environment: BackendEnvironment): string {
  if (!environment.databaseUrl) {
    throw new Error('DATABASE_URL is required. Copy .env.example to .env and configure a local PostgreSQL database.');
  }
  return environment.databaseUrl;
}
