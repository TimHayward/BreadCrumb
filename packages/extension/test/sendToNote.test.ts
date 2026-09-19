import { describe, expect, it } from 'vitest';
import { appendRows } from '../src/noteWriter.js';
import { buildRows, noteRowsFor } from '../src/popupModel.js';
import { readNote, writeNote, type DirectoryHandleLike, type FileHandleLike } from '../src/vault.js';

/** The same fake vault as vault.test.ts: a map of path to text. */
function fakeVault(files: Record<string, string> = {}): { handle: DirectoryHandleLike; files: Record<string, string> } {
  const make = (prefix: string, name: string): DirectoryHandleLike => ({
    name,
    async getDirectoryHandle(child, opts) {
      const path = `${prefix}${child}/`;
      if (!Object.keys(files).some((key) => key.startsWith(path)) && opts?.create !== true) {
        throw new DOMException('not found', 'NotFoundError');
      }
      return make(path, child);
    },
    async getFileHandle(child, opts): Promise<FileHandleLike> {
      const path = `${prefix}${child}`;
      if (files[path] === undefined && opts?.create !== true) {
        throw new DOMException('not found', 'NotFoundError');
      }
      return {
        async getFile() {
          return { text: async () => files[path] ?? '' };
        },
        async createWritable() {
          let buffer = '';
          return {
            async write(data: string) {
              buffer += data;
            },
            async close() {
              files[path] = buffer;
            },
          };
        },
      };
    },
  });
  return { handle: make('', 'MyVault'), files };
}

/** What the popup does when Send is pressed, without the browser parts. */
async function send(vault: DirectoryHandleLike, path: string, citations: Array<{ url: string }>, now: Date): Promise<void> {
  const selection = noteRowsFor(buildRows(citations), now);
  const current = await readNote(vault, path);
  const outcome = appendRows({ rows: selection.rows, now, ...(current === undefined ? {} : { current }) });
  if (!outcome.ok) {
    throw new Error(outcome.message);
  }
  await writeNote(vault, path, outcome.text);
}

describe('sending citations to a note, end to end (BC-067)', () => {
  const NOTE = 'BreadCrumb/Document locations.md';
  const REPORT = 'https://contoso.sharepoint.com/sites/SiteA/Lib/Folder/Report.pdf';
  const BUDGET = 'https://contoso.sharepoint.com/sites/SiteB/Lib/Finance/Budget.xlsx';
  const TOKEN = 'https://contoso.sharepoint.com/:b:/s/SiteA/EaBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789abc?e=Ab12Cd';

  it('creates the note on the first send and appends on the second', async () => {
    const { handle, files } = fakeVault();

    await send(handle, NOTE, [{ url: REPORT }, { url: TOKEN }], new Date(2026, 8, 19, 14, 5));
    const first = files[NOTE] ?? '';
    expect(first).toContain('created: 2026-09-19');
    expect(first).toContain('## Document locations');
    expect(first).toContain('| Document name | File path | Source URL | Folder URL | Date processed |');
    expect(first).toContain('| Report.pdf | /sites/SiteA/Lib/Folder/Report.pdf | ');
    // The Unresolved sharing token has no location yet, so it is not written.
    expect(first).not.toContain('EaBcDeFgHiJkLmNoPqRsTuVwXyZ');
    expect(first.split('\n').filter((l) => l.startsWith('| ')).length).toBe(3);

    await send(handle, NOTE, [{ url: BUDGET }], new Date(2026, 8, 20, 9, 30));
    const second = files[NOTE] ?? '';
    expect(second.split('\n').filter((l) => l.startsWith('| ')).length).toBe(4);
    expect(second).toContain('| Budget.xlsx | /sites/SiteB/Lib/Finance/Budget.xlsx | ');
    expect(second).toContain('2026-09-20 09:30 |');
    expect(second.indexOf('Report.pdf')).toBeLessThan(second.indexOf('Budget.xlsx'));
    expect(second.endsWith('\n')).toBe(true);
  });

  it('sends the same document twice and keeps both rows (decision D12)', async () => {
    const { handle, files } = fakeVault();
    await send(handle, NOTE, [{ url: REPORT }], new Date(2026, 8, 19, 14, 5));
    await send(handle, NOTE, [{ url: REPORT }], new Date(2026, 8, 21, 11, 0));
    const rows = (files[NOTE] ?? '').split('\n').filter((l) => l.startsWith('| Report.pdf'));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain('2026-09-19 14:05');
    expect(rows[1]).toContain('2026-09-21 11:00');
  });

  it('writes into a note the user already had, under their own content', async () => {
    const { handle, files } = fakeVault({ 'Research.md': '# Research\n\nMy own notes.\n' });
    await send(handle, 'Research.md', [{ url: REPORT }], new Date(2026, 8, 19, 14, 5));
    const text = files['Research.md'] ?? '';
    expect(text.startsWith('# Research\n\nMy own notes.\n')).toBe(true);
    expect(text).toContain('## Document locations');
    expect(text).toContain('| Report.pdf |');
  });
});
