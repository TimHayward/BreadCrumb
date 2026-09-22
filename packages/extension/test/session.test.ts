import { describe, expect, it } from 'vitest';
import { buildRows, type FetchLike } from '../src/popupModel.js';
import { confirmWithSession, sessionHost } from '../src/session.js';

const GUID = '3F2A9C1E-7B4D-4E0A-9C6B-1D2E3F4A5B6C';
const DOC = `https://contoso.sharepoint.com/sites/SiteA/_layouts/15/Doc.aspx?sourcedoc=%7B${GUID}%7D&file=Plan.pptx&action=edit`;
const ONEDRIVE = 'https://contoso-my.sharepoint.com/:w:/r/personal/user_contoso_onmicrosoft_com/Documents/Work/Report.docx?d=w1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6&csf=1&web=1';
const SOVEREIGN = 'https://contoso.sharepoint.us/sites/SiteA/Lib/Report.pdf';

const item = {
  id: '01PLAN',
  name: 'Plan.pptx',
  parentReference: { driveId: 'b!docs', path: '/drives/b!docs/root:/Plans' },
  sharepointIds: { listItemUniqueId: GUID.toLowerCase(), siteId: 'site-1' },
  file: {},
};
const drive = { id: 'b!docs', name: 'Documents', webUrl: 'https://contoso.sharepoint.com/sites/SiteA/Shared%20Documents' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** SharePoint v2.0 on the tenant host answers; the -my host answers 401 (no OneDrive session yet). */
const sharePoint: FetchLike = async (url) => {
  if (url.startsWith('https://contoso-my.sharepoint.com/')) return json({ error: { code: 'unauthenticated' } }, 401);
  if (url.includes('/_api/v2.0/shares/')) return json(item);
  if (url.includes('/_api/v2.0/drives/b!docs')) return json(drive);
  return json({ error: { code: 'itemNotFound' } }, 404);
};

describe('confirmWithSession (BC-049)', () => {
  it('confirms rows on granted SharePoint hosts through SharePoint v2.0 with the browser session', async () => {
    const seen: Array<{ url: string; init: RequestInit }> = [];
    const rows = buildRows([{ url: DOC }]);
    await confirmWithSession(rows, {
      fetchImpl: async (url, init) => {
        seen.push({ url, init });
        return sharePoint(url, init);
      },
      hasPermission: async () => true,
    });
    expect(rows[0]?.session).toMatchObject({ ok: true });
    if (rows[0]?.session?.ok !== true) return;
    expect(rows[0].session.verified.path).toBe('/sites/SiteA/Shared Documents/Plans/Plan.pptx');
    expect(rows[0].session.verified.methodText.startsWith('Confirmed by SharePoint, using your browser session:')).toBe(true);
    expect(seen.every((s) => s.init.credentials === 'include')).toBe(true);
    expect(seen[0]?.url.startsWith('https://contoso.sharepoint.com/_api/v2.0/shares/u!')).toBe(true);
  });

  it('leaves rows to the Graph route when access is missing or SharePoint says no, and skips what it cannot confirm', async () => {
    const rows = buildRows([{ url: DOC }, { url: ONEDRIVE }, { url: SOVEREIGN }]);
    await confirmWithSession(rows, { fetchImpl: sharePoint, hasPermission: async (host) => host === 'contoso-my.sharepoint.com' });
    expect(rows[0]?.session).toMatchObject({ ok: false, reason: 'no-access' });
    expect(rows[1]?.session).toMatchObject({ ok: false, reason: 'failed' });
    expect(rows[2]?.session).toBeUndefined();
    expect(sessionHost(rows[2]!)).toBeUndefined();
  });

});

describe('a long chat (2026-09-22)', () => {
  it('asks SharePoint about a few rows at a time and reports progress', async () => {
    const links = Array.from({ length: 12 }, (_, i) => `https://contoso.sharepoint.com/sites/SiteA/Lib/File${i}.docx`);
    const rows = buildRows(links.map((url) => ({ url })));
    let inFlight = 0;
    let highWater = 0;
    const progress: Array<[number, number]> = [];
    const slow: FetchLike = async (url, init) => {
      inFlight += 1;
      highWater = Math.max(highWater, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
      return sharePoint(url, init);
    };

    await confirmWithSession(rows, { fetchImpl: slow, hasPermission: async () => true, concurrency: 3, onProgress: (done, total) => progress.push([done, total]) });

    expect(highWater).toBeLessThanOrEqual(3);
    expect(rows.every((row) => row.session !== undefined)).toBe(true);
    expect(progress.at(-1)).toEqual([12, 12]);
  });

  it('counts only the rows it can ask about', async () => {
    const rows = buildRows([{ url: DOC }, { url: SOVEREIGN }]);
    const progress: Array<[number, number]> = [];
    await confirmWithSession(rows, { fetchImpl: sharePoint, hasPermission: async () => true, onProgress: (done, total) => progress.push([done, total]) });
    expect(progress).toEqual([[1, 1]]);
  });
});
