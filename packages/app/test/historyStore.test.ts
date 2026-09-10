import { parseLink, type ParseSuccess } from '@breadcrumb/parser';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../src/db/connection.js';
import { SqliteHistoryStore } from '../src/db/historyStore.js';
import { migrate } from '../src/db/migrate.js';
import { FOLDER_LINK, WORKED_EXAMPLE, WORKED_EXAMPLE_PATH } from './helpers.js';

const TOKEN_LINK = 'https://contoso.sharepoint.com/:b:/s/SiteA/EaBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789abc?e=Ab12Cd';
const DIRECT_LINK = 'https://contoso.sharepoint.com/sites/SiteA/Lib/Folder%20One/Report.pdf';

function createStore(): SqliteHistoryStore {
  const db = openDatabase(':memory:');
  migrate(db);
  return new SqliteHistoryStore(db);
}

function seed(store: SqliteHistoryStore): void {
  store.insert({ source: 'web', input: WORKED_EXAMPLE, result: parseLink(WORKED_EXAMPLE), createdAt: '2026-09-01T10:00:00.000Z' });
  store.insert({ source: 'extension', input: DIRECT_LINK, result: parseLink(DIRECT_LINK), createdAt: '2026-09-02T10:00:00.000Z' });
  store.insert({ source: 'web', input: TOKEN_LINK, result: parseLink(TOKEN_LINK), createdAt: '2026-09-03T10:00:00.000Z' });
  store.insert({ source: 'web', input: 'https://www.example.com/x', result: parseLink('https://www.example.com/x'), createdAt: '2026-09-04T10:00:00.000Z' });
}

