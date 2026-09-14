/**
 * Popup logic without the DOM (BC-044, BC-045): builds rows from extracted
 * citations with the shared parser, asks BreadCrumb what it already knows
 * about them, and submits selected rows to the API one at a time with per
 * row outcomes. Testable in Node.
 */
import { documentKey, parseLink, type ConfidenceState, type ParseResult } from '@breadcrumb/parser';
import type { VerifiedResult } from '@breadcrumb/validation';
import type { Citation } from './messages.js';

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
  outcome?: SubmissionOutcome;
  /** What BreadCrumb's history says about this document, when it has an entry. */
  known?: KnownEntry;
  /** What SharePoint said when asked with the browser's session (BC-049). */
  session?: SessionOutcome;
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

/** A history entry for the row's document, as answered by POST /api/lookup. */
export interface KnownEntry {
  id: number;
  state: ConfidenceState | 'failed';
  /** True when the entry was confirmed by Microsoft Graph. */
  verified: boolean;
  path?: string;
  /** Containing folder of `path` (the path itself for a folder). */
  folder?: string;
  folderUrl?: string;
}

/** `recorded` is true when a session confirmation was stored as the entry's validation (BC-049). */
export type SubmissionOutcome = { ok: true; id: number; state: ConfidenceState; recorded?: boolean } | { ok: false; message: string };

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
    // One row per document (the parser's documentKey, shared with the server's lookup).
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

/**
 * BreadCrumb's history filtered to extension submissions, opened after
 * sending: a signed-in BreadCrumb page verifies unverified entries on its
 * own, and close=1 lets that background tab close itself once all are
 * Verified.
 */
export function verificationUrl(baseUrl: string): string {
  return `${baseUrl}/history?source=extension&close=1`;
}

/** Turns what the user typed into an API base URL, or undefined when unusable. */
export function normaliseBaseUrl(input: string | undefined | null): string | undefined {
  const text = (input ?? '').trim();
  if (text === '') {
    return undefined;
  }
  try {
    const url = new URL(/^[a-z]+:\/\//i.test(text) ? text : `http://${text}`);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return undefined;
    }
    return url.href.replace(/\/+$/, '');
  } catch {
    return undefined;
  }
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/** Submits the selected rows one at a time (no batch endpoint in v1) and records each outcome on the row. */
export async function submitRows(rows: PopupRow[], baseUrl: string, fetchImpl: FetchLike = (u, i) => fetch(u, i)): Promise<PopupRow[]> {
  for (const row of rows) {
    if (!row.selected) {
      continue;
    }
    try {
      const response = await fetchImpl(`${baseUrl}/api/convert`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ link: row.url, source: 'extension' }),
      });
      const body = (await response.json().catch(() => ({}))) as { id?: number; result?: { state?: ConfidenceState }; message?: string; reason?: string };
      if (response.ok && typeof body.id === 'number' && body.result?.state !== undefined) {
        row.outcome = { ok: true, id: body.id, state: body.result.state };
        if (row.session?.ok === true) {
          row.outcome.recorded = await recordSessionConfirmation(row, body.id, body.result.state, baseUrl, fetchImpl);
        }
      } else {
        row.outcome = { ok: false, message: body.message ?? `${baseUrl} answered ${response.status}.` };
      }
    } catch (error) {
      row.outcome = {
        ok: false,
        message: `Could not reach ${baseUrl}: ${error instanceof Error ? error.message : String(error)}. Check that BreadCrumb is running, that this device is on its private network, and the API base URL in the extension options.`,
      };
    }
  }
  return rows;
}

/**
 * Stores a session confirmation as the new entry's validation, so BreadCrumb
 * shows it Verified (decision D9) without a background tab. Returns false
 * when BreadCrumb declines it; the background tab then verifies with Graph.
 */
