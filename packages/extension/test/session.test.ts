import { describe, expect, it } from 'vitest';
import { buildRows, type FetchLike } from '../src/popupModel.js';
import { classifySessionFailure, confirmWithSession, sessionHost } from '../src/session.js';

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

  it('leaves rows the session cannot confirm, and skips what it cannot ask about', async () => {
    const rows = buildRows([{ url: DOC }, { url: ONEDRIVE }, { url: SOVEREIGN }]);
    await confirmWithSession(rows, { fetchImpl: sharePoint, hasPermission: async (host) => host === 'contoso-my.sharepoint.com' });
    expect(rows[0]?.session).toMatchObject({ ok: false, reason: 'no-access' });
    // OneDrive answers 401 until it has been opened in the browser once: that is the signed out case.
    expect(rows[1]?.session).toMatchObject({ ok: false, reason: 'signed-out', host: 'contoso-my.sharepoint.com' });
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

describe('telling the refusals apart (user testing, 2026-09-24)', () => {
  const html = (status: number): Response => new Response('<html>sign in</html>', { status, headers: { 'content-type': 'text/html' } });

  it('reads a 401 on a host nothing has confirmed as no session yet', async () => {
    const rows = buildRows([{ url: DOC }]);
    await confirmWithSession(rows, { fetchImpl: async () => json({ error: { code: 'unauthenticated' } }, 401), hasPermission: async () => true });
    expect(rows[0]?.session).toMatchObject({ ok: false, reason: 'signed-out', host: 'contoso.sharepoint.com' });
  });

  it('reads a sign in page served as HTML the same way', () => {
    expect(classifySessionFailure([{ status: 200, contentType: 'text/html; charset=utf-8' }], false)).toBe('signed-out');
  });

  it('reads a 403 as no access to that item, never as a missing session', () => {
    expect(classifySessionFailure([{ status: 403, contentType: 'application/json' }], false)).toBe('no-permission');
    expect(classifySessionFailure([{ status: 403, contentType: 'application/json' }], true)).toBe('no-permission');
  });

  it('will not claim a host has no session when another file on it just confirmed', () => {
    expect(classifySessionFailure([{ status: 401, contentType: 'application/json' }], false)).toBe('signed-out');
    expect(classifySessionFailure([{ status: 401, contentType: 'application/json' }], true)).toBe('no-permission');
  });

  it('reads a 404 as gone, and anything else as a plain failure', () => {
    expect(classifySessionFailure([{ status: 404, contentType: 'application/json' }], true)).toBe('not-found');
    expect(classifySessionFailure([{ status: 500, contentType: 'application/json' }], true)).toBe('failed');
    expect(classifySessionFailure([], true)).toBe('failed');
  });

  it('explains a refused personal OneDrive item as someone else’s, not as a sign in problem', async () => {
    const rows = buildRows([{ url: ONEDRIVE }]);
    await confirmWithSession(rows, { fetchImpl: async () => json({ error: { code: 'accessDenied' } }, 403), hasPermission: async () => true });
    expect(rows[0]?.session).toMatchObject({ ok: false, reason: 'no-permission', host: 'contoso-my.sharepoint.com' });
    if (rows[0]?.session?.ok === false) {
      expect(rows[0].session.message).toContain("someone else's OneDrive");
    }
  });

  it('classifies each row against what its own host answered for the others', async () => {
    // One file on the tenant host confirms; a second on the same host is refused.
    const LOCKED = 'https://contoso.sharepoint.com/sites/SiteB/Lib/Locked.docx';
    // The shares endpoint carries the link as u! plus unpadded base64url.
    const lockedToken = `u!${btoa(LOCKED).replace(/=+$/, '').replaceAll('+', '-').replaceAll('/', '_')}`;
    const rows = buildRows([{ url: DOC }, { url: LOCKED }]);
    const fetchImpl: FetchLike = async (url, init) =>
      url.includes(lockedToken) ? json({ error: { code: 'accessDenied' } }, 401) : sharePoint(url, init);
    await confirmWithSession(rows, { fetchImpl, hasPermission: async () => true, concurrency: 1 });
    expect(rows[0]?.session).toMatchObject({ ok: true });
    // The session plainly works on that host, so the refusal is about the item.
    expect(rows[1]?.session).toMatchObject({ ok: false, reason: 'no-permission' });
  });

  it('still reports no session when the whole host refuses and html is served', async () => {
    const rows = buildRows([{ url: DOC }]);
    await confirmWithSession(rows, { fetchImpl: async () => html(200), hasPermission: async () => true });
    expect(rows[0]?.session).toMatchObject({ ok: false, reason: 'signed-out' });
  });
});

describe('links that are not files at all (user testing, 2026-09-24)', () => {
  it('takes the validator word for a link it cannot look up', () => {
    expect(classifySessionFailure([{ status: 200, contentType: 'application/json' }], true, 'unsupported')).toBe('unsupported');
    expect(classifySessionFailure([], true, 'permission')).toBe('no-permission');
    expect(classifySessionFailure([], true, 'not_found')).toBe('not-found');
    expect(classifySessionFailure([], true, 'error')).toBe('failed');
  });

  it('puts no session first, because that one is fixable by the user', () => {
    // Even when the validator called it unsupported, a host with no session is the thing to say.
    expect(classifySessionFailure([{ status: 401, contentType: 'application/json' }], false, 'unsupported')).toBe('signed-out');
  });
});
