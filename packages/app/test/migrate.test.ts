import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../src/db/connection.js';
import { loadMigrations, migrate } from '../src/db/migrate.js';

describe('migrations (BC-029)', () => {
  it('creates the schema on an empty database and applies nothing on a second run', () => {
    const db = openDatabase(':memory:');
    const first = migrate(db);
    expect(first.applied).toEqual([1, 2, 3]);
    expect(first.version).toBe(3);

    const second = migrate(db);
    expect(second.applied).toEqual([]);
    expect(second.version).toBe(3);

    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]).map(
      (r) => r.name,
    );
    expect(tables).toEqual(['conversions', 'schema_migrations', 'validations']);
    db.close();
  });

  it('rolls back a failing migration and leaves the version unchanged', () => {
    const db = openDatabase(':memory:');
    migrate(db);
    expect(() => migrate(db, [{ version: 4, name: 'broken', sql: 'CREATE TABLE ok (id INTEGER); CREATE TABLE ok (id INTEGER);' }])).toThrow(
      /Migration 4 \(broken\) failed/,
    );
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'ok'").all() as unknown[]).length;
    expect(tables).toBe(0);
    expect(migrate(db).version).toBe(3);
    db.close();
  });

  it('loads migrations in version order from the migrations directory', () => {
    const migrations = loadMigrations();
    expect(migrations.map((m) => m.version)).toEqual([...migrations.map((m) => m.version)].sort((a, b) => a - b));
    expect(migrations[0]).toMatchObject({ version: 1, name: 'conversions' });
  });

  it('only db/ imports the SQLite driver (invariant 10)', () => {
    const srcDir = join(import.meta.dirname, '..', 'src');
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.name.endsWith('.ts') && !full.includes(`${join('src', 'db')}${'\\'}`) && !full.includes(`${join('src', 'db')}/`)) {
          if (/node:sqlite/.test(readFileSync(full, 'utf8'))) {
            offenders.push(full);
          }
        }
      }
    };
    walk(srcDir);
    expect(offenders).toEqual([]);
  });
});
