/**
 * Graph validation against replayed responses (BC-037, BC-038, BC-041).
 * The responses follow the documented Graph v1.0 shapes and were written by
 * hand, anonymised; recordings from the test tenant replace them once M3 is
 * exercised there.
 */
import { parseLink, type ParseSuccess } from '@breadcrumb/parser';
import { describe, expect, it } from 'vitest';
import { encodeSharingUrl, validateResult, type GraphClient, type GraphResponse } from '../src/validation/graphValidation.js';

type Route = GraphResponse | ((path: string) => GraphResponse);

function graph(routes: Record<string, Route>): GraphClient & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async get(path) {
      calls.push(path);
      const key = path.replace(/\?.*$/, '');
      const route = routes[key];
      if (route === undefined) {
        return { status: 404, headers: {}, body: { error: { code: 'itemNotFound', message: `no route for ${key}` } } };
      }
      return typeof route === 'function' ? route(path) : route;
    },
  };
}

const ok = (body: unknown): GraphResponse => ({ status: 200, headers: {}, body });

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
    // The parser guesses "Shared Documents" is a folder under library "Lib"? No: here the
    // link puts the file under a nested folder that is really a separate library root.
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
    expect(outcome.verified.components.folders).toEqual([]);
    expect(outcome.verified.corrections).toEqual({
      library: { was: 'Archive', now: '2024' },
      folders: { was: '2024', now: '' },
      sitePath: { was: '/sites/SiteA', now: '/sites/SiteA/Archive' },
    });
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

  it('keeps the previous state when no library contains the path or the item is missing', async () => {
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
});

describe('validateResult by share (BC-038)', () => {
  const link = 'https://contoso.sharepoint.com/:b:/s/SiteA/EaBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789abc?e=Ab12Cd';

  it('encodes the sharing URL as u! plus base64url', () => {
    expect(encodeSharingUrl('https://contoso.sharepoint.com/:b:/s/SiteA/x?e=1')).toBe('u!aHR0cHM6Ly9jb250b3NvLnNoYXJlcG9pbnQuY29tLzpiOi9zL1NpdGVBL3g_ZT0x');
  });

  it('resolves an Unresolved token to a Verified path and library', async () => {
    const result = parseLink(link) as ParseSuccess;
    const outcome = await validateResult(result, graph({
      [`/shares/${encodeSharingUrl(link)}/driveItem`]: ok(FILE_ITEM),
      '/drives/b!lib': ok({ id: 'b!lib', name: 'Lib', webUrl: 'https://contoso.sharepoint.com/sites/SiteA/Lib' }),
    }));
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
    expect(outcome.verified.calls[0]).toContain('/shares/u!');
  });

  it('reports a permission error naming the permissions and leaves the state unchanged', async () => {
    const result = parseLink(link) as ParseSuccess;
    const outcome = await validateResult(result, graph({
      [`/shares/${encodeSharingUrl(link)}/driveItem`]: { status: 403, headers: {}, body: { error: { code: 'accessDenied', message: 'Access denied' } } },
    }));
    expect(outcome).toMatchObject({ ok: false, kind: 'permission' });
    if (!outcome.ok) {
      expect(outcome.message).toContain('Files.Read.All');
      expect(outcome.message).toContain('administrator');
    }
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
    const doc = parseLink('https://contoso.sharepoint.com/sites/SiteA/_layouts/15/Doc.aspx?sourcedoc=%7B3f2a9c1e-7b4d-4e0a-9c6b-1d2e3f4a5b6c%7D&file=Plan.docx') as ParseSuccess;
    expect(await validateResult(doc, graph({}))).toMatchObject({ ok: false, kind: 'unsupported' });
    const sovereign = parseLink('https://contoso.sharepoint.us/sites/SiteA/Lib/Report.pdf') as ParseSuccess;
    expect(await validateResult(sovereign, graph({}))).toMatchObject({ ok: false, kind: 'unsupported' });
    const consumer = parseLink('https://onedrive.live.com/?cid=A1B2C3D4E5F60718&resid=A1B2C3D4E5F60718%21123') as ParseSuccess;
    expect(await validateResult(consumer, graph({}))).toMatchObject({ ok: false, kind: 'unsupported' });
  });

  it('never throws on a client that throws', async () => {
    const outcome = await validateResult(result, { get: async () => { throw new Error('network down'); } });
    expect(outcome).toMatchObject({ ok: false, kind: 'error', message: 'network down' });
  });
});
