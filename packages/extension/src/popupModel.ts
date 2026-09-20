/**
 * Popup logic without the DOM (BC-044): builds rows from extracted citations
 * with the shared parser, decides what each row shows once the SharePoint
 * session has answered (BC-049), and gathers links for the clipboard
 * (BC-052). Testable in Node.
 *
 * There is no BreadCrumb server: the extension is the whole product
 * (architecture change of 2026-09-17). Keeping results is BC-055, and
 * writing them into an Obsidian note is BC-067; until those land, a result
 * lives only as long as the popup is open.
 */
import { documentKey, parseLink, type ConfidenceState, type ParseResult } from '@breadcrumb/parser';
import type { VerifiedResult } from '@breadcrumb/validation';
import type { Citation } from './messages.js';
import { formatProcessedAt, type NoteRow } from './noteWriter.js';

/** The fetch shape the popup and the session client use, so tests can supply their own. */
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface PopupRow {
  key: string;
  url: string;
  /** File name, folder name or the citation text, whichever is known. */
  label: string;
  result: ParseResult;
  state: ConfidenceState | 'failed';
  /** Decoded folder path (the containing folder), when known. */
  folder?: string;
  libraryInferred: boolean;
  selected: boolean;
  /** What SharePoint said when asked with the browser's session (BC-049). */
  session?: SessionOutcome;
  /** What happened to this row on the last send to the note (BC-067). */
  noteOutcome?: NoteOutcome;
}

/** A citation confirmed, or not, with the browser's SharePoint session (BC-049). */
export type SessionOutcome =
  | { ok: true; verified: VerifiedResult }
  | { ok: false; reason: 'no-access' | 'failed'; message: string };

/** The containing folder of a verified result (the path itself for a folder). */
export function verifiedFolder(verified: VerifiedResult): string {
  const name = verified.components.fileName;
  return name !== undefined && verified.path.endsWith(`/${name}`) ? verified.path.slice(0, verified.path.length - name.length - 1) : verified.path;
}

function folderOf(result: ParseResult): string | undefined {
  if (!result.ok || result.path === undefined) {
    return undefined;
  }
  if (result.components.fileName === undefined) {
    return result.path;
  }
  return result.path.slice(0, result.path.length - result.components.fileName.value.length - 1);
}

export function buildRows(citations: readonly Citation[]): PopupRow[] {
  const rows: PopupRow[] = [];
  const seen = new Set<string>();
  for (const citation of citations) {
    const url = citation.url.trim();
    if (url === '') {
      continue;
    }
    const result = parseLink(url);
    // One row per document (the parser's documentKey).
    const identity = documentKey(result, url);
    if (seen.has(identity)) {
      continue;
    }
    seen.add(identity);
    const folder = folderOf(result);
    const label = result.ok
      ? (result.components.fileName?.value ?? result.components.folders?.value.at(-1) ?? result.components.library?.value ?? citation.text ?? url)
      : (citation.text ?? url);
    const row: PopupRow = {
      key: `row-${rows.length + 1}`,
      url,
      label,
      result,
      state: result.ok ? result.state : 'failed',
      libraryInferred: result.ok && result.components.library?.flag === 'Inferred',
      selected: result.ok,
    };
    if (folder !== undefined) {
      row.folder = folder;
    }
    rows.push(row);
  }
  return rows;
}

/** A short line under a row's links; `tone` picks its colour, the text always carries the meaning. */
export interface RowNote {
  text: string;
  tone: 'muted' | 'ok' | 'fail';
  /** Longer detail for a tooltip, when there is one. */
  detail?: string;
}

/** Everything the popup shows for one row, decided without the DOM. */
export interface RowView {
  state: ConfidenceState | 'failed';
  /** The word on the badge: the state, "Failed", or "Not supported" for consumer OneDrive. */
  stateLabel: string;
  /** "Document location" or "Folder location"; not shown for a failed row. */
  locationLabel: string;
  /** The containing folder (the folder itself for a folder), when known. */
  location?: string;
  /** Shown instead of a location: why it is unknown, or why the link failed. */
  locationNote?: string;
  /** True when the location is a parse failure message rather than a pending state. */
  failed: boolean;
  libraryInferred: boolean;
  originalUrl: string;
  folderUrl?: string;
  /** The document's own path, file name included: what the note's File path column holds. */
  documentPath?: string;
  notes: RowNote[];
}

