import { describe, expect, it } from 'vitest';
import type { VerifiedResult } from '@breadcrumb/validation';
import { HISTORY_VERSION, applyCap, clearHistory, entryFromRow, markSentToNote, mergeEntry, migrate, readHistory, recordRows, type HistoryEntry, type StorageAreaLike } from '../src/history.js';
import { addPastedRow, buildRows } from '../src/popupModel.js';

const FILE = 'https://contoso.sharepoint.com/sites/SiteA/Lib/Folder/Report.pdf';
const TOKEN = 'https://contoso.sharepoint.com/:b:/s/SiteA/EaBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789abc?e=Ab12Cd';
const NOW = new Date('2026-09-25T10:00:00.000Z');

/** A stand-in for chrome.storage.local, with a switch for a write that fails. */
function fakeStore(initial: Record<string, unknown> = {}): { store: StorageAreaLike; data: Record<string, unknown>; failWrites: (why?: string) => void } {
  const data: Record<string, unknown> = { ...initial };
  let failure: string | undefined;
  return {
    data,
    failWrites: (why = 'the browser refused to store that') => {
      failure = why;
    },
    store: {
      async get(keys) {
        const key = Array.isArray(keys) ? keys[0] : keys;
        return typeof key === 'string' && key in data ? { [key]: data[key] } : {};
      },
      async set(items) {
        if (failure !== undefined) {
          throw new Error(failure);
        }
        Object.assign(data, items);
      },
    },
  };
}

const entry = (overrides: Partial<HistoryEntry> = {}): HistoryEntry => ({
  documentKey: 'doc-1',
  url: FILE,
  label: 'Report.pdf',
  state: 'Inferred',
  source: 'extracted',
  firstSeenAt: '2026-09-01T09:00:00.000Z',
  lastSeenAt: '2026-09-01T09:00:00.000Z',
  ...overrides,
});

describe('what is stored for a row (BC-055)', () => {
  it('keeps the link, the location, how it was worked out and where it was found', () => {
    const [row] = buildRows([{ url: FILE }]);
    const stored = entryFromRow(row!, { pageUrl: 'https://m365.cloud.microsoft/chat', now: NOW });
    expect(stored).toMatchObject({
      url: FILE,
      label: 'Report.pdf',
      state: 'Inferred',
      path: '/sites/SiteA/Lib/Folder/Report.pdf',
      folder: '/sites/SiteA/Lib/Folder',
      folderUrl: 'https://contoso.sharepoint.com/sites/SiteA/Lib/Folder',
      source: 'extracted',
      pageUrl: 'https://m365.cloud.microsoft/chat',
      firstSeenAt: NOW.toISOString(),
    });
    expect(stored.documentKey.length).toBeGreaterThan(0);
    expect(stored.methodText).toBeTruthy();
  });

  it('records a pasted link as pasted (BC-054)', () => {
    const rows = buildRows([]);
    const { row } = addPastedRow(rows, FILE);
    expect(entryFromRow(row, { now: NOW }).source).toBe('pasted');
  });

  it('keeps a link that could not be converted, with the reason as its method (decision D8)', () => {
    const rows = buildRows([]);
    const { row } = addPastedRow(rows, 'https://1drv.ms/x/s!AaBbCcDdEeFfGgHh');
    const stored = entryFromRow(row, { now: NOW });
    expect(stored.state).toBe('failed');
    expect(stored.methodText).toContain('not supported');
  });
});

describe('folding a new sighting into what is known', () => {
  it('updates the entry rather than adding a second one, and keeps the first time seen', () => {
    const merged = mergeEntry(entry(), entry({ url: TOKEN, lastSeenAt: NOW.toISOString(), state: 'Verified', path: '/sites/SiteA/Shared Documents/Report.pdf' }));
    expect(merged.firstSeenAt).toBe('2026-09-01T09:00:00.000Z');
    expect(merged.lastSeenAt).toBe(NOW.toISOString());
    expect(merged.url).toBe(TOKEN);
    expect(merged.state).toBe('Verified');
  });

  it('records the upgrade and keeps what it improved on (invariant 6)', () => {
    const before = entry({ state: 'Inferred', path: '/sites/SiteA/Lib/Folder/Report.pdf' });
    const after = entry({ state: 'Verified', path: '/sites/SiteA/Shared Documents/Folder/Report.pdf', lastSeenAt: NOW.toISOString() });
    expect(mergeEntry(before, after).upgradedFrom).toEqual({ state: 'Inferred', path: '/sites/SiteA/Lib/Folder/Report.pdf', at: NOW.toISOString() });
  });

  it('does not lose what an earlier sighting knew when a later one knows less', () => {
    const known = entry({ state: 'Verified', path: '/sites/SiteA/Shared Documents/Report.pdf', folderUrl: 'https://contoso.sharepoint.com/x' });
    const vague = entry({ state: 'Verified', lastSeenAt: NOW.toISOString() });
    const merged = mergeEntry(known, vague);
    expect(merged.path).toBe('/sites/SiteA/Shared Documents/Report.pdf');
    expect(merged.folderUrl).toBe('https://contoso.sharepoint.com/x');
    expect(merged.upgradedFrom).toBeUndefined();
  });

  it('keeps the note mark once it has been earned (decision D21)', () => {
    const sent = entry({ sentToNoteAt: '2026-09-02T09:00:00.000Z' });
    expect(mergeEntry(sent, entry({ lastSeenAt: NOW.toISOString() })).sentToNoteAt).toBe('2026-09-02T09:00:00.000Z');
  });
});

