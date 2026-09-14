/**
 * Graph validation against replayed responses (BC-037, BC-038, BC-041).
 * The responses follow the documented Graph v1.0 shapes and were written by
 * hand, anonymised; recordings from the test tenant replace them once M3 is
 * exercised there.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseLink, type ParseSuccess } from '@breadcrumb/parser';
import { describe, expect, it } from 'vitest';
import { encodeSharingUrl, isValidatable, siteCandidates, validateResult, type GraphClient, type GraphResponse } from '../src/graphValidation.js';

type Route = GraphResponse | ((path: string) => GraphResponse);

interface Recorded {
  path: string;
  headers: Record<string, string> | undefined;
  body?: unknown;
}

const notFound = (key: string): GraphResponse => ({ status: 404, headers: {}, body: { error: { code: 'itemNotFound', message: `no route for ${key}` } } });

/**
 * A replaying Graph client. GET routes are keyed by path without the query;
 * search routes are keyed by the KQL query string sent to POST /search/query.
 */
function graph(routes: Record<string, Route>, searches?: Record<string, GraphResponse>): GraphClient & { calls: Recorded[] } {
  const calls: Recorded[] = [];
  const client: GraphClient & { calls: Recorded[] } = {
    calls,
    async get(path, headers) {
      calls.push({ path, headers });
      const key = path.replace(/\?.*$/, '');
      const route = routes[key];
      if (route === undefined) {
        return notFound(key);
      }
      return typeof route === 'function' ? route(path) : route;
    },
  };
  if (searches !== undefined) {
    client.post = async (path, body, headers) => {
      calls.push({ path: `POST ${path}`, headers, body });
      const query = (body as { requests: Array<{ query: { queryString: string } }> }).requests[0]?.query.queryString ?? '';
      return searches[query] ?? { status: 200, headers: {}, body: { value: [{ hitsContainers: [{ hits: [] }] }] } };
    };
  }
  return client;
}

function searchHits(...hits: Array<{ id: string; driveId: string }>): GraphResponse {
  return {
    status: 200,
    headers: {},
    body: { value: [{ hitsContainers: [{ hits: hits.map((h) => ({ resource: { id: h.id, parentReference: { driveId: h.driveId } } })) }] }] },
  };
}

const ok = (body: unknown): GraphResponse => ({ status: 200, headers: {}, body });
const forbidden: GraphResponse = { status: 403, headers: {}, body: { error: { code: 'accessDenied', message: 'Access denied' } } };

const SITE_A = { id: 'contoso.sharepoint.com,1111aaaa-1111-4aaa-8aaa-111111111111,2222bbbb-2222-4bbb-8bbb-222222222222', webUrl: 'https://contoso.sharepoint.com/sites/SiteA' };
const DRIVES_A = {
  value: [
    { id: 'b!docs', name: 'Documents', webUrl: 'https://contoso.sharepoint.com/sites/SiteA/Shared%20Documents' },
    { id: 'b!lib', name: 'Lib', webUrl: 'https://contoso.sharepoint.com/sites/SiteA/Lib' },
  ],
};
const UNIQUE = '3f2a9c1e-7b4d-4e0a-9c6b-1d2e3f4a5b6c';
const FILE_ITEM = {
  id: '01ITEM',
  name: 'Report.pdf',
  webUrl: 'https://contoso.sharepoint.com/sites/SiteA/Lib/Folder%20One/Report.pdf',
  file: { mimeType: 'application/pdf' },
  parentReference: { driveId: 'b!lib', path: '/drives/b!lib/root:/Folder%20One' },
  sharepointIds: { listItemUniqueId: UNIQUE, siteId: '1111aaaa-1111-4aaa-8aaa-111111111111' },
};
const LIB_DRIVE = { id: 'b!lib', name: 'Lib', webUrl: 'https://contoso.sharepoint.com/sites/SiteA/Lib' };

