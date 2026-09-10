import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface Fixture {
  title: string;
  row: string;
  input: string;
  expected: Record<string, unknown> & { ok: boolean };
}

/** Every row of the link form matrix in BACKLOG.md section 4 (BC-022). */
export const MATRIX_ROWS = ['1', '1b', '2', '3a', '3b', '3c', '3d', '4', '5', '5b', '6', '7a', '7b', '8', '9', '10', '11', '12', '13', '14'];

export const FIXTURES_DIR = join(import.meta.dirname, '..', 'fixtures');

export function listFixtures(dir: string = FIXTURES_DIR): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFixtures(full));
    } else if (entry.isFile() && entry.name.endsWith('.json')) {
      files.push(full);
    }
  }
  return files.sort();
}

export function loadFixture(file: string): Fixture {
  return JSON.parse(readFileSync(file, 'utf8')) as Fixture;
}
