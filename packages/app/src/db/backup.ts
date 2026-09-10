/**
 * Online backup (BC-048) through SQLite's backup API, so a consistent copy
 * is produced while the application keeps running. Lives in db/ because it
 * is the second and last place that touches the driver (invariant 10).
 */
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';

export interface BackupResult {
  destination: string;
  /** Rows in the conversions table of the copy, for the operator to compare. */
  conversions: number;
}

/** Copies the database at `sourcePath` to `destinationPath` and reports the copied row count. */
export async function backupDatabase(sourcePath: string, destinationPath: string): Promise<BackupResult> {
  mkdirSync(dirname(destinationPath), { recursive: true });
  const source = new DatabaseSync(sourcePath, { readOnly: true });
  try {
    await backup(source, destinationPath);
  } finally {
    source.close();
  }
  const copy = new DatabaseSync(destinationPath, { readOnly: true });
  try {
    const row = copy.prepare('SELECT COUNT(*) AS n FROM conversions').get() as { n: number };
    return { destination: destinationPath, conversions: row.n };
  } finally {
    copy.close();
  }
}
