/**
 * Popup logic without the DOM (BC-044, BC-045): builds rows from extracted
 * citations with the shared parser, and submits selected rows to the API
 * one at a time with per row outcomes. Testable in Node.
 */
import { parseLink, type ConfidenceState, type ParseResult } from '@breadcrumb/parser';
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
}

export type SubmissionOutcome = { ok: true; id: number; state: ConfidenceState } | { ok: false; message: string };

function folderOf(result: ParseResult): string | undefined {
  if (!result.ok || result.path === undefined) {
    return undefined;
  }
  if (result.components.fileName === undefined) {
    return result.path;
  }
  return result.path.slice(0, result.path.length - result.components.fileName.value.length - 1);
}

/**
 * What makes two citations the same document: its unique id when the link
 * carries one (sourcedoc, UniqueId, or the `d` of a sharing link), else its
 * decoded path, else the URL. Copilot cites one file with different query
 * parameters (`action=edit`, `action=default`), which must collapse to one row.
 */
export function identityOf(url: string, result: ParseResult): string {
  if (!result.ok) {
    return `url:${url}`;
  }
  const id = result.identifiers.find((i) => i.kind === 'sourcedoc' || i.kind === 'uniqueId' || i.kind === 'd');
  if (id !== undefined) {
    const raw = id.kind === 'd' ? id.value.replace(/^[a-z]/i, '') : id.value;
    return `id:${raw.toLowerCase().replace(/[^0-9a-f]/g, '')}`;
  }
  if (result.path !== undefined) {
    return `path:${result.components.host.value}${result.path}`.toLowerCase();
  }
  return `url:${url}`;
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
    const identity = identityOf(url, result);
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
