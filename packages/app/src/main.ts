import { ConfigError, loadConfig } from './config.js';
import { openDatabase } from './db/connection.js';
import { SqliteHistoryStore } from './db/historyStore.js';
import { migrate } from './db/migrate.js';
import { buildServer } from './server.js';

let config;
try {
  config = loadConfig();
} catch (error) {
  if (error instanceof ConfigError) {
    console.error(error.message);
    process.exit(1);
  }
  throw error;
}

const db = openDatabase(config.databasePath);
const migration = migrate(db);
const store = new SqliteHistoryStore(db);
const app = await buildServer({ config, db, store });

app.log.info({ databasePath: config.databasePath, schemaVersion: migration.version, applied: migration.applied }, 'database ready');
app.log.info(
  { enabled: config.shortLinkExpansionEnabled, timeoutMs: config.shortLinkTimeoutMs },
  config.shortLinkExpansionEnabled ? 'short link expansion enabled: the server will fetch 1drv.ms links' : 'short link expansion disabled: no outbound requests',
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