describe('validateResult by path (BC-037)', () => {
  it('confirms an Inferred direct URL: site by path, drives listed, item by path, every component a fact', async () => {
    const result = parseLink('https://contoso.sharepoint.com/sites/SiteA/Lib/Folder%20One/Report.pdf') as ParseSuccess;
    const client = graph({
      '/sites/contoso.sharepoint.com:/sites/SiteA': ok(SITE_A),
      [`/sites/${SITE_A.id}/drives`]: ok(DRIVES_A),
      '/drives/b!lib/root:/Folder%20One/Report.pdf': ok(FILE_ITEM),
    });
    const outcome = await validateResult(result, client);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.verified.path).toBe('/sites/SiteA/Lib/Folder One/Report.pdf');
    expect(outcome.verified.folderUrl).toBe('https://contoso.sharepoint.com/sites/SiteA/Lib/Folder%20One');
    expect(outcome.verified.fileUrl).toBe('https://contoso.sharepoint.com/sites/SiteA/Lib/Folder%20One/Report.pdf');
    expect(outcome.verified.components).toEqual({
      tenant: 'contoso',
      host: 'contoso.sharepoint.com',
      sitePath: '/sites/SiteA',
      library: 'Lib',
      folders: ['Folder One'],
      fileName: 'Report.pdf',
    });
    expect(outcome.verified.corrections).toEqual({});
    expect(outcome.verified.graph).toEqual({ siteId: SITE_A.id, driveId: 'b!lib', itemId: '01ITEM', listItemUniqueId: UNIQUE, webUrl: FILE_ITEM.webUrl });
    expect(outcome.verified.calls).toEqual(['/sites/contoso.sharepoint.com:/sites/SiteA', `/sites/${SITE_A.id}/drives`, '/drives/b!lib/root:/Folder%20One/Report.pdf']);
    expect(outcome.verified.methodText).toContain('resolved by path');
  });

  it('corrects a wrongly inferred library boundary and records what was inferred', async () => {
    const result = parseLink('https://contoso.sharepoint.com/sites/SiteA/Lib/Forms/AllItems.aspx?id=%2Fsites%2FSiteA%2FArchive%2F2024%2FMinutes%2Edocx') as ParseSuccess;
    expect(result.components.library?.value).toBe('Archive');
    const client = graph({
      '/sites/contoso.sharepoint.com:/sites/SiteA': ok(SITE_A),
      [`/sites/${SITE_A.id}/drives`]: ok({
        value: [{ id: 'b!arch', name: 'Archive 2024', webUrl: 'https://contoso.sharepoint.com/sites/SiteA/Archive/2024' }],
      }),
      '/drives/b!arch/root:/Minutes.docx': ok({ id: '01MIN', name: 'Minutes.docx', file: {}, parentReference: { driveId: 'b!arch' } }),
    });
    const outcome = await validateResult(result, client);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.verified.components.library).toBe('2024');
    expect(outcome.verified.components.sitePath).toBe('/sites/SiteA/Archive');
    expect(outcome.verified.corrections).toEqual({
      library: { was: 'Archive', now: '2024' },
      folders: { was: '2024', now: '' },
      sitePath: { was: '/sites/SiteA', now: '/sites/SiteA/Archive' },
    });
  });

  it('finds a file in a subsite by trying deeper site paths when the parent site has no matching library', async () => {
    const result = parseLink('https://contoso.sharepoint.com/sites/SiteA/SubWeb/Lib/Folder/Report.pdf') as ParseSuccess;
    expect(result.components.library?.value).toBe('SubWeb');
    const SUB = { id: 'contoso.sharepoint.com,3333cccc-3333-4ccc-8ccc-333333333333,4444dddd-4444-4ddd-8ddd-444444444444', webUrl: 'https://contoso.sharepoint.com/sites/SiteA/SubWeb' };
    const client = graph({
      '/sites/contoso.sharepoint.com:/sites/SiteA': ok(SITE_A),
      [`/sites/${SITE_A.id}/drives`]: ok(DRIVES_A),
      '/sites/contoso.sharepoint.com:/sites/SiteA/SubWeb': ok(SUB),
      [`/sites/${SUB.id}/drives`]: ok({ value: [{ id: 'b!sub', name: 'Lib', webUrl: 'https://contoso.sharepoint.com/sites/SiteA/SubWeb/Lib' }] }),
      '/drives/b!sub/root:/Folder/Report.pdf': ok({ id: '01SUB', name: 'Report.pdf', file: {}, parentReference: { driveId: 'b!sub' } }),
    });
    const outcome = await validateResult(result, client);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.verified.components).toEqual({ tenant: 'contoso', host: 'contoso.sharepoint.com', sitePath: '/sites/SiteA/SubWeb', library: 'Lib', folders: ['Folder'], fileName: 'Report.pdf' });
    expect(outcome.verified.corrections).toEqual({
      library: { was: 'SubWeb', now: 'Lib' },
      folders: { was: 'Lib / Folder', now: 'Folder' },
      sitePath: { was: '/sites/SiteA', now: '/sites/SiteA/SubWeb' },
    });
    expect(outcome.verified.methodText).toContain('subsite /sites/SiteA/SubWeb');
    expect(client.calls.map((c) => c.path.replace(/\?.*$/, ''))).toEqual([
      '/sites/contoso.sharepoint.com:/sites/SiteA',
      `/sites/${SITE_A.id}/drives`,
      '/sites/contoso.sharepoint.com:/sites/SiteA/SubWeb',
      `/sites/${SUB.id}/drives`,
      '/drives/b!sub/root:/Folder/Report.pdf',
    ]);
  });

  it('falls back to the shares endpoint with the item URL when the account cannot list sites', async () => {
    const result = parseLink('https://contoso.sharepoint.com/sites/SiteA/Lib/Folder%20One/Report.pdf') as ParseSuccess;
    const client = graph({
      '/sites/contoso.sharepoint.com:/sites/SiteA': forbidden,
      [`/shares/${encodeSharingUrl('https://contoso.sharepoint.com/sites/SiteA/Lib/Folder%20One/Report.pdf')}/driveItem`]: ok(FILE_ITEM),
      '/drives/b!lib': ok(LIB_DRIVE),
    });
    const outcome = await validateResult(result, client);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.verified.path).toBe('/sites/SiteA/Lib/Folder One/Report.pdf');
    expect(outcome.verified.methodText).toContain('could not list the site');
    expect(client.calls[1]?.headers).toEqual({ prefer: 'redeemSharingLink' });
  });

  it('handles folders, root sites and the d identifier check', async () => {
    const folderLink = 'https://contoso.sharepoint.com/:f:/r/sites/SiteA/Lib/Folder?csf=1&web=1&e=Ab12Cd';
    const folder = parseLink(folderLink) as ParseSuccess;
    const client = graph({
      '/sites/contoso.sharepoint.com:/sites/SiteA': ok(SITE_A),
      [`/sites/${SITE_A.id}/drives`]: ok(DRIVES_A),
      '/drives/b!lib/root:/Folder': ok({ id: '01FOLDER', name: 'Folder', folder: { childCount: 3 }, parentReference: { driveId: 'b!lib' } }),
    });
    const folderOutcome = await validateResult(folder, client);
    expect(folderOutcome.ok).toBe(true);
    if (folderOutcome.ok) {
      expect(folderOutcome.verified.path).toBe('/sites/SiteA/Lib/Folder');
      expect(folderOutcome.verified.fileUrl).toBeUndefined();
      expect(folderOutcome.verified.components.folders).toEqual(['Folder']);
      expect(folderOutcome.verified.components.fileName).toBeUndefined();
    }

    const withId = parseLink(`https://contoso.sharepoint.com/:w:/r/sites/SiteA/Lib/Folder%20One/Report.pdf?d=w${UNIQUE.replaceAll('-', '')}&csf=1&web=1&e=x`) as ParseSuccess;
    const idOutcome = await validateResult(withId, graph({
      '/sites/contoso.sharepoint.com:/sites/SiteA': ok(SITE_A),
      [`/sites/${SITE_A.id}/drives`]: ok(DRIVES_A),
      '/drives/b!lib/root:/Folder%20One/Report.pdf': ok(FILE_ITEM),
    }));
    expect(idOutcome.ok).toBe(true);
    if (idOutcome.ok) {
      expect(idOutcome.verified.identifierCheck).toEqual({ linkValue: `w${UNIQUE.replaceAll('-', '')}`, graphValue: UNIQUE, matches: true });
    }

    const mismatch = parseLink('https://contoso.sharepoint.com/:w:/r/sites/SiteA/Lib/Folder%20One/Report.pdf?d=wdeadbeefdeadbeefdeadbeefdeadbeef') as ParseSuccess;
    const mismatchOutcome = await validateResult(mismatch, graph({
      '/sites/contoso.sharepoint.com:/sites/SiteA': ok(SITE_A),
      [`/sites/${SITE_A.id}/drives`]: ok(DRIVES_A),
      '/drives/b!lib/root:/Folder%20One/Report.pdf': ok(FILE_ITEM),
    }));
    if (mismatchOutcome.ok) {
      expect(mismatchOutcome.verified.identifierCheck?.matches).toBe(false);
    }

    const root = parseLink('https://contoso.sharepoint.com/Shared%20Documents/Report.pdf') as ParseSuccess;
    const rootOutcome = await validateResult(root, graph({
      '/sites/contoso.sharepoint.com': ok({ id: 'root-site', webUrl: 'https://contoso.sharepoint.com' }),
      '/sites/root-site/drives': ok({ value: [{ id: 'b!root', name: 'Documents', webUrl: 'https://contoso.sharepoint.com/Shared%20Documents' }] }),
      '/drives/b!root/root:/Report.pdf': ok({ id: '01R', name: 'Report.pdf', file: {} }),
    }));
    expect(rootOutcome.ok).toBe(true);
    if (rootOutcome.ok) {
      expect(rootOutcome.verified.components.sitePath).toBe('');
      expect(rootOutcome.verified.path).toBe('/Shared Documents/Report.pdf');
    }
  });

  it('keeps the previous state when no library or subsite contains the path or the item is missing', async () => {
    const result = parseLink('https://contoso.sharepoint.com/sites/SiteA/Nowhere/Report.pdf') as ParseSuccess;
    const noDrive = await validateResult(result, graph({
      '/sites/contoso.sharepoint.com:/sites/SiteA': ok(SITE_A),
      [`/sites/${SITE_A.id}/drives`]: ok(DRIVES_A),
    }));
    expect(noDrive).toMatchObject({ ok: false, kind: 'not_found' });
    if (!noDrive.ok) expect(noDrive.message).toContain('could not find the item');

    const missing = parseLink('https://contoso.sharepoint.com/sites/SiteA/Lib/Gone.pdf') as ParseSuccess;
    const missingOutcome = await validateResult(missing, graph({
      '/sites/contoso.sharepoint.com:/sites/SiteA': ok(SITE_A),
      [`/sites/${SITE_A.id}/drives`]: ok(DRIVES_A),
      '/drives/b!lib/root:/Gone.pdf': { status: 404, headers: {}, body: { error: { code: 'itemNotFound', message: 'The resource could not be found.' } } },
    }));
    expect(missingOutcome).toMatchObject({ ok: false, kind: 'not_found' });
  });

  it('siteCandidates never treats the file itself as a subsite', () => {
    expect(siteCandidates('/sites/SiteA', '/sites/SiteA/A/B/C/D/File.pdf')).toEqual(['/sites/SiteA', '/sites/SiteA/A', '/sites/SiteA/A/B', '/sites/SiteA/A/B/C']);
    expect(siteCandidates('/sites/SiteA', '/sites/SiteA/Lib/Folder')).toEqual(['/sites/SiteA', '/sites/SiteA/Lib']);
    expect(siteCandidates('', '/Shared Documents/File.pdf')).toEqual(['', '/Shared Documents']);
  });
});