/**
 * Decides what a row shows. A SharePoint session confirmation (BC-049, which
 * counts as Verified under decision D9) wins over what the parser worked out
 * on its own.
 */
export function describeRow(row: PopupRow): RowView {
  const confirmed = row.session?.ok === true ? row.session.verified : undefined;
  const state = confirmed !== undefined ? 'Verified' : row.state;
  const parsed = row.result.ok ? row.result : undefined;

  const location = (confirmed !== undefined ? verifiedFolder(confirmed) : undefined) ?? row.folder;
  const folderUrl = confirmed?.folderUrl ?? (parsed?.state === 'Unresolved' ? undefined : parsed?.folderUrl);
  const isFolder =
    confirmed !== undefined ? confirmed.components.fileName === undefined : parsed !== undefined && parsed.state !== 'Unresolved' && parsed.components.fileName === undefined;

  const stateLabel = state !== 'failed' ? state : !row.result.ok && row.result.reason === 'consumer_onedrive' ? 'Not supported' : 'Failed';
  const view: RowView = {
    state,
    stateLabel,
    locationLabel: isFolder ? 'Folder location' : 'Document location',
    failed: !row.result.ok,
    libraryInferred: row.libraryInferred && confirmed === undefined,
    originalUrl: row.url,
    notes: [],
  };
  if (location !== undefined) {
    view.location = location;
  } else if (!row.result.ok) {
    view.locationNote = row.result.message;
  } else {
    view.locationNote = 'Unknown until the link is confirmed.';
  }
  if (folderUrl !== undefined) {
    view.folderUrl = folderUrl;
  }
  const documentPath = confirmed?.path ?? parsed?.path;
  if (documentPath !== undefined) {
    view.documentPath = documentPath;
  }

  if (confirmed !== undefined) {
    view.notes.push({ text: 'Confirmed with your SharePoint session.', tone: 'ok' });
  }
  if (state === 'Unresolved') {
    view.notes.push({ text: 'Allow this tenant on the options page to confirm it.', tone: 'muted' });
  }
  if (row.session?.ok === false && row.session.reason === 'failed' && state !== 'Verified') {
    view.notes.push({ text: 'Your SharePoint session could not confirm it.', tone: 'muted', detail: row.session.message });
  }
  if (row.noteOutcome !== undefined) {
    view.notes.push(
      row.noteOutcome.ok
        ? { text: `Added to your note at ${row.noteOutcome.processedAt}.`, tone: 'ok' }
        : { text: `Not written to your note: ${row.noteOutcome.reason}.`, tone: 'fail' },
    );
  }
  return view;
}

/** Links gathered from the ticked rows for the clipboard. */
export interface CopySelection {
  /** Ticked rows that can be copied from (failed rows are never ticked). */
  selected: number;
  /** The links, in list order, each once. */
  links: string[];
  /** Ticked rows left out because they have no such link yet (an unconfirmed folder). */
  skipped: number;
}

/** The original links of the ticked rows: the links Copilot cited, which open the files. */
export function selectedFileLinks(rows: readonly PopupRow[]): CopySelection {
  const selected = rows.filter((row) => row.selected && row.result.ok);
  return { selected: selected.length, links: [...new Set(selected.map((row) => row.url))], skipped: 0 };
}

/** The folder links of the ticked rows, each folder once. Rows whose folder is not known yet are counted as skipped. */
export function selectedFolderLinks(rows: readonly PopupRow[]): CopySelection {
  const selected = rows.filter((row) => row.selected && row.result.ok);
  const links: string[] = [];
  let skipped = 0;
  for (const row of selected) {
    const folderUrl = describeRow(row).folderUrl;
    if (folderUrl === undefined) {
      skipped += 1;
    } else if (!links.includes(folderUrl)) {
      links.push(folderUrl);
    }
  }
  return { selected: selected.length, links, skipped };
}

/** Text for the clipboard: one link per line. */
export function clipboardText(selection: CopySelection): string {
  return selection.links.join('\n');
}

