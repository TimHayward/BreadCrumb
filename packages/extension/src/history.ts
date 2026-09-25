/**
 * BC-055: what the extension remembers, on this device only.
 *
 * Every link resolved in the popup, extracted or pasted, is kept here so a
 * folder found once does not have to be found again. It is a working copy,
 * not a system of record (invariant 13): removing the extension removes it,
 * and anything that must outlive the device goes to the Obsidian note.
 *
 * All stored data goes through this one layer (invariant 10), the stored
 * shape carries a version and migrates (invariant 11), and a failure to
 * persist is never silent (invariant 12): every write returns what happened
 * so the popup can say so.
 *
 * Decisions taken here, as recommended in the backlog:
 * - D8: failures are kept too. A link that could not be converted is worth
 *   seeing again, and local history is cheap.
 * - D11: the note and this history both stay. The note is the record that
 *   lasts; this is the working copy.
 * - D15: two thousand entries, dropping the oldest that were never written
 *   to the note.
 * - D21: an entry written to the note is marked, never hidden.
 */
import { documentKey } from '@breadcrumb/parser';
import { describeRow, type PopupRow } from './popupModel.js';

/** The slice of `chrome.storage.local` used, so tests can supply their own. */
export interface StorageAreaLike {
  get(keys: string | string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

const KEY = 'history';
export const HISTORY_VERSION = 1;
export const HISTORY_CAP = 2000;

export interface HistoryEntry {
  /** The parser's identity for the document: the same file under any link form. */
  documentKey: string;
  /** The link as it was seen, the one a copy action would give. */
  url: string;
  label: string;
  state: string;
  /** Decoded path of the document itself, when known. */
  path?: string;
  /** The containing folder, which is what the user was usually after. */
  folder?: string;
  folderUrl?: string;
  /** How the result was arrived at, in the parser's or the confirmation's words. */
  methodText?: string;
  source: 'extracted' | 'pasted';
  /** The page the link was found on, for an extracted row. */
  pageUrl?: string;
  firstSeenAt: string;
  lastSeenAt: string;
  /** When this document was last written to the Obsidian note (D21). */
  sentToNoteAt?: string;
  /** What it said before an authenticated lookup improved it (invariant 6). */
  upgradedFrom?: { state: string; path?: string; at: string };
}

export interface HistoryFile {
  version: number;
  entries: HistoryEntry[];
}

export interface RecordContext {
  /** The page the popup was opened on. */
  pageUrl?: string;
  now?: Date;
}

/** What a write did, so the popup can report it rather than assume it worked. */
export interface WriteOutcome {
  ok: boolean;
  /** Entries added or updated. */
  written: number;
  /** Entries dropped to stay inside the cap. */
  dropped: number;
  total: number;
  message?: string;
}

const empty: HistoryFile = { version: HISTORY_VERSION, entries: [] };

/** Reads what is stored, migrating an older shape rather than discarding it. */
export function migrate(stored: unknown): HistoryFile {
  if (stored === null || typeof stored !== 'object') {
    return { ...empty, entries: [] };
  }
  const file = stored as Partial<HistoryFile>;
  if (!Array.isArray(file.entries)) {
    return { ...empty, entries: [] };
  }
  // Only version 1 exists so far; a later shape converts here rather than at the call sites.
  return { version: HISTORY_VERSION, entries: file.entries.filter((entry) => typeof entry?.documentKey === 'string') };
}

/** One row as it would be stored, with no reference to the browser. */
export function entryFromRow(row: PopupRow, context: RecordContext = {}): HistoryEntry {
  const view = describeRow(row);
  const now = (context.now ?? new Date()).toISOString();
  const confirmed = row.session?.ok === true ? row.session.verified : undefined;
  const entry: HistoryEntry = {
    documentKey: documentKey(row.result, row.url),
    url: row.url,
    label: row.label,
    state: view.state,
    source: row.source ?? 'extracted',
    firstSeenAt: now,
    lastSeenAt: now,
  };
  if (view.documentPath !== undefined) entry.path = view.documentPath;
  if (view.location !== undefined) entry.folder = view.location;
  if (view.folderUrl !== undefined) entry.folderUrl = view.folderUrl;
  const methodText = confirmed?.methodText ?? (row.result.ok ? row.result.method.text : row.result.message);
  if (methodText !== undefined) entry.methodText = methodText;
  if (context.pageUrl !== undefined) entry.pageUrl = context.pageUrl;
  return entry;
}

/**
 * Folds a new sighting into what is already known about that document. The
 * same file under a different link form updates its entry rather than adding
 * a second one, and an improvement keeps what it improved on.
 */
export function mergeEntry(existing: HistoryEntry | undefined, incoming: HistoryEntry): HistoryEntry {
  if (existing === undefined) {
    return incoming;
  }
  const merged: HistoryEntry = { ...existing, ...incoming, firstSeenAt: existing.firstSeenAt };
  // Keep what is known: a later sighting that knows less must not erase more.
  const keep = (key: 'path' | 'folder' | 'folderUrl' | 'methodText'): void => {
    const value = incoming[key] ?? existing[key];
    if (value === undefined) {
      delete merged[key];
    } else {
      merged[key] = value;
    }
  };
  keep('path');
  keep('folder');
  keep('folderUrl');
  keep('methodText');
  if (existing.sentToNoteAt !== undefined) {
    merged.sentToNoteAt = existing.sentToNoteAt;
  }
  if (existing.state !== incoming.state && existing.state !== 'Verified') {
    const from: HistoryEntry['upgradedFrom'] = { state: existing.state, at: incoming.lastSeenAt };
    if (existing.path !== undefined) {
      from.path = existing.path;
    }
    merged.upgradedFrom = from;
  } else if (existing.upgradedFrom !== undefined) {
    merged.upgradedFrom = existing.upgradedFrom;
  }
  return merged;
}

/**
 * Trims to the cap, newest first. An entry already written to the note is
 * kept in preference to one that never was, since the note holds the ones
 * the user cared about (D15).
 */
export function applyCap(entries: readonly HistoryEntry[], cap = HISTORY_CAP): { entries: HistoryEntry[]; dropped: number } {
  if (entries.length <= cap) {
    return { entries: [...entries], dropped: 0 };
  }
  const newestFirst = [...entries].sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
  const sent = newestFirst.filter((entry) => entry.sentToNoteAt !== undefined);
  const unsent = newestFirst.filter((entry) => entry.sentToNoteAt === undefined);
  const kept = [...sent, ...unsent].slice(0, cap);
  return { entries: kept.sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt)), dropped: entries.length - kept.length };
}