describe('validateResult by share (BC-038)', () => {
  const link = 'https://contoso.sharepoint.com/:b:/s/SiteA/EaBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789abc?e=Ab12Cd';

  it('encodes the sharing URL as u! plus base64url', () => {
    expect(encodeSharingUrl('https://contoso.sharepoint.com/:b:/s/SiteA/x?e=1')).toBe('u!aHR0cHM6Ly9jb250b3NvLnNoYXJlcG9pbnQuY29tLzpiOi9zL1NpdGVBL3g_ZT0x');
  });

  it('resolves an Unresolved token to a Verified path and library, redeeming the link', async () => {
    const result = parseLink(link) as ParseSuccess;
    const client = graph({
      [`/shares/${encodeSharingUrl(link)}/driveItem`]: ok(FILE_ITEM),
      '/drives/b!lib': ok(LIB_DRIVE),
    });
    const outcome = await validateResult(result, client);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.verified.path).toBe('/sites/SiteA/Lib/Folder One/Report.pdf');
    expect(outcome.verified.components).toEqual({
      tenant: 'contoso',
      host: 'contoso.sharepoint.com',
      sitePath: '/sites/SiteA',
      library: 'Lib',
      folders: ['Folder One'],
      fileName: 'Report.pdf',
    });
    expect(outcome.verified.methodText).toContain('shares endpoint');
    expect(outcome.verified.calls[0]).toBe('/shares/u!…/driveItem');
    expect(client.calls[0]?.headers).toEqual({ prefer: 'redeemSharingLink' });
  });

  it('reports a permission error naming the permissions and leaves the state unchanged', async () => {
    const result = parseLink(link) as ParseSuccess;
    const outcome = await validateResult(result, graph({ [`/shares/${encodeSharingUrl(link)}/driveItem`]: forbidden }));
    expect(outcome).toMatchObject({ ok: false, kind: 'permission' });
    if (!outcome.ok) {
      expect(outcome.message).toContain('Files.Read.All');
      expect(outcome.message).toContain('administrator');
    }
  });

  it('fetches the item again when the shares response omits its folder, instead of guessing the library root', async () => {
    const result = parseLink(link) as ParseSuccess;
    const withoutPath = { ...FILE_ITEM, webUrl: `https://contoso.sharepoint.com/sites/SiteA/_layouts/15/Doc.aspx?sourcedoc=%7B${UNIQUE}%7D`, parentReference: { driveId: 'b!lib' } };
    const client = graph({
      [`/shares/${encodeSharingUrl(link)}/driveItem`]: ok(withoutPath),
      '/drives/b!lib': ok(LIB_DRIVE),
      '/drives/b!lib/items/01ITEM': ok({ id: '01ITEM', name: 'Report.pdf', parentReference: { driveId: 'b!lib', path: '/drives/b!lib/root:/Folder%20One' } }),
    });
    const outcome = await validateResult(result, client);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.verified.path).toBe('/sites/SiteA/Lib/Folder One/Report.pdf');
  });

  it('refuses to claim a path when Graph never says which folder the item is in', async () => {
    const result = parseLink(link) as ParseSuccess;
    const withoutPath = { ...FILE_ITEM, webUrl: `https://contoso.sharepoint.com/sites/SiteA/_layouts/15/Doc.aspx?sourcedoc=%7B${UNIQUE}%7D`, parentReference: { driveId: 'b!lib' } };
    const outcome = await validateResult(result, graph({
      [`/shares/${encodeSharingUrl(link)}/driveItem`]: ok(withoutPath),
      '/drives/b!lib': ok(LIB_DRIVE),
      '/drives/b!lib/items/01ITEM': ok({ id: '01ITEM', name: 'Report.pdf', parentReference: { driveId: 'b!lib' } }),
    }));
    expect(outcome).toMatchObject({ ok: false, kind: 'error' });
    if (!outcome.ok) expect(outcome.message).toContain('did not say which folder');
  });

  it('isValidatable admits token and document id forms, Derived and Inferred, but not consumer links or other clouds', () => {
    expect(isValidatable(parseLink(link) as ParseSuccess)).toBe(true);
    expect(isValidatable(parseLink('https://contoso.sharepoint.com/sites/SiteA/Lib/x.pdf') as ParseSuccess)).toBe(true);
    expect(isValidatable(parseLink('https://contoso.sharepoint.com/sites/SiteA/_layouts/15/Doc.aspx?sourcedoc=%7B3f2a9c1e-7b4d-4e0a-9c6b-1d2e3f4a5b6c%7D') as ParseSuccess)).toBe(true);
    expect(isValidatable(parseLink('https://contoso.sharepoint.us/sites/SiteA/Lib/x.pdf') as ParseSuccess)).toBe(false);
  });
});

