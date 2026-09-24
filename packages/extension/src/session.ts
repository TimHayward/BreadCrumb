/**
 * BC-049: confirm citations with the browser's SharePoint session.
 *
 * For hosts the user has granted on the options page (the optional host
 * permission, invariant 17), the extension calls SharePoint's Graph-shaped
 * v2.0 API with `credentials: 'include'`, so the browser attaches the user's
 * existing SharePoint session. The shared validator does the rest, labelled
 * as a SharePoint confirmation (decision D9). Cookie values are never read.
 */
import type { ParseSuccess } from '@breadcrumb/parser';
import { isValidatable, validateResult, type GraphClient, type ValidationFailureKind } from '@breadcrumb/validation';
import type { FetchLike, PopupRow } from './popupModel.js';

/**
 * A GraphClient that talks to `https://{host}/_api/v2.0` with the browser's
 * session. `onStatus` sees every HTTP status, so the caller can tell "you are
 * not signed in here" (401 or 403) from any other failure.
 */
export function sessionClient(host: string, fetchImpl: FetchLike, onStatus?: (status: number, contentType: string) => void): GraphClient {
  return {
    async get(path, headers = {}) {
      const response = await fetchImpl(`https://${host}/_api/v2.0${path}`, {
        method: 'GET',
        credentials: 'include',
        headers: { accept: 'application/json', ...headers },
      });
      onStatus?.(response.status, response.headers.get('content-type') ?? '');
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key.toLowerCase()] = value;
      });
      let body: unknown = null;
      try {
        body = await response.json();
      } catch {
        body = null;
      }
      return { status: response.status, headers: responseHeaders, body };
    },
  };
}

/** The SharePoint host a row would be confirmed on, or undefined when it cannot be. */
export function sessionHost(row: PopupRow): string | undefined {
  if (!row.result.ok || !isValidatable(row.result)) {
    return undefined;
  }
  const host = row.result.components.host.value;
  return host.endsWith('.sharepoint.com') ? host : undefined;
}

export interface SessionDeps {
  fetchImpl: FetchLike;
  /** Whether the user granted the extension access to this host (chrome.permissions.contains). */
  hasPermission: (host: string) => Promise<boolean>;
  /**
   * How many rows to ask SharePoint about at once. A long chat can cite
   * dozens of files, and firing every lookup together is both slow and rude
   * to the tenant, so they go a few at a time.
   */
  concurrency?: number;
  /** Called as each row is answered, so the popup can show progress. */
  onProgress?: (done: number, total: number) => void;
}

export const DEFAULT_CONCURRENCY = 4;

/** What one call to SharePoint came back as, enough to tell the refusals apart. */
export interface CallTrace {
  status: number;
  contentType: string;
}

export type SessionFailure = 'signed-out' | 'no-permission' | 'not-found' | 'unsupported' | 'failed';

/**
 * Why SharePoint would not confirm a file. These mean different things to
 * the user and must not be run together:
 *
 * - 401, or a sign in page served as HTML, means this browser has no session
 *   on that host. Opening the site once fixes it.
 * - 403 means the session is fine and the account is simply not allowed near
 *   that item: another person's OneDrive, or a site the user is not in.
 * - 404 means the file is not there any more.
 *
 * `hostHasSession` settles the ambiguous case: if another file on the same
 * host confirmed a moment ago, the browser plainly has a session there, so
 * this refusal is about the item and never about signing in.
 */
export function classifySessionFailure(traces: readonly CallTrace[], hostHasSession: boolean, kind?: ValidationFailureKind): SessionFailure {
  const has = (status: number): boolean => traces.some((trace) => trace.status === status);
  // SharePoint answers an unauthenticated request by serving its sign in page.
  const signInPage = traces.some((trace) => trace.status >= 200 && trace.status < 400 && trace.contentType.includes('text/html'));
  if ((has(401) || signInPage) && !hostHasSession) {
    return 'signed-out';
  }
  // The validator's own verdict, where it has one: it knows a link that is
  // not a document at all from one it was refused.
  if (kind === 'unsupported') {
    return 'unsupported';
  }
  if (has(403) || has(401) || kind === 'permission') {
    return 'no-permission';
  }
  if (has(404) || kind === 'not_found') {
    return 'not-found';
  }
  return 'failed';
}

function failureMessage(reason: SessionFailure, host: string, fallback: string): string {
  const personal = host.toLowerCase().includes('-my.');
  switch (reason) {
    case 'signed-out':
      return `This browser has no signed in session on ${host} yet, so SharePoint would not answer.`;
    case 'no-permission':
      return personal
        ? `${host} refused this item. Files in someone else's OneDrive can only be confirmed by someone who has been given access to them.`
        : `${host} refused this item. Your account does not have access to it, so SharePoint will not say where it lives.`;
    case 'not-found':
      return `${host} has no such item any more. It may have been moved, renamed or deleted, or the sharing link may have been withdrawn.`;
    case 'unsupported':
      return `This link does not point at a file or folder BreadCrumb can look up on ${host}, so there is no location to confirm.`;
    default:
      return fallback;
  }
}

/**
 * Confirms every row that sits on a SharePoint host, a few at a time,
 * recording each outcome on the row. Rows are classified once every call is
 * in, so a refusal can be read against what the same host answered for
 * other files.
 */
export async function confirmWithSession(rows: PopupRow[], deps: SessionDeps): Promise<PopupRow[]> {
  const access = new Map<string, Promise<boolean>>();
  const queue = rows.filter((row) => sessionHost(row) !== undefined);
  const pending: Array<{ row: PopupRow; host: string; traces: CallTrace[]; message: string; kind: ValidationFailureKind }> = [];
  const hostsWithSession = new Set<string>();
  let done = 0;

  const confirm = async (row: PopupRow): Promise<void> => {
    const host = sessionHost(row) as string;
    if (!access.has(host)) {
      access.set(host, deps.hasPermission(host).catch(() => false));
    }
    if (!(await access.get(host))) {
      row.session = { ok: false, reason: 'no-access', message: `The extension has no access to ${host}; allow it on the options page.`, host };
      return;
    }
    const traces: CallTrace[] = [];
    const client = sessionClient(host, deps.fetchImpl, (status, contentType) => traces.push({ status, contentType }));
    const outcome = await validateResult(row.result as ParseSuccess, client, { authority: 'sharepoint-session' });
    if (outcome.ok) {
      row.session = { ok: true, verified: outcome.verified };
      hostsWithSession.add(host);
      return;
    }
    // Classified below, once every row has been tried on this host.
    pending.push({ row, host, traces, message: outcome.message, kind: outcome.kind });
  };

  let next = 0;
  const worker = async (): Promise<void> => {
    for (let i = next++; i < queue.length; i = next++) {
      const row = queue[i];
      if (row === undefined) {
        return;
      }
      await confirm(row);
      done += 1;
      deps.onProgress?.(done, queue.length);
    }
  };
  const lanes = Math.max(1, Math.min(deps.concurrency ?? DEFAULT_CONCURRENCY, queue.length));
  await Promise.all(Array.from({ length: lanes }, () => worker()));

  for (const { row, host, traces, message, kind } of pending) {
    const reason = classifySessionFailure(traces, hostsWithSession.has(host), kind);
    row.session = { ok: false, reason, message: failureMessage(reason, host, message), host };
  }
  return rows;
}
