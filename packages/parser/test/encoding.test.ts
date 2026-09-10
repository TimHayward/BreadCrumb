import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DecodeError, buildUrl, decodePercent, encodePath, encodeSegment, parseQuery } from '../src/encoding.js';

describe('decodePercent (BC-009)', () => {
  it('decodes %20, %2D and %2E to space, hyphen and full stop', () => {
    expect(decodePercent('a%20b%2Dc%2Ed', 'id')).toBe('a b-c.d');
  });

  it('decodes mixed case hex identically', () => {
    expect(decodePercent('%2d%2e%c3%a9', 'id')).toBe(decodePercent('%2D%2E%C3%A9', 'id'));
  });

  it('keeps a literal plus sign', () => {
    expect(decodePercent('a+b', 'id')).toBe('a+b');
  });

  it('throws DecodeError naming the parameter for a cut off escape', () => {
    expect(() => decodePercent('abc%2', 'parent')).toThrowError(DecodeError);
    try {
      decodePercent('abc%2', 'parent');
    } catch (error) {
      expect((error as DecodeError).parameter).toBe('parent');
    }
  });
});

describe('parseQuery', () => {
  it('lower cases keys and decodes values once', () => {
    const q = parseQuery('?RootFolder=%2Fa%20b&viewid=X');
    expect(q.get('rootfolder')).toBe('/a b');
    expect(q.get('viewid')).toBe('X');
  });

  it('keeps the first value when a key repeats', () => {
    expect(parseQuery('id=first&id=second').get('id')).toBe('first');
  });

  it('does not turn plus into space', () => {
    expect(parseQuery('id=a%2Bb+c').get('id')).toBe('a+b+c');
  });
});

describe('encodeSegment and encodePath (BC-009)', () => {
  it('encodes space as %20 and leaves hyphen and full stop literal', () => {
    expect(encodeSegment('Deloitte - Digital.pdf')).toBe('Deloitte%20-%20Digital.pdf');
  });

  it('encodes ampersand, hash, plus and percent', () => {
    expect(encodeSegment('R&D #1 + 100%')).toBe('R%26D%20%231%20%2B%20100%25');
  });

  it('never double encodes: an existing %20 in the decoded value is a literal percent', () => {
    // A decoded path containing the four characters "%", "2", "0" is a literal
    // percent sign followed by digits and must encode to %2520.
    expect(encodeSegment('a%20b')).toBe('a%2520b');
    expect(encodePath('/x/a b')).toBe('/x/a%20b');
  });

  it('buildUrl joins host and encoded path', () => {
    expect(buildUrl('contoso.sharepoint.com', '/sites/SiteA/Lib/A b')).toBe(
      'https://contoso.sharepoint.com/sites/SiteA/Lib/A%20b',
    );
  });
});

describe('round trip over the fixture corpus', () => {
  const dir = join(import.meta.dirname, '..', 'fixtures');
  const paths: string[] = [];
  const walk = (d: string): void => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith('.json')) {
        const fixture = JSON.parse(readFileSync(full, 'utf8')) as { expected: { ok: boolean; path?: string } };
        if (fixture.expected.ok && fixture.expected.path !== undefined) {
          paths.push(fixture.expected.path);
        }
      }
    }
  };
  walk(dir);

  it('decode(encode(path)) equals path for every expected path', () => {
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      expect(decodePercent(encodePath(path), 'path')).toBe(path);
    }
  });
});
