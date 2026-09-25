import { describe, expect, it } from 'vitest';
import { deleteEntries, type HistoryEntry, type StorageAreaLike } from '../src/history.js';
import { exportName, filterEntries, formatSeen, newestFirst, statesIn, toCsv, toJson } from '../src/historyView.js';

const entry = (overrides: Partial<HistoryEntry> = {}): HistoryEntry => ({
  documentKey: 'doc-1',
  url: 'https://contoso.sharepoint.com/sites/SiteA/Lib/Folder/Report.pdf',
  label: 'Report.pdf',
  state: 'Inferred',
  path: '/sites/SiteA/Lib/Folder/Report.pdf',
  folder: '/sites/SiteA/Lib/Folder',
  source: 'extracted',
  firstSeenAt: '2026-09-01T09:00:00.000Z',
  lastSeenAt: '2026-09-01T09:00:00.000Z',
  ...overrides,
});

const corpus: HistoryEntry[] = [
  entry({ documentKey: 'a', label: 'Budget 2026.xlsx', path: '/sites/Finance/Shared Documents/Budget 2026.xlsx', folder: '/sites/Finance/Shared Documents', state: 'Verified', lastSeenAt: '2026-09-03T09:00:00.000Z' }),
  entry({ documentKey: 'b', label: 'Report.pdf', state: 'Inferred', lastSeenAt: '2026-09-02T09:00:00.000Z', source: 'pasted' }),
  entry({ documentKey: 'c', label: 'Plan.docx', path: '/sites/SiteB/Lib/Plan.docx', folder: '/sites/SiteB/Lib', state: 'Verified', lastSeenAt: '2026-09-01T09:00:00.000Z', sentToNoteAt: '2026-09-01T10:00:00.000Z' }),
];

describe('finding something again (BC-056)', () => {
  it('lists the newest first', () => {
    expect(newestFirst(corpus).map((e) => e.documentKey)).toEqual(['a', 'b', 'c']);
  });

  it('searches the file name, the folder and the link, ignoring case', () => {
    expect(filterEntries(corpus, { search: 'budget' }).map((e) => e.documentKey)).toEqual(['a']);
    expect(filterEntries(corpus, { search: 'siteb' }).map((e) => e.documentKey)).toEqual(['c']);
    expect(filterEntries(corpus, { search: 'sharepoint.com' }).map((e) => e.documentKey)).toEqual(['a', 'b', 'c']);
    expect(filterEntries(corpus, { search: 'nothing here' })).toEqual([]);
  });

  it('filters by state, by how it was found, and by what reached the note', () => {
    expect(filterEntries(corpus, { state: 'Verified' }).map((e) => e.documentKey)).toEqual(['a', 'c']);
    expect(filterEntries(corpus, { source: 'pasted' }).map((e) => e.documentKey)).toEqual(['b']);
    expect(filterEntries(corpus, { sentOnly: true }).map((e) => e.documentKey)).toEqual(['c']);
  });

  it('combines the search with the filters', () => {
    expect(filterEntries(corpus, { search: 'plan', state: 'Verified', sentOnly: true }).map((e) => e.documentKey)).toEqual(['c']);
    expect(filterEntries(corpus, { search: 'plan', state: 'Inferred' })).toEqual([]);
  });

  it('offers only the states that are actually there', () => {
    expect(statesIn(corpus)).toEqual(['Inferred', 'Verified']);
  });

  it('stays quick at two thousand entries', () => {
    const many = Array.from({ length: 2000 }, (_, i) => entry({ documentKey: `k-${i}`, label: `File ${i}.docx`, lastSeenAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString() }));
    const started = performance.now();
    const found = filterEntries(many, { search: 'file 1999' });
    expect(found).toHaveLength(1);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});

describe('getting it out again', () => {
  it('writes a CSV with a row per entry and every field', () => {
    const csv = toCsv(filterEntries(corpus, {}));
    const lines = csv.split('\r\n');
    expect(lines[0]).toContain('Document name,File path,Folder,Folder URL,Source URL,State');
    expect(lines).toHaveLength(5); // header, three entries, trailing newline
    expect(lines[1]).toContain('Budget 2026.xlsx');
    expect(csv.startsWith('﻿')).toBe(true);
  });

  it('quotes a value that would otherwise break the columns', () => {
    const awkward = entry({ label: 'Q1, Q2 "final".docx', methodText: 'Line one\nline two' });
    const row = toCsv([awkward]).split('\r\n')[1] ?? '';
    expect(row).toContain('"Q1, Q2 ""final"".docx"');
    expect(row).toContain('"Line one\nline two"');
  });

  it('writes JSON that holds the entries as stored', () => {
    const parsed = JSON.parse(toJson(corpus)) as { entries: HistoryEntry[]; exportedAt: string };
    expect(parsed.entries).toEqual(corpus);
    expect(parsed.exportedAt).toBeTruthy();
  });

  it('names the file by the day, so exports sit together in order', () => {
    expect(exportName('csv', new Date(2026, 8, 25))).toBe('breadcrumb-history-2026-09-25.csv');
    expect(exportName('json', new Date(2026, 11, 1))).toBe('breadcrumb-history-2026-12-01.json');
  });

  it('shows a moment the way the note does', () => {
    expect(formatSeen(new Date(2026, 8, 25, 14, 5).toISOString())).toBe('2026-09-25 14:05');
    expect(formatSeen('not a date')).toBe('not a date');
  });
});

describe('deleting from what is kept', () => {
  function fakeStore(entries: HistoryEntry[]): { store: StorageAreaLike; read: () => HistoryEntry[] } {
    const data: Record<string, unknown> = { history: { version: 1, entries } };
    return {
      read: () => (data['history'] as { entries: HistoryEntry[] }).entries,
      store: {
        async get(keys) {
          const key = Array.isArray(keys) ? keys[0] : keys;
          return typeof key === 'string' && key in data ? { [key]: data[key] } : {};
        },
        async set(items) {
          Object.assign(data, items);
        },
      },
    };
  }

  it('removes exactly what was named and nothing else', async () => {
    const { store, read } = fakeStore([...corpus]);
    const outcome = await deleteEntries(['b'], store);
    expect(outcome).toMatchObject({ ok: true, dropped: 1, total: 2 });
    expect(read().map((e) => e.documentKey)).toEqual(['a', 'c']);
  });

  it('removes a selection in one go', async () => {
    const { store, read } = fakeStore([...corpus]);
    await deleteEntries(['a', 'c'], store);
    expect(read().map((e) => e.documentKey)).toEqual(['b']);
  });

  it('does nothing when nothing was named', async () => {
    const { store, read } = fakeStore([...corpus]);
    expect(await deleteEntries([], store)).toMatchObject({ ok: true, dropped: 0 });
    expect(read()).toHaveLength(3);
  });
});
