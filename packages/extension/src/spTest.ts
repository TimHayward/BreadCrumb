/**
 * Spike S9: can the extension resolve a link with the browser's existing
 * SharePoint session, instead of a Graph token from MSAL?
 *
 * For each link this plans a few read-only SharePoint calls and runs them
 * with `credentials: 'include'` from the service worker, which may send the
 * user's SharePoint cookies to hosts the user has granted (optional host
 * permission, requested per tenant on the options page). Only SharePoint's
 * answers are reported; the cookie values are never read.
 */
import { parseLink } from '@breadcrumb/parser';

export interface PlannedCall {
  label: string;
  url: string;
  headers: Record<string, string>;
}

export interface CallResult {
  label: string;
  url: string;
  status: number | null;
  ok: boolean;
  contentType?: string;
  /** Where the request ended after redirects, when that differs from url. */
  finalUrl?: string;
  durationMs: number;
  body?: unknown;
  error?: string;
}

export interface LinkReport {
  link: string;
  form?: string;
  host?: string;
  /** Whether the user has granted this extension access to the link's host. */
  permission?: 'granted' | 'missing';
  calls: CallResult[];
  note?: string;
}

const MAX_LINKS = 10;
const MAX_BODY = 3000;

/** `u!` plus unpadded base64url of the link, as the shares endpoint expects. */
export function encodeSharingUrl(url: string): string {
  const bytes = new TextEncoder().encode(url);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `u!${btoa(binary).replace(/=+$/, '').replaceAll('+', '-').replaceAll('/', '_')}`;
}

/** The read-only calls worth trying for one link; none for links off the global SharePoint cloud. */
export function plannedCalls(link: string): { host?: string; form?: string; calls: PlannedCall[]; note?: string } {
  const result = parseLink(link);
  if (!result.ok) {
    return { calls: [], note: `not a link BreadCrumb can parse (${result.reason})` };
  }
  const host = result.components.host.value;
  if (!host.endsWith('.sharepoint.com')) {
    return { host, form: result.form, calls: [], note: 'not on a sharepoint.com host' };
  }
  const odata = { accept: 'application/json;odata=nometadata' };
  const calls: PlannedCall[] = [];
  const guid = result.identifiers.find((i) => i.kind === 'sourcedoc' || i.kind === 'uniqueId')?.value;
  const site = encodeURI(result.components.sitePath?.value ?? '');
  if (guid !== undefined) {
    const file = `https://${host}${site}/_api/web/GetFileById('${guid}')`;
    calls.push({ label: 'SharePoint REST GetFileById', url: `${file}?$select=ServerRelativeUrl,Name,UniqueId`, headers: odata });
    calls.push({ label: 'SharePoint REST library root', url: `${file}/ListItemAllFields/ParentList/RootFolder?$select=ServerRelativeUrl`, headers: odata });
  }
  calls.push({
    label: 'SharePoint v2.0 shares',
    url: `https://${host}/_api/v2.0/shares/${encodeSharingUrl(result.original)}/driveItem?$select=id,name,webUrl,parentReference,sharepointIds`,
    headers: { accept: 'application/json', prefer: 'redeemSharingLink' },
  });
  return { host, form: result.form, calls };
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

async function run(call: PlannedCall, fetchImpl: FetchLike, now: () => number): Promise<CallResult> {
  const started = now();
  try {
    const response = await fetchImpl(call.url, { method: 'GET', credentials: 'include', headers: call.headers, redirect: 'follow' });
    const text = await response.text();
    let body: unknown = text.length > MAX_BODY ? `${text.slice(0, MAX_BODY)}… (${text.length} characters)` : text;
    try {
      body = JSON.parse(text);
    } catch {
      // not JSON: keep the (truncated) text, often a sign in page
    }
    const result: CallResult = { label: call.label, url: call.url, status: response.status, ok: response.ok, durationMs: now() - started, body };
    const contentType = response.headers.get('content-type');
    if (contentType !== null) result.contentType = contentType;
    if (response.url !== '' && response.url !== call.url) result.finalUrl = response.url;
    return result;
  } catch (error) {
    return { label: call.label, url: call.url, status: null, ok: false, durationMs: now() - started, error: error instanceof Error ? error.message : String(error) };
  }
}

export interface SessionTestDeps {
  fetchImpl?: FetchLike;
  hasPermission?: (host: string) => Promise<boolean>;
  now?: () => number;
}

/** Runs the planned calls for up to ten links, one at a time. */
export async function runSessionTest(links: readonly string[], deps: SessionTestDeps = {}): Promise<LinkReport[]> {
  const fetchImpl = deps.fetchImpl ?? ((u, i) => fetch(u, i));
  const now = deps.now ?? (() => Date.now());
  const reports: LinkReport[] = [];
  for (const link of links.map((l) => l.trim()).filter((l) => l !== '').slice(0, MAX_LINKS)) {
    const plan = plannedCalls(link);
    const report: LinkReport = { link, calls: [] };
    if (plan.form !== undefined) report.form = plan.form;
    if (plan.host !== undefined) report.host = plan.host;
    if (plan.note !== undefined) report.note = plan.note;
    if (plan.host !== undefined && deps.hasPermission !== undefined) {
      report.permission = (await deps.hasPermission(plan.host)) ? 'granted' : 'missing';
    }
    for (const call of plan.calls) {
      report.calls.push(await run(call, fetchImpl, now));
    }
    reports.push(report);
  }
  return reports;
}

/** The origins to request for a tenant: its SharePoint host and its OneDrive (-my) host. */
export function tenantOrigins(tenant: string): string[] | undefined {
  const name = tenant.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/(-my)?\.sharepoint\.com.*$/, '');
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
    return undefined;
  }
  return [`https://${name}.sharepoint.com/*`, `https://${name}-my.sharepoint.com/*`];
}
