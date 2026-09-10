import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PARSER_VERSION, parseLink, type ParseFailure, type ParseSuccess } from '../src/index.js';

interface Fixture {
  title: string;
  row: string;
  input: string;
  expected: Record<string, unknown> & { ok: boolean };
}

const FIXTURES_DIR = join(import.meta.dirname, '..', 'fixtures');

function listFixtures(dir: string): string[] {
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

const fixtureFiles = listFixtures(FIXTURES_DIR);

describe('fixture corpus', () => {
  it('has at least one fixture', () => {
    expect(fixtureFiles.length).toBeGreaterThan(0);
  });

  for (const file of fixtureFiles) {
    const name = relative(FIXTURES_DIR, file).replaceAll('\\', '/');
    const fixture = JSON.parse(readFileSync(file, 'utf8')) as Fixture;

    it(`${name}: ${fixture.title}`, () => {
      const result = parseLink(fixture.input);
      expect(result.parserVersion).toBe(PARSER_VERSION);

      if (fixture.expected.ok) {
        expect(result.ok).toBe(true);
        const { original, parserVersion: _v, ...comparable } = result as ParseSuccess;
        expect(original).toBe(fixture.input.trim());
        expect(comparable).toEqual(fixture.expected);
      } else {
        expect(result.ok).toBe(false);
        const failure = result as ParseFailure;
        expect(failure.reason).toBe(fixture.expected['reason']);
        expect(failure.message.length).toBeGreaterThan(0);
        if (fixture.expected['detail'] !== undefined) {
          expect(failure.detail).toEqual(fixture.expected['detail']);
        }
      }
    });
  }
});
