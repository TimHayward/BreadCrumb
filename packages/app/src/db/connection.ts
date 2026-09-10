/**
 * The only module that imports the SQLite driver (invariant 10). Decision
 * D2 chose the Node built-in module; swapping drivers touches this file only.
 */
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type Database = DatabaseSync;

/**
 * Opens (creating if needed) the database at `path`, in write ahead logging
 * mode with a busy timeout. `:memory:` gives a private in-memory database.
 */
export function openDatabase(path: string): Database {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new DatabaseSync(path);
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec('PRAGMA foreign_keys = ON');
  return db;
}

/** True when an error is SQLite reporting the database is busy or locked. */
export function isBusyError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const e = error as { code?: unknown; errcode?: unknown; message?: unknown };
  const errcode = typeof e.errcode === 'number' ? e.errcode & 0xff : undefined;
  return errcode === 5 || errcode === 6 || /SQLITE_BUSY|SQLITE_LOCKED|database is locked/i.test(String(e.message));
}
