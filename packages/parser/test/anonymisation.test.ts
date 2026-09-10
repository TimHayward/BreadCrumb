/**
 * Anonymisation check (BACKLOG.md section 8, BC-022). Fails the build when a
 * fixture carries a host other than the documented placeholders, a site or
 * alias that is not a placeholder, a sharing token longer than the
 * placeholder length, or an un-truncated Safe Links data blob.
 */
import { relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FIXTURES_DIR, listFixtures, loadFixture } from './corpus.js';

/** The worked example from the brief is the single permitted real link. */
const EXEMPT = new Set(['row1-library-view/worked-example.json']);

const ALLOWED_HOSTS: ReadonlyArray<RegExp> = [
  /^contoso(-my)?\.sharepoint\.(com|us|cn)$/,
  /^contoso(-my)?\.sharepoint-mil\.us$/,
  /^onedrive\.live\.com$/,
  /^1drv\.ms$/,
  /^teams\.microsoft\.com$/,
  /^[a-z0-9]+\.safelinks\.protection\.outlook\.com$/,
  /^www\.example\.com$/,
  /^intranet\.example\.org$/,
];
const ALLOWED_SITES = new Set(['SiteA', 'SiteB']);
const ALLOWED_ALIASES = new Set(['user_contoso_onmicrosoft_com']);
const TOKEN_PLACEHOLDER_LENGTH = 40;
const SHORT_TOKEN_MAX = 20;

/** Decodes repeatedly so hosts inside wrappers are seen too. */
function expansions(input: string): string[] {
  const seen = [input];
  let current = input;
  for (let i = 0; i < 4; i++) {
    let next: string;
    try {
      next = decodeURIComponent(current);
    } catch {
      break;
    }
    if (next === current) {
      break;
    }
    seen.push(next);
    current = next;
  }
  return seen;
}

function problems(input: string): string[] {
  const found: string[] = [];
  for (const text of expansions(input)) {
    for (const [, host] of text.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) {
      if (host !== undefined && !ALLOWED_HOSTS.some((re) => re.test(host.toLowerCase()))) {
        found.push(`host "${host}" is not a documented placeholder`);
      }
    }
    for (const [, kind, site] of text.matchAll(/\/(sites|teams)\/([^/?&#]+)/gi)) {
      if (site !== undefined && !ALLOWED_SITES.has(site)) {
        found.push(`${kind} name "${site}" is not SiteA or SiteB`);
      }
    }
    for (const [, alias] of text.matchAll(/\/personal\/([^/?&#]+)/gi)) {
      if (alias !== undefined && !ALLOWED_ALIASES.has(alias)) {
        found.push(`personal alias "${alias}" is not the placeholder`);
      }
    }
    for (const [, token] of text.matchAll(/\/:[a-z]{1,2}:\/[sgt]\/(?:personal\/[^/]+\/|[^/]+\/)?([^/?&#]+)/gi)) {
      if (token !== undefined && token.length > TOKEN_PLACEHOLDER_LENGTH) {
        found.push(`sharing token "${token}" is longer than the ${TOKEN_PLACEHOLDER_LENGTH} character placeholder`);
      }
    }
    for (const [, token] of text.matchAll(/1drv\.ms\/[a-z]\/s!([^/?&#]+)/gi)) {
      if (token !== undefined && token.length > SHORT_TOKEN_MAX) {
        found.push(`short link token "${token}" is longer than ${SHORT_TOKEN_MAX} characters`);
      }
    }
    for (const [, name, value] of text.matchAll(/[?&](data|sdata)=([^&#]*)/gi)) {
      if (value !== undefined && value !== 'PLACEHOLDER') {
        found.push(`Safe Links ${name} blob is not the PLACEHOLDER`);
      }
    }
  }
  return [...new Set(found)];
}

describe('fixture anonymisation (section 8)', () => {
  for (const file of listFixtures()) {
    const name = relative(FIXTURES_DIR, file).replaceAll('\\', '/');
    if (EXEMPT.has(name)) {
      continue;
    }
    it(`${name} contains only placeholders`, () => {
      expect(problems(loadFixture(file).input)).toEqual([]);
    });
  }

  it('the check itself catches a real looking link', () => {
    expect(problems('https://acme.sharepoint.com/sites/Finance/Lib/x.pdf')).toEqual([
      'host "acme.sharepoint.com" is not a documented placeholder',
      'sites name "Finance" is not SiteA or SiteB',
    ]);
    expect(problems('https://contoso.sharepoint.com/:b:/s/SiteA/' + 'x'.repeat(41))).toHaveLength(1);
  });
});
