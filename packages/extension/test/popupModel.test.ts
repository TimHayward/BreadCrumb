import { describe, expect, it } from 'vitest';
import type { VerifiedResult } from '@breadcrumb/validation';
import { buildRows, clipboardText, copySummary, describeRow, noteRowsFor, pathSegments, recordNoteOutcomes, selectedFileLinks, selectedFolderLinks, sendSummary } from '../src/popupModel.js';

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

describe('describeRow (popup layout)', () => {
  const PLAIN = 'https://contoso.sharepoint.com/sites/SiteA/Lib/Folder/Report.pdf';
  const VIEW_FOLDER = 'https://contoso.sharepoint.com/sites/SiteA/Lib/Forms/AllItems.aspx?id=%2Fsites%2FSiteA%2FLib%2FProjects&parent=%2Fsites%2FSiteA%2FLib%2FProjects';

  it('shows the parsed folder, the original and folder links, and marks an inferred library', () => {
    const [row] = buildRows([{ url: PLAIN }]);
    const view = describeRow(row!);
    expect(view).toMatchObject({
      state: 'Inferred',
      locationLabel: 'Document location',
      location: '/sites/SiteA/Lib/Folder',
      failed: false,
      libraryInferred: true,
      originalUrl: PLAIN,
      folderUrl: 'https://contoso.sharepoint.com/sites/SiteA/Lib/Folder',
    });
    expect(view.notes).toEqual([]);
  });

  it('labels a folder as a folder', () => {
    const [row] = buildRows([{ url: VIEW_FOLDER }]);
    expect(describeRow(row!)).toMatchObject({ locationLabel: 'Folder location', location: '/sites/SiteA/Lib/Projects' });
  });

  it('says an Unresolved location is unknown, offers no folder link and points at the options page', () => {
    const [row] = buildRows([{ url: TOKEN }]);
    const view = describeRow(row!);
    expect(view.state).toBe('Unresolved');
    expect(view.location).toBeUndefined();
    expect(view.locationNote).toBe('Unknown until the link is confirmed.');
    expect(view.folderUrl).toBeUndefined();
    expect(view.notes.map((n) => n.text)).toEqual(['Allow this tenant on the options page to confirm it.']);
  });

  it('shows a SharePoint session confirmation as Verified with a note, and drops the inferred marker', () => {
    const [row] = buildRows([{ url: PLAIN }]);
    const verified = {
      path: '/sites/SiteA/Shared Documents/Plans/Report.pdf',
      folderUrl: 'https://contoso.sharepoint.com/sites/SiteA/Shared%20Documents/Plans',
      components: { fileName: 'Report.pdf' },
    } as unknown as VerifiedResult;
    row!.session = { ok: true, verified };
    const view = describeRow(row!);
    expect(view).toMatchObject({
      state: 'Verified',
      location: '/sites/SiteA/Shared Documents/Plans',
      folderUrl: verified.folderUrl,
      libraryInferred: false,
    });
    expect(view.notes).toEqual([{ text: 'Confirmed with your SharePoint session.', tone: 'ok' }]);
  });

  it('says when the session could not confirm a row', () => {
    const [row] = buildRows([{ url: TOKEN }]);
    row!.session = { ok: false, reason: 'failed', message: 'SharePoint answered 404.' };
    const notes = describeRow(row!).notes;
    expect(notes.some((n) => n.text === 'Your SharePoint session could not confirm it.' && n.detail === 'SharePoint answered 404.')).toBe(true);
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

  it('splits a path after each slash so it wraps between names', () => {
    expect(pathSegments('/sites/SiteA/Shared Documents/Folder')).toEqual(['/', 'sites/', 'SiteA/', 'Shared Documents/', 'Folder']);
    expect(pathSegments('/sites/SiteA/Shared Documents/Folder').join('')).toBe('/sites/SiteA/Shared Documents/Folder');
  });
});

describe('copying selected links', () => {
  const A = 'https://contoso.sharepoint.com/sites/SiteA/Lib/Folder/Report.pdf';
  const B = 'https://contoso.sharepoint.com/sites/SiteA/Lib/Folder/Budget.xlsx';
  const C = 'https://contoso.sharepoint.com/sites/SiteA/Lib/Other/Plan.docx';

  it('copies the original links of ticked rows only, one per line', () => {
    const rows = buildRows([{ url: A }, { url: B }, { url: TOKEN }, { url: 'https://1drv.ms/x/s!AaBbCcDdEeFfGgHh' }]);
    rows[1]!.selected = false;
    const selection = selectedFileLinks(rows);
    expect(selection).toEqual({ selected: 2, links: [A, TOKEN], skipped: 0 });
    expect(clipboardText(selection)).toBe(`${A}\n${TOKEN}`);
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

  it('uses the folder the SharePoint session confirmed', () => {
    const rows = buildRows([{ url: TOKEN }]);
    rows[0]!.session = {
      ok: true,
      verified: {
        path: '/sites/SiteA/Shared Documents/Plans/Plan.pdf',
        folderUrl: 'https://contoso.sharepoint.com/sites/SiteA/Shared%20Documents/Plans',
        components: { fileName: 'Plan.pdf' },
      } as unknown as VerifiedResult,
    };
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

describe('rows for the Obsidian note (BC-067)', () => {
  const NOW = new Date(2026, 8, 19, 14, 5);
  const FILE = 'https://contoso.sharepoint.com/sites/SiteA/Lib/Folder/Report.pdf';

  it('maps a ticked row onto the five columns', () => {
    const rows = buildRows([{ url: FILE }]);
    const selection = noteRowsFor(rows, NOW);
    expect(selection.skipped).toEqual([]);
    expect(selection.rows).toEqual([
      {
        documentName: 'Report.pdf',
        filePath: '/sites/SiteA/Lib/Folder/Report.pdf',
        sourceUrl: FILE,
        folderUrl: 'https://contoso.sharepoint.com/sites/SiteA/Lib/Folder',
        processedAt: '2026-09-19 14:05',
      },
    ]);
  });

  it('prefers what the SharePoint session confirmed', () => {
    const rows = buildRows([{ url: TOKEN }]);
    rows[0]!.session = {
      ok: true,
      verified: {
        path: '/sites/SiteA/Shared Documents/Plans/Plan.pdf',
        folderUrl: 'https://contoso.sharepoint.com/sites/SiteA/Shared%20Documents/Plans',
        components: { fileName: 'Plan.pdf' },
      } as unknown as VerifiedResult,
    };
    expect(noteRowsFor(rows, NOW).rows[0]).toMatchObject({
      filePath: '/sites/SiteA/Shared Documents/Plans/Plan.pdf',
      folderUrl: 'https://contoso.sharepoint.com/sites/SiteA/Shared%20Documents/Plans',
    });
  });

  it('leaves out ticked rows whose location is unknown, and says why', () => {
    const rows = buildRows([{ url: FILE }, { url: TOKEN }, { url: 'https://1drv.ms/x/s!AaBbCcDdEeFfGgHh' }]);
    rows[2]!.selected = true;
    const selection = noteRowsFor(rows, NOW);
    expect(selection.rows).toHaveLength(1);
    expect(selection.skipped.map((s) => s.reason)).toEqual(['its location is not known until it is confirmed', 'the link could not be converted']);
  });

  it('ignores rows that are not ticked', () => {
    const rows = buildRows([{ url: FILE }]);
    rows[0]!.selected = false;
    expect(noteRowsFor(rows, NOW)).toEqual({ entries: [], rows: [], skipped: [] });
  });

  it('says what happened, including what was left out', () => {
    const path = 'BreadCrumb/Document locations.md';
    expect(sendSummary({ rowsAdded: 2, createdNote: true, createdTable: true }, [], path)).toBe('Created BreadCrumb/Document locations.md and added 2 rows.');
    expect(sendSummary({ rowsAdded: 1, createdNote: false, createdTable: true }, [], path)).toBe('Added the table to BreadCrumb/Document locations.md and wrote 1 row.');
    expect(sendSummary({ rowsAdded: 3, createdNote: false, createdTable: false }, [{ row: buildRows([{ url: 'nope' }])[0]!, label: 'x', reason: 'the link could not be converted' }], path)).toBe(
      'Added 3 rows. 1 selected file left out: the link could not be converted.',
    );
  });
});

describe('what each row says after a send (BC-067)', () => {
  const NOW = new Date(2026, 8, 20, 10, 15);
  const FILE = 'https://contoso.sharepoint.com/sites/SiteA/Lib/Folder/Report.pdf';

  it('marks the rows that were written and the ones that were left out', () => {
    const rows = buildRows([{ url: FILE }, { url: TOKEN }]);
    const selection = noteRowsFor(rows, NOW);
    recordNoteOutcomes(selection, { ok: true, notePath: 'BreadCrumb/Document locations.md' });

    expect(rows[0]?.noteOutcome).toEqual({ ok: true, notePath: 'BreadCrumb/Document locations.md', processedAt: '2026-09-20 10:15' });
    expect(describeRow(rows[0]!).notes).toContainEqual({ text: 'Added to your note at 2026-09-20 10:15.', tone: 'ok' });

    expect(rows[1]?.noteOutcome).toEqual({ ok: false, reason: 'its location is not known until it is confirmed' });
    expect(describeRow(rows[1]!).notes).toContainEqual({
      text: 'Not written to your note: its location is not known until it is confirmed.',
      tone: 'fail',
    });
  });

  it('marks every ticked row when the write itself failed', () => {
    const rows = buildRows([{ url: FILE }]);
    const selection = noteRowsFor(rows, NOW);
    recordNoteOutcomes(selection, { ok: false, reason: 'the vault folder is no longer available' });
    expect(describeRow(rows[0]!).notes).toContainEqual({ text: 'Not written to your note: the vault folder is no longer available.', tone: 'fail' });
  });

  it('leaves untouched rows without an outcome', () => {
    const rows = buildRows([{ url: FILE }, { url: TOKEN }]);
    rows[1]!.selected = false;
    recordNoteOutcomes(noteRowsFor(rows, NOW), { ok: true, notePath: 'note.md' });
    expect(rows[1]?.noteOutcome).toBeUndefined();
    expect(describeRow(rows[1]!).notes.some((n) => n.text.includes('your note'))).toBe(false);
  });
});