describe('SqliteHistoryStore (BC-030)', () => {
  it('stores time, input, full result, state, parser version and source', () => {
    const store = createStore();
    const result = parseLink(WORKED_EXAMPLE) as ParseSuccess;
    const row = store.insert({ source: 'web', input: WORKED_EXAMPLE, result });

    expect(row.id).toBe(1);
    expect(row.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(row.source).toBe('web');
    expect(row.input).toBe(WORKED_EXAMPLE);
    expect(row.state).toBe('Derived');
    expect(row.path).toBe(WORKED_EXAMPLE_PATH);
    expect(row.library).toBe('Projects');
    expect(row.fileName).toBe('SMR SIID 029 - Development Environment for Digital team.pdf');
    expect(row.parserVersion).toBe(result.parserVersion);
    expect(row.result).toEqual(result);
    expect(store.getById(1)).toEqual(row);
  });

  it('keeps two rows when the same link is converted twice (history is a log)', () => {
    const store = createStore();
    const result = parseLink(WORKED_EXAMPLE) as ParseSuccess;
    store.insert({ source: 'web', input: WORKED_EXAMPLE, result, createdAt: '2026-09-10T10:00:00.000Z' });
    store.insert({ source: 'extension', input: WORKED_EXAMPLE, result, createdAt: '2026-09-10T11:00:00.000Z' });
    expect(store.count()).toBe(2);
    const page = store.list({ page: 1, pageSize: 50 });
    expect(page.rows.map((r) => r.source)).toEqual(['extension', 'web']);
  });

  it('stores folder results with no file URL or file name', () => {
    const store = createStore();
    const row = store.insert({ source: 'web', input: FOLDER_LINK, result: parseLink(FOLDER_LINK) });
    expect(row.fileUrl).toBeNull();
    expect(row.fileName).toBeNull();
    expect(row.path).toBe('/teams/SiteB/Lib/Projects/Alpha');
  });

  it('stores Unresolved results with no path and kept failures with no state', () => {
    const store = createStore();
    const unresolved = store.insert({ source: 'web', input: TOKEN_LINK, result: parseLink(TOKEN_LINK) });
    expect(unresolved.state).toBe('Unresolved');
    expect(unresolved.path).toBeNull();
    expect(unresolved.host).toBe('contoso.sharepoint.com');

    const failed = store.insert({ source: 'web', input: 'nope', result: parseLink('nope') });
    expect(failed.state).toBeNull();
    expect(failed.failureReason).toBe('not_a_url');
    expect(failed.result.ok).toBe(false);
  });

  it('pages newest first and clamps the page number', () => {
    const store = createStore();
    const result = parseLink(WORKED_EXAMPLE) as ParseSuccess;
    for (let i = 0; i < 5; i++) {
      store.insert({ source: 'web', input: WORKED_EXAMPLE, result, createdAt: `2026-09-10T10:0${i}:00.000Z` });
    }
    const page1 = store.list({ page: 1, pageSize: 2 });
    expect(page1).toMatchObject({ total: 5, page: 1, pageSize: 2, pageCount: 3 });
    expect(page1.rows.map((r) => r.id)).toEqual([5, 4]);
    expect(store.list({ page: 3, pageSize: 2 }).rows.map((r) => r.id)).toEqual([1]);
    expect(store.list({ page: 99, pageSize: 2 }).page).toBe(3);
    expect(store.list({ page: 0, pageSize: 2 }).page).toBe(1);
  });

  it('returns undefined for an unknown id', () => {
    expect(createStore().getById(42)).toBeUndefined();
  });
});

describe('search and filters (BC-032, BC-033)', () => {
  it('searches input, path, folder URL, file URL and file name case insensitively', () => {
    const store = createStore();
    seed(store);
    const ids = (q: string) => store.list({ page: 1, pageSize: 50, filters: { q } }).rows.map((r) => r.id);
    expect(ids('deloitte')).toEqual([1]);
    expect(ids('REPORT.PDF')).toEqual([2]);
    expect(ids('Folder%20One')).toEqual([2]);
    expect(ids('SiteA')).toEqual([3, 2]);
    expect(ids('example.com')).toEqual([4]);
    expect(ids('nothing matches this')).toEqual([]);
  });

  it('treats LIKE wildcards in the search term literally', () => {
    const store = createStore();
    seed(store);
    // Two seeded inputs contain a literal percent sign (percent escapes); none contains an underscore.
    expect(store.count({ q: '%' })).toBe(2);
    expect(store.count({ q: '%2F' })).toBe(1);
    expect(store.count({ q: '_' })).toBe(0);
    expect(store.count({ q: 'Projects WIP' })).toBe(1);
  });

  it('filters by state including kept failures', () => {
    const store = createStore();
    seed(store);
    expect(store.count({ state: 'Derived' })).toBe(1);
    expect(store.count({ state: 'Inferred' })).toBe(1);
    expect(store.count({ state: 'Unresolved' })).toBe(1);
    expect(store.count({ state: 'Verified' })).toBe(0);
    expect(store.count({ state: 'failed' })).toBe(1);
  });

  it('filters by an inclusive date range, source and host, and combines with search', () => {
    const store = createStore();
    seed(store);
    expect(store.all({ from: '2026-09-02', to: '2026-09-03' }).map((r) => r.id)).toEqual([3, 2]);
    expect(store.all({ from: '2026-09-04' }).map((r) => r.id)).toEqual([4]);
    expect(store.all({ to: '2026-09-01' }).map((r) => r.id)).toEqual([1]);
    expect(store.all({ source: 'extension' }).map((r) => r.id)).toEqual([2]);
    expect(store.all({ host: 'contoso' }).map((r) => r.id)).toEqual([3, 2]);
    expect(store.all({ host: '848' }).map((r) => r.id)).toEqual([1]);
    expect(store.all({ q: 'SiteA', source: 'web' }).map((r) => r.id)).toEqual([3]);
    expect(store.all({ from: 'not-a-date' }).length).toBe(4);
  });
});

describe('delete (BC-034)', () => {
  it('deletes one or several rows and reports the count', () => {
    const store = createStore();
    seed(store);
    expect(store.delete([2])).toBe(1);
    expect(store.getById(2)).toBeUndefined();
    expect(store.delete([1, 3, 999, 3])).toBe(2);
    expect(store.count()).toBe(1);
    expect(store.delete([])).toBe(0);
  });
});
