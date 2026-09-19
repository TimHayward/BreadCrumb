import { describe, expect, it } from 'vitest';
import { COLUMNS, appendRows, escapeCell, formatProcessedAt, formatRow, rowsForClipboard, type NoteRow } from '../src/noteWriter.js';

const NOW = new Date(2026, 8, 19, 14, 5);

const row = (overrides: Partial<NoteRow> = {}): NoteRow => ({
  documentName: 'Report.pdf',
  filePath: '/sites/SiteA/Shared Documents/Folder/Report.pdf',
  sourceUrl: 'https://contoso.sharepoint.com/sites/SiteA/Lib/Folder/Report.pdf',
  folderUrl: 'https://contoso.sharepoint.com/sites/SiteA/Lib/Folder',
  processedAt: formatProcessedAt(NOW),
  ...overrides,
});

describe('the table format (BC-068, decision D19)', () => {
  it('writes the five columns in the agreed order', () => {
    expect([...COLUMNS]).toEqual(['Document name', 'File path', 'Source URL', 'Folder URL', 'Date processed']);
    expect(formatRow(row())).toBe(
      '| Report.pdf | /sites/SiteA/Shared Documents/Folder/Report.pdf | https://contoso.sharepoint.com/sites/SiteA/Lib/Folder/Report.pdf | https://contoso.sharepoint.com/sites/SiteA/Lib/Folder | 2026-09-19 14:05 |',
    );
  });

  it('formats the date as local YYYY-MM-DD HH:mm', () => {
    expect(formatProcessedAt(new Date(2026, 0, 2, 9, 7))).toBe('2026-01-02 09:07');
  });

  it('keeps a value from breaking the table', () => {
    expect(escapeCell('Q1 | Q2 report')).toBe('Q1 \\| Q2 report');
    expect(escapeCell('two\nlines')).toBe('two lines');
    const cells = formatRow(row({ documentName: 'a|b', filePath: '/sites/x\ny' })).split(' | ');
    expect(cells[0]).toBe('| a\\|b');
    expect(cells[1]).toBe('/sites/x y');
  });
});

describe('appending rows (BC-067)', () => {
  it('creates the note with front matter, heading and header when there is none', () => {
    const outcome = appendRows({ rows: [row()], now: NOW });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.createdNote).toBe(true);
    expect(outcome.createdTable).toBe(true);
    expect(outcome.rowsAdded).toBe(1);
    expect(outcome.text).toBe(
      [
        '---',
        'created: 2026-09-19',
        'tags:',
        '  - breadcrumb',
        '---',
        '',
        '## Document locations',
        '',
        '| Document name | File path | Source URL | Folder URL | Date processed |',
        '| --- | --- | --- | --- | --- |',
        formatRow(row()),
        '',
      ].join('\n'),
    );
  });

  it('appends into the existing table and leaves the rest of the note alone', () => {
    const first = appendRows({ rows: [row()], now: NOW });
    if (!first.ok) throw new Error('first append failed');
    const withNotes = `${first.text.trimEnd()}\n\n## My own notes\n\nSomething I wrote.\n`;
    const second = appendRows({ current: withNotes, rows: [row({ documentName: 'Budget.xlsx' })], now: NOW });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.createdNote).toBe(false);
    expect(second.createdTable).toBe(false);
    const lines = second.text.split('\n');
    expect(lines.filter((l) => l.startsWith('| Report.pdf'))).toHaveLength(1);
    expect(lines.filter((l) => l.startsWith('| Budget.xlsx'))).toHaveLength(1);
    expect(lines.indexOf('## My own notes')).toBeGreaterThan(lines.findIndex((l) => l.startsWith('| Budget.xlsx')));
    expect(second.text).toContain('Something I wrote.');
    expect(second.text.endsWith('\n')).toBe(true);
    expect(second.text.endsWith('\n\n')).toBe(false);
  });

  it('always appends, even for a document already in the table (decision D12)', () => {
    const first = appendRows({ rows: [row()], now: NOW });
    if (!first.ok) throw new Error('first append failed');
    const again = appendRows({ current: first.text, rows: [row({ processedAt: '2026-09-20 09:00' })], now: NOW });
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.text.split('\n').filter((l) => l.startsWith('| Report.pdf'))).toHaveLength(2);
  });

  it('adds the table to a note that has none, keeping what is already there', () => {
    const outcome = appendRows({ current: '# My research\n\nNotes I took earlier.\n', rows: [row()], now: NOW });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.createdNote).toBe(false);
    expect(outcome.createdTable).toBe(true);
    expect(outcome.text.startsWith('# My research\n\nNotes I took earlier.\n\n## Document locations\n')).toBe(true);
    expect(outcome.text).toContain('| Document name | File path |');
  });

  it('handles a note with no trailing newline and with Windows line endings', () => {
    const outcome = appendRows({ current: '# Notes\r\n\r\nText', rows: [row()], now: NOW });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.text).toContain('# Notes');
    expect(outcome.text).toContain('Text');
    expect(outcome.text.endsWith('\n')).toBe(true);
  });

  it('refuses a table whose columns someone changed, and writes nothing', () => {
    const current = ['## Document locations', '', '| Name | Where |', '| --- | --- |', '| Old.pdf | /sites/x |', ''].join('\n');
    const outcome = appendRows({ current, rows: [row()], now: NOW });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe('header_mismatch');
    expect(outcome.message).toContain('Name, Where');
    expect(outcome.message).toContain('Nothing was written');
  });

  it('ignores case when matching the table header', () => {
    const current = ['| document name | file path | source url | folder url | date processed |', '| --- | --- | --- | --- | --- |', ''].join('\n');
    const outcome = appendRows({ current, rows: [row()], now: NOW });
    expect(outcome.ok).toBe(true);
  });
});

describe('copying rows for another note (BC-066)', () => {
  it('gives the rows alone, or with their header', () => {
    expect(rowsForClipboard([row()])).toBe(formatRow(row()));
    const withHeader = rowsForClipboard([row(), row({ documentName: 'Budget.xlsx' })], { withHeader: true }).split('\n');
    expect(withHeader[0]).toBe('| Document name | File path | Source URL | Folder URL | Date processed |');
    expect(withHeader[1]).toBe('| --- | --- | --- | --- | --- |');
    expect(withHeader).toHaveLength(4);
  });
});