async function recordSessionConfirmation(row: PopupRow, id: number, previousState: ConfidenceState, baseUrl: string, fetchImpl: FetchLike): Promise<boolean> {
  if (row.session?.ok !== true || previousState === 'Verified') {
    return false;
  }
  const verified = row.session.verified;
  try {
    const response = await fetchImpl(`${baseUrl}/api/history/${id}/validate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ previousState, verified }),
    });
    if (!response.ok) {
      return false;
    }
  } catch {
    return false;
  }
  row.known = { id, state: 'Verified', verified: true, path: verified.path, folder: verifiedFolder(verified), folderUrl: verified.folderUrl };
  return true;
}

export type LookupAnswer =
  | { link: string; found: false }
  | {
      link: string;
      found: true;
      id: number;
      state: ConfidenceState | null;
      verified: boolean;
      path: string | null;
      folderUrl: string | null;
      fileUrl: string | null;
      fileName: string | null;
    };

/** Links per lookup request; matches the server's limit. */
export const MAX_LOOKUP_LINKS = 50;

/**
 * Records BreadCrumb's answers on the rows they belong to. On the first
 * lookup (untickKnown) a document BreadCrumb already has starts unticked,
 * since it is already kept; later lookups leave the selection alone.
 */
export function applyLookup(rows: PopupRow[], answers: readonly LookupAnswer[], options: { untickKnown?: boolean } = {}): PopupRow[] {
  const byLink = new Map(answers.map((answer) => [answer.link, answer]));
  for (const row of rows) {
    const answer = byLink.get(row.url);
    if (answer === undefined || !answer.found) {
      continue;
    }
    const known: KnownEntry = { id: answer.id, state: answer.state ?? 'failed', verified: answer.verified };
    if (answer.path !== null) {
      known.path = answer.path;
      const name = answer.fileName;
      known.folder = name !== null && answer.path.endsWith(`/${name}`) ? answer.path.slice(0, answer.path.length - name.length - 1) : answer.path;
    }
    if (answer.folderUrl !== null) {
      known.folderUrl = answer.folderUrl;
    }
    row.known = known;
    if (options.untickKnown === true && row.outcome === undefined) {
      row.selected = false;
    }
  }
  return rows;
}

/** Asks BreadCrumb about the rows' links; undefined when it cannot be reached or answers badly. */
export async function lookupRows(rows: readonly PopupRow[], baseUrl: string, fetchImpl: FetchLike = (u, i) => fetch(u, i)): Promise<LookupAnswer[] | undefined> {
  const links = rows.map((row) => row.url).slice(0, MAX_LOOKUP_LINKS);
  if (links.length === 0) {
    return [];
  }
  try {
    const response = await fetchImpl(`${baseUrl}/api/lookup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ links }),
    });
    if (!response.ok) {
      return undefined;
    }
    const body = (await response.json()) as { answers?: LookupAnswer[] };
    return Array.isArray(body.answers) ? body.answers : undefined;
  } catch {
    return undefined;
  }
}

export interface PollOptions {
  intervalMs?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/**
 * After sending, follows the sent rows until BreadCrumb has verified them all
 * (the background tab does the Graph work) or the time runs out, calling
 * onUpdate after each lookup so the popup can re-render.
 */
export async function followUntilVerified(
  rows: PopupRow[],
  baseUrl: string,
  onUpdate: () => void,
  fetchImpl: FetchLike = (u, i) => fetch(u, i),
  options: PollOptions = {},
): Promise<'verified' | 'timeout' | 'nothing-sent'> {
  const intervalMs = options.intervalMs ?? 2000;
  const timeoutMs = options.timeoutMs ?? 90000;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? (() => Date.now());
  const sent = rows.filter((row) => row.outcome?.ok === true);
  if (sent.length === 0) {
    return 'nothing-sent';
  }
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    await sleep(intervalMs);
    const answers = await lookupRows(sent, baseUrl, fetchImpl);
    if (answers !== undefined) {
      applyLookup(sent, answers);
      onUpdate();
    }
    if (sent.every((row) => row.known?.verified === true)) {
      return 'verified';
    }
  }
  return 'timeout';
}
