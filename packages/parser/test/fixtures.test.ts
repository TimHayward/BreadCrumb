import { relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PARSER_VERSION, parseLink, type ParseFailure, type ParseSuccess } from '../src/index.js';
import { FIXTURES_DIR, MATRIX_ROWS, listFixtures, loadFixture } from './corpus.js';

const fixtureFiles = listFixtures();

describe('fixture corpus', () => {
  it('has at least one fixture for every link form matrix row (BC-022)', () => {
    const rows = new Set(fixtureFiles.map((f) => loadFixture(f).row));
    const missing = MATRIX_ROWS.filter((row) => !rows.has(row));
    expect(missing).toEqual([]);
  });

  it('every fixture names a known matrix row and states an expected state or reason', () => {
    for (const file of fixtureFiles) {
      const fixture = loadFixture(file);
      expect(MATRIX_ROWS, `${file} row`).toContain(fixture.row);
      if (fixture.expected.ok) {
        expect(fixture.expected['state'], `${file} state`).toMatch(/^(Verified|Derived|Inferred|Unresolved)$/);
        const components = fixture.expected['components'] as Record<string, { flag?: string }>;
        for (const [name, component] of Object.entries(components)) {
          expect(component.flag, `${file} ${name} flag`).toMatch(/^(Derived|Inferred)$/);
        }
      } else {
        expect(typeof fixture.expected['reason'], `${file} reason`).toBe('string');
      }
    }
  });

  for (const file of fixtureFiles) {
    const name = relative(FIXTURES_DIR, file).replaceAll('\\', '/');
    const fixture = loadFixture(file);

    it(`${name}: ${fixture.title}`, () => {
      const result = parseLink(fixture.input);
      expect(result.parserVersion).toBe(PARSER_VERSION);

      if (fixture.expected.ok) {
        expect(result.ok, (result as ParseFailure).message).toBe(true);
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
