import { describe, expect, it } from 'vitest';
import type { VerifiedResult } from '@breadcrumb/validation';
import { applyLookup, buildRows, clipboardText, copySummary, describeRow, selectedFileLinks, selectedFolderLinks, followUntilVerified, lookupRows, normaliseBaseUrl, pathSegments, submitRows, verificationUrl, type FetchLike, type LookupAnswer } from '../src/popupModel.js';

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

  it('shows a consumer OneDrive link as not supported and leaves it unselected', () => {
    const [row] = buildRows([{ url: 'https://1drv.ms/x/s!AaBbCcDdEeFfGgHh' }]);
    expect(row?.state).toBe('failed');
    expect(row?.selected).toBe(false);
    expect(row?.result.ok).toBe(false);
    if (row !== undefined && !row.result.ok) {
      expect(row.result.reason).toBe('consumer_onedrive');
      expect(row.result.message).toContain('personal (consumer) OneDrive link');
    }
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

describe('describeRow (popup layout)', () => {
  const DIRECT = 'https://contoso.sharepoint.com/sites/SiteA/Lib/Folder/Report.pdf';
  const TOKEN = 'https://contoso.sharepoint.com/:b:/s/SiteA/EaBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789abc?e=Ab12Cd';
  const FOLDER = 'https://contoso.sharepoint.com/sites/SiteA/Lib/Forms/AllItems.aspx?id=%2Fsites%2FSiteA%2FLib%2FProjects&parent=%2Fsites%2FSiteA%2FLib%2FProjects';

  it('shows the parsed folder, the original and folder links, and marks an inferred library', () => {
    const [row] = buildRows([{ url: DIRECT }]);
    const view = describeRow(row!);
    expect(view).toMatchObject({
      state: 'Inferred',
      locationLabel: 'Document location',
      location: '/sites/SiteA/Lib/Folder',
      failed: false,
      libraryInferred: true,
      originalUrl: DIRECT,
      folderUrl: 'https://contoso.sharepoint.com/sites/SiteA/Lib/Folder',
    });
    expect(view.entryId).toBeUndefined();
    expect(view.notes).toEqual([]);
  });

  it('labels a folder as a folder', () => {
    const [row] = buildRows([{ url: FOLDER }]);
    expect(describeRow(row!)).toMatchObject({ locationLabel: 'Folder location', location: '/sites/SiteA/Lib/Projects' });
  });

  it('says an Unresolved location is unknown and offers no folder link', () => {
    const [row] = buildRows([{ url: TOKEN }]);
    const view = describeRow(row!);
    expect(view.state).toBe('Unresolved');
    expect(view.location).toBeUndefined();
    expect(view.locationNote).toBe('Unknown until the link is verified.');
    expect(view.folderUrl).toBeUndefined();
    expect(view.notes.map((n) => n.text)).toEqual(['Verifies in BreadCrumb once you are signed in there.']);
  });

  it('uses what BreadCrumb verified, with its entry, and drops the inferred marker', () => {
    const [row] = buildRows([{ url: DIRECT }]);
    row!.known = { id: 4, state: 'Verified', verified: true, path: '/sites/SiteA/Shared Documents/General/Report.pdf', folder: '/sites/SiteA/Shared Documents/General', folderUrl: 'https://contoso.sharepoint.com/sites/SiteA/Shared%20Documents/General' };
    const view = describeRow(row!);
    expect(view).toMatchObject({ state: 'Verified', location: '/sites/SiteA/Shared Documents/General', folderUrl: 'https://contoso.sharepoint.com/sites/SiteA/Shared%20Documents/General', entryId: 4, libraryInferred: false });
    expect(view.notes).toEqual([]);
  });

  it('shows a SharePoint session confirmation as Verified with a note', () => {
    const [row] = buildRows([{ url: TOKEN }]);
    const verified = {
      path: '/sites/SiteA/Shared Documents/Plans/Plan.pdf',
      folderUrl: 'https://contoso.sharepoint.com/sites/SiteA/Shared%20Documents/Plans',
      components: { fileName: 'Plan.pdf' },
    } as unknown as VerifiedResult;
    row!.session = { ok: true, verified };
    const view = describeRow(row!);
    expect(view).toMatchObject({ state: 'Verified', locationLabel: 'Document location', location: '/sites/SiteA/Shared Documents/Plans', folderUrl: verified.folderUrl });
    expect(view.notes).toEqual([{ text: 'Confirmed with your SharePoint session.', tone: 'ok' }]);
  });

  it('shows a failure message in place of the location, for example a consumer OneDrive link', () => {
    const [row] = buildRows([{ url: 'https://1drv.ms/x/s!AaBbCcDdEeFfGgHh' }]);
    const view = describeRow(row!);
    expect(view.failed).toBe(true);
    expect(view.state).toBe('failed');
    expect(view.stateLabel).toBe('Not supported');
    expect(describeRow(buildRows([{ url: 'nope' }])[0]!).stateLabel).toBe('Failed');
    expect(view.locationNote).toContain('which is not supported');
    expect(view.folderUrl).toBeUndefined();
  });

  it('reports the send outcome and the new entry', () => {
    const [row] = buildRows([{ url: DIRECT }]);
    row!.outcome = { ok: true, id: 9, state: 'Inferred' };
    expect(describeRow(row!)).toMatchObject({ entryId: 9, notes: [{ text: 'Sent.', tone: 'ok' }] });
    row!.outcome = { ok: false, message: 'Could not reach BreadCrumb.' };
    expect(describeRow(row!).notes).toEqual([{ text: 'Could not reach BreadCrumb.', tone: 'fail' }]);
  });

  it('splits a path after each slash so it wraps between names', () => {
    expect(pathSegments('/sites/SiteA/Shared Documents/Folder')).toEqual(['/', 'sites/', 'SiteA/', 'Shared Documents/', 'Folder']);
    expect(pathSegments('/sites/SiteA/Shared Documents/Folder').join('')).toBe('/sites/SiteA/Shared Documents/Folder');
  });
});

describe('copying selected links', () => {
  const A = 'https://contoso.sharepoint.com/sites/SiteA/Lib/Folder/Report.pdf';
  const B = 'https://contoso.sharepoint.com/sites/SiteA/Lib/Folder/Budget.xlsx';
  const C = 'https://contoso.sharepoint.com/sites/SiteA/Lib/Other/Plan.docx';
  const TOKEN = 'https://contoso.sharepoint.com/:b:/s/SiteA/EaBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789abc?e=Ab12Cd';

  it('copies the original links of ticked rows only, one per line', () => {
    const rows = buildRows([{ url: A }, { url: B }, { url: TOKEN }, { url: 'https://1drv.ms/x/s!AaBbCcDdEeFfGgHh' }]);
    rows[1]!.selected = false;
    const selection = selectedFileLinks(rows);
    expect(selection).toEqual({ selected: 2, links: [A, TOKEN], skipped: 0 });
    expect(clipboardText(selection)).toBe(`${A}
${TOKEN}`);
    expect(copySummary('file', selection)).toBe('Copied 2 file links.');
  });

  it('copies each folder once and leaves out files whose folder is not known yet', () => {
    const rows = buildRows([{ url: A }, { url: B }, { url: C }, { url: TOKEN }]);
    const selection = selectedFolderLinks(rows);
    expect(selection).toEqual({
      selected: 4,
      links: ['https://contoso.sharepoint.com/sites/SiteA/Lib/Folder', 'https://contoso.sharepoint.com/sites/SiteA/Lib/Other'],
      skipped: 1,
    });
    expect(copySummary('folder', selection)).toBe('Copied 2 folder links for 3 files. 1 selected file has no known folder yet, so it was left out.');
  });

  it('uses the verified folder once BreadCrumb or the session knows it', () => {
    const rows = buildRows([{ url: TOKEN }]);
    rows[0]!.known = { id: 3, state: 'Verified', verified: true, folder: '/sites/SiteA/Shared Documents/Plans', folderUrl: 'https://contoso.sharepoint.com/sites/SiteA/Shared%20Documents/Plans' };
    expect(selectedFolderLinks(rows).links).toEqual(['https://contoso.sharepoint.com/sites/SiteA/Shared%20Documents/Plans']);
  });

  it('says why nothing was copied', () => {
    const rows = buildRows([{ url: A }, { url: TOKEN }]);
    rows[0]!.selected = false;
    rows[1]!.selected = false;
    expect(copySummary('file', selectedFileLinks(rows))).toBe('Tick at least one file first. Nothing was copied.');
    rows[1]!.selected = true;
    expect(copySummary('folder', selectedFolderLinks(rows))).toBe('The selected file has no known folder yet. Nothing was copied.');
    expect(copySummary('file', selectedFileLinks(rows))).toBe('Copied 1 file link.');
  });
});