function area(given?: StorageAreaLike): StorageAreaLike {
  return given ?? (chrome.storage.local as unknown as StorageAreaLike);
}

export async function readHistory(store?: StorageAreaLike): Promise<HistoryFile> {
  try {
    const stored = await area(store).get(KEY);
    return migrate(stored[KEY]);
  } catch {
    return { ...empty, entries: [] };
  }
}

/** Writes the rows the popup is showing. Never throws: the outcome says what happened. */
export async function recordRows(rows: readonly PopupRow[], context: RecordContext = {}, store?: StorageAreaLike): Promise<WriteOutcome> {
  const worth = rows.filter((row) => row.result.ok || row.state === 'failed');
  if (worth.length === 0) {
    return { ok: true, written: 0, dropped: 0, total: 0 };
  }
  try {
    const file = await readHistory(store);
    const byKey = new Map(file.entries.map((entry) => [entry.documentKey, entry]));
    for (const row of worth) {
      const incoming = entryFromRow(row, context);
      byKey.set(incoming.documentKey, mergeEntry(byKey.get(incoming.documentKey), incoming));
    }
    const { entries, dropped } = applyCap([...byKey.values()]);
    await area(store).set({ [KEY]: { version: HISTORY_VERSION, entries } });
    return { ok: true, written: worth.length, dropped, total: entries.length };
  } catch (error) {
    return { ok: false, written: 0, dropped: 0, total: 0, message: error instanceof Error ? error.message : String(error) };
  }
}

/** Records that these documents reached the Obsidian note, and when (D21). */
export async function markSentToNote(documentKeys: readonly string[], when: Date, store?: StorageAreaLike): Promise<WriteOutcome> {
  if (documentKeys.length === 0) {
    return { ok: true, written: 0, dropped: 0, total: 0 };
  }
  try {
    const file = await readHistory(store);
    const wanted = new Set(documentKeys);
    let written = 0;
    const entries = file.entries.map((entry) => {
      if (!wanted.has(entry.documentKey)) {
        return entry;
      }
      written += 1;
      return { ...entry, sentToNoteAt: when.toISOString() };
    });
    await area(store).set({ [KEY]: { version: HISTORY_VERSION, entries } });
    return { ok: true, written, dropped: 0, total: entries.length };
  } catch (error) {
    return { ok: false, written: 0, dropped: 0, total: 0, message: error instanceof Error ? error.message : String(error) };
  }
}

export async function clearHistory(store?: StorageAreaLike): Promise<void> {
  await area(store).set({ [KEY]: { version: HISTORY_VERSION, entries: [] } });
}