describe('recorded tenant responses (anonymised)', () => {
  interface RecordedFixture {
    title: string;
    link: string;
    responses: { shares: Record<string, unknown>; drive: Record<string, unknown> };
    expected: { path: string; folderUrl: string; library: string; folders: string[]; listItemUniqueId: string; calls: string[]; methodIncludes: string };
  }
  const fixture = JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', 'doc-aspx-via-shares.json'), 'utf8')) as RecordedFixture;

  it(`${fixture.title}: file's own unique id is checked, not the parent folder's`, async () => {
    const driveId = String(fixture.responses.drive['id']);
    const outcome = await validateResult(parseLink(fixture.link) as ParseSuccess, graph({
      [`/shares/${encodeSharingUrl(fixture.link)}/driveItem`]: ok(fixture.responses.shares),
      [`/drives/${driveId}`]: ok(fixture.responses.drive),
    }));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.verified.path).toBe(fixture.expected.path);
    expect(outcome.verified.folderUrl).toBe(fixture.expected.folderUrl);
    expect(outcome.verified.components.library).toBe(fixture.expected.library);
    expect(outcome.verified.components.folders).toEqual(fixture.expected.folders);
    expect(outcome.verified.graph.listItemUniqueId).toBe(fixture.expected.listItemUniqueId);
    expect(outcome.verified.identifierCheck?.matches).toBe(true);
    expect(outcome.verified.calls).toEqual(fixture.expected.calls);
    expect(outcome.verified.methodText).toContain(fixture.expected.methodIncludes);
  });
});

