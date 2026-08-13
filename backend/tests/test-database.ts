const LOCAL_DATABASE_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

function databaseIdentity(url: URL): string {
  const host = LOCAL_DATABASE_HOSTS.has(url.hostname) ? 'localhost' : url.hostname;
  const port = url.port || '5432';
  return `${host}:${port}/${decodeURIComponent(url.pathname.replace(/^\//, ''))}`;
}

export function requireSafeTestDatabaseUrl(source: NodeJS.ProcessEnv = process.env): string {
  const testDatabaseUrl = source['TEST_DATABASE_URL']?.trim();
  if (!testDatabaseUrl) throw new Error('TEST_DATABASE_URL is required for PostgreSQL integration tests.');

  let parsed: URL;
  try {
    parsed = new URL(testDatabaseUrl);
  } catch {
    throw new Error('TEST_DATABASE_URL must be a valid PostgreSQL URL.');
  }
  if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
    throw new Error('TEST_DATABASE_URL must use the postgresql protocol.');
  }
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!databaseName.endsWith('_test')) {
    throw new Error('The integration database name must end with _test.');
  }
  if (!LOCAL_DATABASE_HOSTS.has(parsed.hostname)) {
    throw new Error('Phase 6.5 integration tests accept only a local PostgreSQL host.');
  }

  const developmentUrl = source['DATABASE_URL']?.trim();
  if (developmentUrl) {
    let parsedDevelopment: URL;
    try {
      parsedDevelopment = new URL(developmentUrl);
    } catch {
      throw new Error('DATABASE_URL must be valid before its separation from TEST_DATABASE_URL can be checked.');
    }
    if (databaseIdentity(parsedDevelopment) === databaseIdentity(parsed)) {
      throw new Error('TEST_DATABASE_URL must not be the same database as DATABASE_URL.');
    }
  }

  return testDatabaseUrl;
}
