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
}

/**
 * Confirms every row that BreadCrumb has not already verified and that sits
 * on a SharePoint host, in parallel, recording each outcome on the row.
 * A host without access, or SharePoint saying no (for example 401 on OneDrive
 * before it has been opened in the browser), leaves the row to the Graph route.
 */
export async function confirmWithSession(rows: PopupRow[], deps: SessionDeps): Promise<PopupRow[]> {
  const access = new Map<string, Promise<boolean>>();
  await Promise.all(
    rows.map(async (row) => {
      if (row.known?.verified === true) {
        return;
      }
      const host = sessionHost(row);
      if (host === undefined) {
        return;
      }
      if (!access.has(host)) {
        access.set(host, deps.hasPermission(host).catch(() => false));
      }
      if (!(await access.get(host))) {
        row.session = { ok: false, reason: 'no-access', message: `The extension has no access to ${host}; allow it on the options page.` };
        return;
      }
      const outcome = await validateResult(row.result as ParseSuccess, sessionClient(host, deps.fetchImpl), { authority: 'sharepoint-session' });
      row.session = outcome.ok ? { ok: true, verified: outcome.verified } : { ok: false, reason: 'failed', message: outcome.message };
    }),
  );
  return rows;
}