describe('validateResult by document id (BC-039, spike S5)', () => {
  const GUID = UNIQUE.toUpperCase();
  const docLink = `https://contoso.sharepoint.com/sites/SiteA/_layouts/15/Doc.aspx?sourcedoc=%7B${GUID}%7D&file=Report.pdf&action=edit&mobileredirect=true&DefaultItemOpen=1`;
  const doc = () => parseLink(docLink) as ParseSuccess;

  it('resolves through the shares endpoint when Graph accepts the Doc.aspx link itself', async () => {
    const client = graph({
      [`/shares/${encodeSharingUrl(docLink)}/driveItem`]: ok(FILE_ITEM),
      '/drives/b!lib': ok(LIB_DRIVE),
    });
    const outcome = await validateResult(doc(), client);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.verified.path).toBe('/sites/SiteA/Lib/Folder One/Report.pdf');
    expect(outcome.verified.methodText).toContain("unique id matches the link's document id");
    expect(outcome.verified.identifierCheck).toEqual({ linkValue: GUID, graphValue: UNIQUE, matches: true });
    expect(outcome.verified.corrections).toEqual({});
  });

  it('falls back to searching for the unique id and fetches the hit to confirm it', async () => {
    const client = graph(
      { '/drives/b!lib/items/01ITEM': ok(FILE_ITEM), '/drives/b!lib': ok(LIB_DRIVE) },
      { [`UniqueId:${GUID}`]: searchHits({ id: '01ITEM', driveId: 'b!lib' }) },
    );
    const outcome = await validateResult(doc(), client);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.verified.methodText).toContain("a search for the link's document id found the file");
    expect(outcome.verified.calls).toEqual([
      '/shares/u!…/driveItem',
      'POST /search/query',
      '/drives/b!lib/items/01ITEM',
      '/drives/b!lib',
    ]);
  });

  it('ignores hits with a different unique id and then searches by file name within the site', async () => {
    const other = { ...FILE_ITEM, id: '01OTHER', sharepointIds: { listItemUniqueId: '99999999-9999-4999-8999-999999999999' } };
    const client = graph(
      { '/drives/b!lib/items/01OTHER': ok(other), '/drives/b!lib/items/01ITEM': ok(FILE_ITEM), '/drives/b!lib': ok(LIB_DRIVE) },
      {
        [`UniqueId:${GUID}`]: searchHits({ id: '01OTHER', driveId: 'b!lib' }),
        'filename:"Report.pdf" path:"https://contoso.sharepoint.com/sites/SiteA"': searchHits({ id: '01OTHER', driveId: 'b!lib' }, { id: '01ITEM', driveId: 'b!lib' }),
      },
    );
    const outcome = await validateResult(doc(), client);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.verified.methodText).toContain('a search for the file name in /sites/SiteA found the file');
  });

  it('stays Unresolved with every attempt named when nothing matches', async () => {
    const outcome = await validateResult(doc(), graph({}, {}));
    expect(outcome).toMatchObject({ ok: false, kind: 'not_found' });
    if (!outcome.ok) {
      expect(outcome.message).toContain(`Graph could not find document ${GUID}`);
      expect(outcome.message).toContain('the shares endpoint answered');
      expect(outcome.message).toContain("search for the link's document id found 0 items");
      expect(outcome.message).toContain('search for the file name in /sites/SiteA found 0 items');
    }
  });

  it('works without search when the client cannot POST, and stops at once on an expired token', async () => {
    expect(await validateResult(doc(), graph({}))).toMatchObject({ ok: false, kind: 'not_found' });
    const expired = await validateResult(doc(), graph({
      [`/shares/${encodeSharingUrl(docLink)}/driveItem`]: { status: 401, headers: {}, body: { error: { code: 'InvalidAuthenticationToken', message: 'expired' } } },
    }, {}));
    expect(expired).toMatchObject({ ok: false, kind: 'auth' });
  });
});

