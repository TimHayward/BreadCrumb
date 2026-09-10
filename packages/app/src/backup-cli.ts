// Usage: node dist/backup-cli.js <destination.sqlite>
// Takes a consistent online copy of DATABASE_PATH (BC-048).
import { backupDatabase } from './db/backup.js';
import { ConfigError, loadConfig } from './config.js';

const destination = process.argv[2];
if (destination === undefined || destination === '') {
  console.error('usage: node dist/backup-cli.js <destination.sqlite>');
  process.exit(2);
}

let source: string;
try {
  source = loadConfig(process.env, () => {}).databasePath;
} catch (error) {
  console.error(error instanceof ConfigError ? error.message : String(error));
  process.exit(1);
}

try {
  const result = await backupDatabase(source, destination);
  console.log(`backup written to ${result.destination} (${result.conversions} conversions)`);
} catch (error) {
  console.error(`backup failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
