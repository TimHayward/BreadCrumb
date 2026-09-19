/**
 * BC-068: the Obsidian note and its table, as pure text.
 *
 * Everything here takes the note's current text and returns its new text, so
 * the rules are testable without a file system. The note is ordinary
 * Markdown: a person can read, edit and keep it with no BreadCrumb involved
 * (invariant 20).
 *
 * Columns, fixed by decision D19: Document name, File path, Source URL,
 * Folder URL, Date processed. Rows are always appended, never matched or
 * updated (decision D12), so the note is a log of what was sent and when.
 */

/** The columns, in order. The header row is how an existing table is recognised. */
export const COLUMNS = ['Document name', 'File path', 'Source URL', 'Folder URL', 'Date processed'] as const;

/** The heading the table sits under in a note BreadCrumb creates. */
export const TABLE_HEADING = '## Document locations';

/** One row's values, in column order. */
export interface NoteRow {
  documentName: string;
  filePath: string;
  sourceUrl: string;
  folderUrl: string;
  processedAt: string;
}

/** Local `YYYY-MM-DD HH:mm`, the format D19 fixed for Date processed. */
export function formatProcessedAt(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * Makes a value safe inside a table cell: a pipe would end the cell and a
 * newline would end the row, so the first is escaped and the second becomes
 * a space. Everything else is left exactly as it is.
 */
export function escapeCell(value: string): string {
  return value.replace(/\r\n|\r|\n/g, ' ').replace(/\|/g, '\\|').trim();
}

export function formatRow(row: NoteRow): string {
  const cells = [row.documentName, row.filePath, row.sourceUrl, row.folderUrl, row.processedAt].map(escapeCell);
  return `| ${cells.join(' | ')} |`;
}

/** The header and its separator, as the two lines that open a table. */
export function tableHeader(): string[] {
  return [`| ${COLUMNS.join(' | ')} |`, `| ${COLUMNS.map(() => '---').join(' | ')} |`];
}

/** The front matter and heading a note BreadCrumb creates starts with. */
export function newNote(createdAt: Date): string[] {
  const created = formatProcessedAt(createdAt).slice(0, 10);
  return ['---', `created: ${created}`, 'tags:', '  - breadcrumb', '---', '', TABLE_HEADING, '', ...tableHeader()];
}

function isTableLine(line: string): boolean {
  return line.trimStart().startsWith('|');
}

/** Cell values of a table line, without the leading and trailing pipes. */
function cellsOf(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map((cell) => cell.trim());
}

/** A separator line such as `| --- | --- |`, which no data row looks like. */
function isSeparator(line: string): boolean {
  return isTableLine(line) && cellsOf(line).every((cell) => /^:?-{1,}:?$/.test(cell));
}

/**
 * Finds BreadCrumb's table by its header row, and returns the index of the
 * line after its last row. A table whose header does not match the columns
 * is not ours: it is left alone and reported, rather than written into
 * (BC-068).
 */
export interface TableLocation {
  /** Index of the line after the table's last row, where new rows go. */
  insertAt: number;
  /** The table's own header cells, which the caller checks against COLUMNS. */
  header: string[];
}

export function findTable(lines: readonly string[]): TableLocation | undefined {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined || !isTableLine(line) || isSeparator(line)) {
      continue;
    }
    const header = cellsOf(line);
    const next = lines[i + 1];
    if (next === undefined || !isSeparator(next)) {
      continue;
    }
    let end = i + 2;
    while (end < lines.length && isTableLine(lines[end] ?? '')) {
      end += 1;
    }
    return { insertAt: end, header };
  }
  return undefined;
}

export type AppendOutcome =
  | { ok: true; text: string; createdNote: boolean; createdTable: boolean; rowsAdded: number }
  | { ok: false; reason: 'header_mismatch'; message: string };

export interface AppendOptions {
  /** The note's current text, or undefined when the note does not exist yet. */
  current?: string;
  rows: readonly NoteRow[];
  /** Taken as "now" for a new note's `created` front matter. */
  now: Date;
}

/**
 * Adds rows to the note's table, creating the note or the table when they are
 * not there. Nothing outside the table is touched, and the text always ends
 * with exactly one newline.
 */
export function appendRows(options: AppendOptions): AppendOutcome {
  const rows = options.rows.map(formatRow);
  const current = options.current;

  if (current === undefined || current.trim() === '') {
    const lines = [...newNote(options.now), ...rows];
    return { ok: true, text: `${lines.join('\n')}\n`, createdNote: current === undefined, createdTable: true, rowsAdded: rows.length };
  }

  const lines = current.split(/\r\n|\r|\n/);
  const table = findTable(lines);

  if (table === undefined) {
    // No table yet: add the heading and header at the end, leaving the rest alone.
    const body = [...lines];
    while (body.length > 0 && body[body.length - 1]?.trim() === '') {
      body.pop();
    }
    const next = [...body, '', TABLE_HEADING, '', ...tableHeader(), ...rows];
    return { ok: true, text: `${next.join('\n')}\n`, createdNote: false, createdTable: true, rowsAdded: rows.length };
  }

  const expected = [...COLUMNS];
  const sameColumns = table.header.length === expected.length && table.header.every((cell, i) => cell.toLowerCase() === expected[i]?.toLowerCase());
  if (!sameColumns) {
    return {
      ok: false,
      reason: 'header_mismatch',
      message: `The table in this note has the columns ${table.header.join(', ')}, but BreadCrumb writes ${expected.join(', ')}. Nothing was written. Point BreadCrumb at another note, or make the columns match.`,
    };
  }

  const next = [...lines.slice(0, table.insertAt), ...rows, ...lines.slice(table.insertAt)];
  while (next.length > 0 && next[next.length - 1]?.trim() === '') {
    next.pop();
  }
  return { ok: true, text: `${next.join('\n')}\n`, createdNote: false, createdTable: false, rowsAdded: rows.length };
}

/** The selection as table rows for the clipboard (BC-066). */
export function rowsForClipboard(rows: readonly NoteRow[], options: { withHeader?: boolean } = {}): string {
  const lines = options.withHeader === true ? [...tableHeader(), ...rows.map(formatRow)] : rows.map(formatRow);
  return lines.join('\n');
}