describe('Graph failures are reported honestly (BC-041)', () => {
  const result = parseLink('https://contoso.sharepoint.com/sites/SiteA/Lib/Report.pdf') as ParseSuccess;

  it('throttling carries the wait Graph asked for', async () => {
    const outcome = await validateResult(result, graph({
      '/sites/contoso.sharepoint.com:/sites/SiteA': { status: 429, headers: { 'retry-after': '17' }, body: null },
    }));
    expect(outcome).toMatchObject({ ok: false, kind: 'throttled', retryAfterSeconds: 17 });
  });

  it('an expired or rejected token asks for sign in again', async () => {
    const outcome = await validateResult(result, graph({
      '/sites/contoso.sharepoint.com:/sites/SiteA': { status: 401, headers: {}, body: { error: { code: 'InvalidAuthenticationToken', message: 'Access token has expired.' } } },
    }));
    expect(outcome).toMatchObject({ ok: false, kind: 'auth' });
    if (!outcome.ok) expect(outcome.message).toContain('Sign in again');
  });

  it('unsupported cases say why', async () => {
    const sovereign = parseLink('https://contoso.sharepoint.us/sites/SiteA/Lib/Report.pdf') as ParseSuccess;
    expect(await validateResult(sovereign, graph({}))).toMatchObject({ ok: false, kind: 'unsupported' });
  });

  it('never throws on a client that throws', async () => {
    const outcome = await validateResult(result, { get: async () => { throw new Error('network down'); } });
    expect(outcome).toMatchObject({ ok: false, kind: 'error', message: 'network down' });
  });
});

