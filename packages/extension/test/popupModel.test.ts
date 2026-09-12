import { describe, expect, it } from 'vitest';
import { applyLookup, buildRows, followUntilVerified, lookupRows, normaliseBaseUrl, submitRows, verificationUrl, type FetchLike, type LookupAnswer } from '../src/popupModel.js';

describe('what BreadCrumb knows (lookup)', () => {
  const DOC = 'https://contoso.sharepoint.com/sites/SiteA/_layouts/15/Doc.aspx?sourcedoc=%7B3F2A9C1E-7B4D-4E0A-9C6B-1D2E3F4A5B6C%7D&file=Plan.pptx&action=edit';
  const OTHER = 'https://contoso.sharepoint.com/sites/SiteA/Lib/Other.pdf';
  const verified: LookupAnswer = {
    link: DOC,
    found: true,
    id: 23,
    state: 'Verified',
    verified: true,
    path: '/sites/SiteA/Shared Documents/Plans/Plan.pptx',
    folderUrl: 'https://contoso.sharepoint.com/sites/SiteA/Shared%20Documents/Plans',
    fileUrl: 'https://contoso.sharepoint.com/sites/SiteA/Shared%20Documents/Plans/Plan.pptx',
    fileName: 'Plan.pptx',
  };

  it('records the verified folder and unticks documents BreadCrumb already has, on the first lookup only', () => {
    const rows = buildRows([{ url: DOC }, { url: OTHER }]);
    applyLookup(rows, [verified, { link: OTHER, found: false }], { untickKnown: true });
    expect(rows[0]?.known).toEqual({ id: 23, state: 'Verified', verified: true, path: verified.path, folder: '/sites/SiteA/Shared Documents/Plans', folderUrl: verified.folderUrl });
    expect(rows[0]?.selected).toBe(false);
    expect(rows[1]?.known).toBeUndefined();
    expect(rows[1]?.selected).toBe(true);

    rows[0]!.selected = true;
    applyLookup(rows, [verified]);
    expect(rows[0]?.selected).toBe(true);
  });

  it('asks POST /api/lookup with the row links and tolerates failures', async () => {
    const rows = buildRows([{ url: DOC }, { url: OTHER }]);
    const bodies: string[] = [];
    const answers = await lookupRows(rows, 'http://localhost:3000', async (url, init) => {
      bodies.push(`${url} ${String(init.body)}`);
      return new Response(JSON.stringify({ answers: [verified] }), { status: 200 });
    });
    expect(bodies).toEqual([`http://localhost:3000/api/lookup ${JSON.stringify({ links: [DOC, OTHER] })}`]);
    expect(answers).toEqual([verified]);
    expect(await lookupRows(rows, 'http://localhost:3000', async () => new Response('', { status: 404 }))).toBeUndefined();
    expect(await lookupRows(rows, 'http://localhost:3000', async () => { throw new Error('offline'); })).toBeUndefined();
  });

  it('follows sent rows until BreadCrumb has verified them, or gives up at the deadline', async () => {
    const rows = buildRows([{ url: DOC }]);
    rows[0]!.outcome = { ok: true, id: 23, state: 'Unresolved' };
    let calls = 0;
    const pending: LookupAnswer = { ...verified, state: 'Unresolved', verified: false, path: null, folderUrl: null, fileUrl: null, fileName: null };
    const fetchImpl: FetchLike = async () => {
      calls += 1;
      return new Response(JSON.stringify({ answers: [calls < 3 ? pending : verified] }), { status: 200 });
    };
    let updates = 0;
    let clock = 0;
    const options = { sleep: async (ms: number) => { clock += ms; }, now: () => clock, intervalMs: 2000, timeoutMs: 90000 };
    expect(await followUntilVerified(rows, 'http://localhost:3000', () => (updates += 1), fetchImpl, options)).toBe('verified');
    expect(calls).toBe(3);
    expect(updates).toBe(3);
    expect(rows[0]?.known?.folder).toBe('/sites/SiteA/Shared Documents/Plans');

    const stuck = buildRows([{ url: OTHER }]);
    stuck[0]!.outcome = { ok: true, id: 24, state: 'Inferred' };
    clock = 0;
    const neverVerified: FetchLike = async () => new Response(JSON.stringify({ answers: [{ ...pending, link: OTHER, id: 24, state: 'Inferred' }] }), { status: 200 });
    expect(await followUntilVerified(stuck, 'http://localhost:3000', () => {}, neverVerified, { ...options, timeoutMs: 6000 })).toBe('timeout');
    expect(await followUntilVerified(buildRows([{ url: OTHER }]), 'http://localhost:3000', () => {}, neverVerified, options)).toBe('nothing-sent');
  });
});

describe('verificationUrl', () => {
  it('opens the extension-filtered history with the self-closing marker', () => {
    expect(verificationUrl('http://localhost:3000')).toBe('http://localhost:3000/history?source=extension&close=1');
  });
});

