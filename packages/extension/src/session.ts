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
import { isValidatable, validateResult, type GraphClient } from '@breadcrumb/validation';
import type { FetchLike, PopupRow } from './popupModel.js';

/** A GraphClient that talks to `https://{host}/_api/v2.0` with the browser's session. */
export function sessionClient(host: string, fetchImpl: FetchLike): GraphClient {
  return {
    async get(path, headers = {}) {
      const response = await fetchImpl(`https://${host}/_api/v2.0${path}`, {
        method: 'GET',
        credentials: 'include',
        headers: { accept: 'application/json', ...headers },
      });
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

/**
 * Confirms every row that sits on a SharePoint host, in parallel, recording
 * each outcome on the row. A host without access, or SharePoint saying no
 * (for example 401 on OneDrive before it has been opened in the browser),
 * leaves the row with its best effort result.
 */
export async function confirmWithSession(rows: PopupRow[], deps: SessionDeps): Promise<PopupRow[]> {
  const access = new Map<string, Promise<boolean>>();
  const queue = rows.filter((row) => sessionHost(row) !== undefined);
  let done = 0;

  const confirm = async (row: PopupRow): Promise<void> => {
    const host = sessionHost(row) as string;
    if (!access.has(host)) {
      access.set(host, deps.hasPermission(host).catch(() => false));
    }
    if (!(await access.get(host))) {
      row.session = { ok: false, reason: 'no-access', message: `The extension has no access to ${host}; allow it on the options page.` };
      return;
    }
    const outcome = await validateResult(row.result as ParseSuccess, sessionClient(host, deps.fetchImpl), { authority: 'sharepoint-session' });
    row.session = outcome.ok ? { ok: true, verified: outcome.verified } : { ok: false, reason: 'failed', message: outcome.message };
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
  return rows;
}