describe('SharePoint session authority (BC-049, decision D9)', () => {
  const session = { authority: 'sharepoint-session' as const };

  it('confirms a path link through the shares endpoint with the item URL, naming SharePoint', async () => {
    const result = parseLink('https://contoso.sharepoint.com/sites/SiteA/Lib/Folder%20One/Report.pdf') as ParseSuccess;
    const client = graph({
      [`/shares/${encodeSharingUrl('https://contoso.sharepoint.com/sites/SiteA/Lib/Folder%20One/Report.pdf')}/driveItem`]: ok(FILE_ITEM),
      '/drives/b!lib': ok(LIB_DRIVE),
    });
    const outcome = await validateResult(result, client, session);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.verified.path).toBe('/sites/SiteA/Lib/Folder One/Report.pdf');
    expect(outcome.verified.methodText).toBe('Confirmed by SharePoint, using your browser session: the item URL was submitted to the shares endpoint, which returned the file and its library "Lib".');
    expect(client.calls.map((c) => c.path.replace(/\?.*$/, ''))).not.toContain('/sites/contoso.sharepoint.com:/sites/SiteA');
  });

  it('confirms document id and sharing links the same way as Graph, with the SharePoint label', async () => {
    const docLink = `https://contoso.sharepoint.com/sites/SiteA/_layouts/15/Doc.aspx?sourcedoc=%7B${UNIQUE}%7D&file=Report.pdf`;
    const outcome = await validateResult(parseLink(docLink) as ParseSuccess, graph({
      [`/shares/${encodeSharingUrl(docLink)}/driveItem`]: ok(FILE_ITEM),
      '/drives/b!lib': ok(LIB_DRIVE),
    }), session);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.verified.methodText.startsWith('Confirmed by SharePoint, using your browser session: the link was submitted')).toBe(true);
  });

  it('keeps the Graph label and route by default', async () => {
    const result = parseLink('https://contoso.sharepoint.com/sites/SiteA/Lib/Folder%20One/Report.pdf') as ParseSuccess;
    const outcome = await validateResult(result, graph({
      '/sites/contoso.sharepoint.com:/sites/SiteA': ok(SITE_A),
      [`/sites/${SITE_A.id}/drives`]: ok(DRIVES_A),
      '/drives/b!lib/root:/Folder%20One/Report.pdf': ok(FILE_ITEM),
    }));
    expect(outcome.ok && outcome.verified.methodText.startsWith('Confirmed by Microsoft Graph:')).toBe(true);
  });
});
