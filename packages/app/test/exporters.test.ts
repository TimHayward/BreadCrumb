import { parseLink } from '@breadcrumb/parser';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../src/db/connection.js';
import { SqliteHistoryStore } from '../src/db/historyStore.js';
import { migrate } from '../src/db/migrate.js';
import { csvField, exportFileName, toCsv, toJson } from '../src/services/exporters.js';
import { WORKED_EXAMPLE, WORKED_EXAMPLE_PATH } from './helpers.js';

describe('export (BC-035)', () => {
  it('escapes commas and quotes in CSV fields', () => {
    expect(csvField('plain')).toBe('plain');
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField(null)).toBe('');
  });

  it('produces one CSV row per conversion with the documented columns', () => {
    const db = openDatabase(':memory:');
    migrate(db);
    const store = new SqliteHistoryStore(db);
    const direct = 'https://contoso.sharepoint.com/sites/SiteA/Lib/Folder%20One/Report,%20final.pdf';
    store.insert({ source: 'web', input: WORKED_EXAMPLE, result: parseLink(WORKED_EXAMPLE), createdAt: '2026-09-10T10:00:00.000Z' });
    store.insert({ source: 'extension', input: direct, result: parseLink(direct), createdAt: '2026-09-10T11:00:00.000Z' });
    const csv = toCsv(store.all());
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('time,input,path,folderUrl,fileUrl,state,method,source,inferredComponents');
    expect(lines).toHaveLength(4);
    expect(lines[1]).toContain('"/sites/SiteA/Lib/Folder One/Report, final.pdf"');
    expect(lines[1]).toContain(',Inferred,');
    expect(lines[1]).toContain(',extension,library;folders');
    expect(lines[2]).toContain(WORKED_EXAMPLE_PATH);
    expect(lines[2]).toContain(',Derived,');

    const json = JSON.parse(toJson(store.all())) as Array<{ state: string; result: { ok: boolean; components: Record<string, { flag: string }> } }>;
    expect(json).toHaveLength(2);
    expect(json[1]?.state).toBe('Derived');
    expect(json[1]?.result.components['library']?.flag).toBe('Derived');
    db.close();
  });

  it('names the file with the date', () => {
    expect(exportFileName('csv', new Date('2026-09-10T15:00:00Z'))).toBe('breadcrumb-history-2026-09-10.csv');
    expect(exportFileName('json', new Date('2026-09-10T15:00:00Z'))).toBe('breadcrumb-history-2026-09-10.json');
  });
});
