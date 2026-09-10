/**
 * Versioned schema migrations (BC-029, invariant 11). Each migration is a
 * numbered SQL file in ./migrations, applied once, in order, inside a
 * transaction, and recorded in schema_migrations.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Database } from './connection.js';

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

const FILE_PATTERN = /^(\d+)_(.+)\.sql$/;

export const MIGRATIONS_DIR = fileURLToPath(new URL('./migrations/', import.meta.url));

/** Reads every `NNNN_name.sql` file in `dir`, sorted by version. */
export function loadMigrations(dir: string = MIGRATIONS_DIR): Migration[] {
  const migrations: Migration[] = [];
  for (const file of readdirSync(dir)) {
    const match = FILE_PATTERN.exec(file);
    if (match === null) {
      continue;
    }
    migrations.push({
      version: Number(match[1]),
      name: match[2] ?? '',
      sql: readFileSync(new URL(file, `file://${dir.replaceAll('\\', '/')}`), 'utf8'),
    });
  }
  migrations.sort((a, b) => a.version - b.version);
  const seen = new Set<number>();
  for (const m of migrations) {
    if (seen.has(m.version)) {
      throw new Error(`Duplicate migration version ${m.version}`);
    }
    seen.add(m.version);
  }
  return migrations;
}

export interface MigrationResult {
  /** Versions applied by this run, in order. Empty when already current. */
  applied: number[];
  /** Schema version after the run. */
  version: number;
}

/** Applies every migration above the current version. Safe to run on every start. */
export function migrate(db: Database, migrations: readonly Migration[] = loadMigrations()): MigrationResult {
  db.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)',
  );
  const row = db.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations').get() as { version: number };
  let current = row.version;
  const applied: number[] = [];
  const record = db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)');

  for (const migration of migrations) {
    if (migration.version <= current) {
      continue;
    }
    db.exec('BEGIN');
    try {
      db.exec(migration.sql);
      record.run(migration.version, migration.name, new Date().toISOString());
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw new Error(`Migration ${migration.version} (${migration.name}) failed: ${String(error)}`, { cause: error });
    }
    current = migration.version;
    applied.push(migration.version);
  }
  return { applied, version: current };
}
