/**
 * BC-042: the fixture corpus run through the extension's popup model gives
 * results identical to the server, because both consume the one parser.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildRows } from '../src/popupModel.js';

const FIXTURES = join(import.meta.dirname, '..', '..', 'parser', 'fixtures');

interface Fixture {
  title: string;
  input: string;
  expected: Record<string, unknown> & { ok: boolean };
}

function list(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...list(full));
    else if (entry.name.endsWith('.json')) out.push(full);
  }
  return out.sort();
}

describe('fixture corpus through the popup model', () => {
  const files = list(FIXTURES);
  it('finds the corpus', () => {
    expect(files.length).toBeGreaterThan(30);
  });
  for (const file of files) {
    const fixture = JSON.parse(readFileSync(file, 'utf8')) as Fixture;
    it(`${relative(FIXTURES, file).replaceAll('\\', '/')}: ${fixture.title}`, () => {
      const [row] = buildRows([{ url: fixture.input }]);
      expect(row).toBeDefined();
      if (row === undefined) return;
      if (fixture.expected.ok) {
        expect(row.result.ok).toBe(true);
        if (!row.result.ok) return;
        const { original: _o, parserVersion: _v, ...comparable } = row.result;
        expect(comparable).toEqual(fixture.expected);
        expect(row.state).toBe(fixture.expected['state']);
      } else {
        expect(row.result.ok).toBe(false);
        expect(row.state).toBe('failed');
        if (!row.result.ok) expect(row.result.reason).toBe(fixture.expected['reason']);
      }
    });
  }
});
