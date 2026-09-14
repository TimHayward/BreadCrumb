import { readFileSync } from 'node:fs';
import { ConfigError, loadConfig, type AppConfig } from './config.js';
import { openDatabase } from './db/connection.js';
import { SqliteHistoryStore } from './db/historyStore.js';
import { migrate } from './db/migrate.js';
import { buildServer } from './server.js';

let config: AppConfig;
try {
  config = loadConfig();
} catch (error) {
  if (error instanceof ConfigError) {
    console.error(error.message);
    process.exit(1);
  }
  throw error;
}

/** Reads a PEM file named by an environment variable, or stops with a message naming it. */
function readPem(variable: string, path: string): Buffer {
  try {
    return readFileSync(path);
  } catch (error) {
    console.error(`Configuration error: ${variable} cannot be read (got "${path}"): ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

const https = config.tls === undefined ? undefined : { cert: readPem('TLS_CERT_FILE', config.tls.certFile), key: readPem('TLS_KEY_FILE', config.tls.keyFile) };

const db = openDatabase(config.databasePath);
const migration = migrate(db);
const store = new SqliteHistoryStore(db);
// Entries stored before migration 3 get their document key from the stored result (once).
const backfilled = store.backfillDocumentKeys();
const app = await buildServer({ config, db, store, ...(https !== undefined ? { https } : {}) });

app.log.info({ databasePath: config.databasePath, schemaVersion: migration.version, applied: migration.applied, documentKeysBackfilled: backfilled }, 'database ready');
app.log.info(
  https === undefined ? { scheme: 'http' } : { scheme: 'https', certFile: config.tls?.certFile },
  https === undefined ? 'serving plain HTTP (sign in works only on localhost)' : 'serving HTTPS',
);
if (config.auth === undefined) {
  app.log.info('authenticated validation is not configured (AUTH_TENANT_ID and AUTH_CLIENT_ID unset); the sign in control is hidden');
} else {
  app.log.info({ tenantId: config.auth.tenantId, scopes: config.auth.scopes }, 'authenticated validation configured; Graph tokens stay in the browser session');
}

const shutdown = async (signal: string): Promise<void> => {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  db.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ port: config.port, host: '0.0.0.0' });