/** What the status line says after a copy (or why nothing was copied). */
export function copySummary(kind: 'file' | 'folder', selection: CopySelection): string {
  const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;
  if (selection.selected === 0) {
    return 'Tick at least one file first. Nothing was copied.';
  }
  if (selection.links.length === 0) {
    return selection.selected === 1
      ? 'The selected file has no known folder yet. Nothing was copied.'
      : 'None of the selected files has a known folder yet. Nothing was copied.';
  }
  let text = `Copied ${plural(selection.links.length, `${kind} link`)}`;
  const counted = selection.selected - selection.skipped;
  text += kind === 'folder' && counted > selection.links.length ? ` for ${plural(counted, 'file')}.` : '.';
  if (selection.skipped > 0) {
    text += ` ${plural(selection.skipped, 'selected file')} ${selection.skipped === 1 ? 'has' : 'have'} no known folder yet, so ${selection.skipped === 1 ? 'it was' : 'they were'} left out.`;
  }
  return text;
}

/** Splits a path after each "/" so it can wrap between segments rather than inside a name. */
export function pathSegments(path: string): string[] {
  return path.split(/(?<=\/)/);
}

/** What the ticked rows become in the note, and what could not go (BC-067, BC-069). */
export interface NoteSelection {
  /** The rows that will be written, each with the popup row it came from. */
  entries: Array<{ row: PopupRow; noteRow: NoteRow }>;
  /** The same table rows alone, ready for the note or the clipboard. */
  rows: NoteRow[];
  /** Ticked rows left out, with the reason to show the user. */
  skipped: Array<{ row: PopupRow; label: string; reason: string }>;
}

/**
 * Turns the ticked rows into table rows. A row goes only when its document
 * location is known: a link that failed to parse, or one still Unresolved,
 * would write a half empty row, so it is left out and counted instead.
 */
export function noteRowsFor(rows: readonly PopupRow[], now: Date): NoteSelection {
  const processedAt = formatProcessedAt(now);
  const selection: NoteSelection = { entries: [], rows: [], skipped: [] };
  for (const row of rows) {
    if (!row.selected) {
      continue;
    }
    const view = describeRow(row);
    if (view.failed) {
      selection.skipped.push({ row, label: row.label, reason: 'the link could not be converted' });
      continue;
    }
    if (view.documentPath === undefined) {
      selection.skipped.push({ row, label: row.label, reason: 'its location is not known until it is confirmed' });
      continue;
    }
    const noteRow: NoteRow = {
      documentName: row.label,
      filePath: view.documentPath,
      sourceUrl: row.url,
      folderUrl: view.folderUrl ?? '',
      processedAt,
    };
    selection.entries.push({ row, noteRow });
    selection.rows.push(noteRow);
  }
  return selection;
}

/** What happened to one row on the last send (BC-067), shown on the row itself. */
export type NoteOutcome = { ok: true; notePath: string; processedAt: string } | { ok: false; reason: string };

/** Records the send's result on every ticked row, so each says its own outcome. */
export function recordNoteOutcomes(selection: NoteSelection, result: { ok: true; notePath: string } | { ok: false; reason: string }): void {
  for (const entry of selection.entries) {
    entry.row.noteOutcome = result.ok ? { ok: true, notePath: result.notePath, processedAt: entry.noteRow.processedAt } : { ok: false, reason: result.reason };
  }
  for (const skipped of selection.skipped) {
    skipped.row.noteOutcome = { ok: false, reason: skipped.reason };
  }
}

/** What to tell the user after a send (BC-067). */
export function sendSummary(outcome: { rowsAdded: number; createdNote: boolean; createdTable: boolean }, skipped: NoteSelection['skipped'], notePath: string): string {
  const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;
  const where = outcome.createdNote ? `Created ${notePath} and added` : outcome.createdTable ? `Added the table to ${notePath} and wrote` : `Added`;
  let text = `${where} ${plural(outcome.rowsAdded, 'row')}.`;
  if (skipped.length > 0) {
    const reasons = [...new Set(skipped.map((s) => s.reason))].join('; ');
    text += ` ${plural(skipped.length, 'selected file')} left out: ${reasons}.`;
  }
  return text;
}
