import { parseLink, type ParseSuccess } from '@breadcrumb/parser';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../src/db/connection.js';
import { SqliteHistoryStore } from '../src/db/historyStore.js';
import { migrate } from '../src/db/migrate.js';
import { FOLDER_LINK, WORKED_EXAMPLE, WORKED_EXAMPLE_PATH } from './helpers.js';

function createStore(): SqliteHistoryStore {
  const db = openDatabase(':memory:');
  migrate(db);
  return new SqliteHistoryStore(db);
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