const DIRECT = 'https://contoso.sharepoint.com/sites/SiteA/Lib/Folder%20One/Report.pdf';
const TOKEN = 'https://contoso.sharepoint.com/:b:/s/SiteA/EaBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789abc?e=Ab12Cd';
const FOLDER = 'https://contoso.sharepoint.com/:f:/r/sites/SiteA/Lib/Folder?csf=1&web=1&e=Ab12Cd';

describe('buildRows (BC-044)', () => {
  it('lists each citation once with file name, folder, state and inferred marker', () => {
    const rows = buildRows([{ url: DIRECT, text: 'Report' }, { url: DIRECT }, { url: TOKEN, text: 'Shared file' }, { url: FOLDER }, { url: 'nope' }]);
    expect(rows.map((r) => r.label)).toEqual(['Report.pdf', 'Shared file', 'Folder', 'nope']);
    expect(rows.map((r) => r.state)).toEqual(['Inferred', 'Unresolved', 'Inferred', 'failed']);
    expect(rows[0]?.folder).toBe('/sites/SiteA/Lib/Folder One');
    expect(rows[0]?.libraryInferred).toBe(true);
    expect(rows[1]?.folder).toBeUndefined();
    expect(rows[1]?.selected).toBe(true);
    expect(rows[2]?.folder).toBe('/sites/SiteA/Lib/Folder');
    expect(rows[3]?.selected).toBe(false);
    expect(rows.map((r) => r.key)).toEqual(['row-1', 'row-2', 'row-3', 'row-4']);
  });
});

describe('one row per document', () => {
  it('collapses the same document cited with different query parameters or link forms', () => {
    const guid = '3F2A9C1E-7B4D-4E0A-9C6B-1D2E3F4A5B6C';
    const rows = buildRows([
      { url: `https://contoso.sharepoint.com/sites/SiteA/_layouts/15/Doc.aspx?sourcedoc=%7B${guid}%7D&file=Plan.docx&action=edit&mobileredirect=true`, text: 'Plan' },
      { url: `https://contoso.sharepoint.com/sites/SiteA/_layouts/15/Doc.aspx?sourcedoc=%7B${guid}%7D&file=Plan.docx&action=default` },
      { url: `https://contoso.sharepoint.com/:w:/r/sites/SiteA/Lib/Plan.docx?d=w${guid.replaceAll('-', '').toLowerCase()}&csf=1&web=1` },
      { url: `${DIRECT}?web=1` },
      { url: DIRECT },
    ]);
    expect(rows.map((r) => r.label)).toEqual(['Plan.docx', 'Report.pdf']);
  });
});

describe('normaliseBaseUrl (BC-045)', () => {
  it('accepts hosts with or without a scheme and strips trailing slashes', () => {
    expect(normaliseBaseUrl('192.168.1.20:3000')).toBe('http://192.168.1.20:3000');
    expect(normaliseBaseUrl('https://breadcrumb.internal/')).toBe('https://breadcrumb.internal');
    expect(normaliseBaseUrl('  ')).toBeUndefined();
    expect(normaliseBaseUrl(undefined)).toBeUndefined();
    expect(normaliseBaseUrl('ftp://x')).toBeUndefined();
  });
});

describe('submitRows (BC-045)', () => {
  const fake = (handler: (url: string, body: string) => Response | Error): { fetch: FetchLike; calls: string[] } => {
    const calls: string[] = [];
    return {
      calls,
      fetch: async (url, init) => {
        calls.push(String(init.body));
        const out = handler(url, String(init.body));
        if (out instanceof Error) throw out;
        return out;
      },
    };
  };

  it('sends each selected row with source extension and records per row outcomes', async () => {
    const rows = buildRows([{ url: DIRECT }, { url: TOKEN }, { url: FOLDER }]);
    rows[2]!.selected = false;
    const { fetch, calls } = fake((_url, body) => {
      const { link } = JSON.parse(body) as { link: string; source: string };
      return link === TOKEN
        ? new Response(JSON.stringify({ reason: 'unsupported_form', message: 'refused for the test' }), { status: 400 })
        : new Response(JSON.stringify({ id: 7, result: { state: 'Inferred' } }), { status: 200 });
    });
    await submitRows(rows, 'http://192.168.1.20:3000', fetch);
    expect(calls).toHaveLength(2);
    expect(JSON.parse(calls[0]!)).toEqual({ link: DIRECT, source: 'extension' });
    expect(rows[0]?.outcome).toEqual({ ok: true, id: 7, state: 'Inferred' });
    expect(rows[1]?.outcome).toEqual({ ok: false, message: 'refused for the test' });
    expect(rows[2]?.outcome).toBeUndefined();
  });

  it('reports a reachability error naming the base URL when the API is unreachable', async () => {
    const rows = buildRows([{ url: DIRECT }]);
    await submitRows(rows, 'http://192.168.1.20:3000', fake(() => new Error('Failed to fetch')).fetch);
    expect(rows[0]?.outcome).toMatchObject({ ok: false });
    if (rows[0]?.outcome !== undefined && !rows[0].outcome.ok) {
      expect(rows[0].outcome.message).toContain('Could not reach http://192.168.1.20:3000');
      expect(rows[0].outcome.message).toContain('private network');
    }
  });
});