describe('the cap (decision D15)', () => {
  const many = (count: number, sent = false): HistoryEntry[] =>
    Array.from({ length: count }, (_, i) =>
      entry({
        documentKey: `doc-${i}`,
        lastSeenAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
        ...(sent ? { sentToNoteAt: NOW.toISOString() } : {}),
      }),
    );

  it('leaves everything alone below the cap', () => {
    expect(applyCap(many(10), 2000).dropped).toBe(0);
  });

  it('drops the oldest first, newest kept in order', () => {
    const { entries, dropped } = applyCap(many(10), 4);
    expect(dropped).toBe(6);
    expect(entries).toHaveLength(4);
    expect(entries[0]?.documentKey).toBe('doc-9');
    expect(entries.at(-1)?.documentKey).toBe('doc-6');
  });

  it('keeps what reached the note in preference to what never did', () => {
    const written = many(3, true).map((e, i) => ({ ...e, documentKey: `sent-${i}`, lastSeenAt: new Date(Date.UTC(2020, 0, 1, 0, 0, i)).toISOString() }));
    const { entries } = applyCap([...written, ...many(5)], 4);
    // The three written to the note survive despite being the oldest.
    expect(entries.filter((e) => e.documentKey.startsWith('sent-'))).toHaveLength(3);
    expect(entries).toHaveLength(4);
  });
});

describe('reading and writing', () => {
  it('writes rows, then reads them back', async () => {
    const { store, data } = fakeStore();
    const rows = buildRows([{ url: FILE }, { url: TOKEN }]);
    const outcome = await recordRows(rows, { pageUrl: 'https://m365.cloud.microsoft/chat', now: NOW }, store);
    expect(outcome).toMatchObject({ ok: true, written: 2, dropped: 0, total: 2 });
    expect((data['history'] as { version: number }).version).toBe(HISTORY_VERSION);
    const file = await readHistory(store);
    expect(file.entries.map((e) => e.label)).toEqual(['Report.pdf', expect.any(String)]);
  });

  it('records the same document seen again as one entry', async () => {
    const { store } = fakeStore();
    await recordRows(buildRows([{ url: FILE }]), { now: NOW }, store);
    await recordRows(buildRows([{ url: `${FILE}?web=1` }]), { now: new Date('2026-09-26T10:00:00.000Z') }, store);
    const file = await readHistory(store);
    expect(file.entries).toHaveLength(1);
    expect(file.entries[0]?.firstSeenAt).toBe(NOW.toISOString());
    expect(file.entries[0]?.lastSeenAt).toBe('2026-09-26T10:00:00.000Z');
  });

  it('records a confirmation as an upgrade over what was inferred', async () => {
    const { store } = fakeStore();
    const rows = buildRows([{ url: FILE }]);
    await recordRows(rows, { now: NOW }, store);
    rows[0]!.session = {
      ok: true,
      verified: {
        path: '/sites/SiteA/Shared Documents/Folder/Report.pdf',
        folderUrl: 'https://contoso.sharepoint.com/sites/SiteA/Shared%20Documents/Folder',
        components: { fileName: 'Report.pdf' },
        methodText: 'Confirmed by SharePoint, using your browser session.',
      } as unknown as VerifiedResult,
    };
    await recordRows(rows, { now: new Date('2026-09-25T11:00:00.000Z') }, store);
    const [stored] = (await readHistory(store)).entries;
    expect(stored?.state).toBe('Verified');
    expect(stored?.path).toBe('/sites/SiteA/Shared Documents/Folder/Report.pdf');
    expect(stored?.upgradedFrom).toMatchObject({ state: 'Inferred', path: '/sites/SiteA/Lib/Folder/Report.pdf' });
  });

  it('reports a write that fails rather than failing quietly (invariant 12)', async () => {
    const { store, failWrites } = fakeStore();
    failWrites('QUOTA_BYTES quota exceeded');
    const outcome = await recordRows(buildRows([{ url: FILE }]), { now: NOW }, store);
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain('quota');
  });

  it('marks what reached the note, and clears on request', async () => {
    const { store } = fakeStore();
    const rows = buildRows([{ url: FILE }]);
    await recordRows(rows, { now: NOW }, store);
    const key = (await readHistory(store)).entries[0]?.documentKey as string;
    const marked = await markSentToNote([key], new Date('2026-09-25T12:00:00.000Z'), store);
    expect(marked).toMatchObject({ ok: true, written: 1 });
    expect((await readHistory(store)).entries[0]?.sentToNoteAt).toBe('2026-09-25T12:00:00.000Z');
    await clearHistory(store);
    expect((await readHistory(store)).entries).toEqual([]);
  });

  it('survives nonsense in storage rather than throwing', async () => {
    expect(migrate(undefined).entries).toEqual([]);
    expect(migrate({ version: 99 }).entries).toEqual([]);
    expect(migrate({ version: 1, entries: [{ nope: true }] }).entries).toEqual([]);
    const { store } = fakeStore({ history: 'not an object' });
    expect((await readHistory(store)).entries).toEqual([]);
  });
});
