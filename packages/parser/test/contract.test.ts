import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PARSER_VERSION, parseLink } from '../src/index.js';

const STATES = new Set(['Verified', 'Derived', 'Inferred', 'Unresolved']);

function pseudoRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const ALPHABET = 'abcXYZ019 /:?&=%#+.-_~!$\'()*,;@[]{}|\\"<>\n\t' + 'é漢🙂';

describe('parser contract (BC-006)', () => {
  it('never throws for string input and always returns exactly one state or a failure', () => {
    const rand = pseudoRandom(42);
    const samples: string[] = ['', ' ', 'https://', 'https://contoso.sharepoint.com', 'https://contoso.sharepoint.com/%', '%%%'];
    for (let i = 0; i < 1000; i++) {
      const length = Math.floor(rand() * 80);
      let s = '';
      for (let j = 0; j < length; j++) {
        s += ALPHABET[Math.floor(rand() * ALPHABET.length)] ?? '';
      }
      samples.push(s, `https://contoso.sharepoint.com/sites/SiteA/Lib/Forms/AllItems.aspx?id=${s}`);
    }
    for (const sample of samples) {
      const result = parseLink(sample);
      expect(result.parserVersion).toBe(PARSER_VERSION);
      if (result.ok) {
        expect(STATES.has(result.state)).toBe(true);
        if (result.state === 'Unresolved') {
          expect(result.path).toBeUndefined();
          expect(result.folderUrl).toBeUndefined();
        } else {
          expect(typeof result.path).toBe('string');
          expect(result.folderUrl?.startsWith('https://')).toBe(true);
        }
      } else {
        expect(typeof result.reason).toBe('string');
        expect(result.message.length).toBeGreaterThan(0);
        expect(result.reason).not.toBe('parser_error');
      }
    }
  });

  it('tolerates non string input from untyped callers', () => {
    expect(parseLink(undefined as unknown as string).ok).toBe(false);
    expect(parseLink(42 as unknown as string).ok).toBe(false);
  });

  it('PARSER_VERSION matches package.json', () => {
    const pkg = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8')) as {
      version: string;
      dependencies?: Record<string, string>;
    };
    expect(PARSER_VERSION).toBe(pkg.version);
    expect(Object.keys(pkg.dependencies ?? {})).toEqual([]);
  });
});

describe('parser purity (invariant 2)', () => {
  const srcDir = join(import.meta.dirname, '..', 'src');
  const sources: string[] = [];
  const walk = (d: string): void => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith('.ts')) {
        sources.push(full);
      }
    }
  };
  walk(srcDir);

  const forbidden: Array<[string, RegExp]> = [
    ['Node built-in import', /from\s+['"]node:|from\s+['"](fs|path|os|http|https|net|crypto|child_process|url|util|stream|buffer)['"]/],
    ['require()', /\brequire\s*\(/],
    ['DOM access', /\b(document|window|navigator|localStorage|sessionStorage)\s*[.[]/],
    ['network client', /\bfetch\s*\(|\bnew\s+(XMLHttpRequest|WebSocket)\b/],
    ['process global', /\bprocess\s*[.[]/],
  ];

  it('source files import nothing from Node, the DOM or the network', () => {
    expect(sources.length).toBeGreaterThan(0);
    for (const file of sources) {
      const text = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
      for (const [label, pattern] of forbidden) {
        expect(pattern.test(text), `${label} found in ${file}`).toBe(false);
      }
    }
  });
});
