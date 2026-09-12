import { describe, expect, it } from 'vitest';
import { buildRows, normaliseBaseUrl, submitRows, verificationUrl, type FetchLike } from '../src/popupModel.js';

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
