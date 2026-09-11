/**
 * Validates a best effort parser result against Microsoft Graph (BC-037,
 * BC-038, BC-039, BC-041). Pure: it takes a GraphClient and returns an
 * outcome, so it runs unchanged in the browser bundle and in Node tests with
 * recorded responses. Graph is called from the browser (decision D3), never
 * from the server.
 */
import type { ParseSuccess } from '@breadcrumb/parser';
import type { Correction, VerifiedComponents, VerifiedResult } from './types.js';

export interface GraphResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

/** Talks to Graph v1.0; `path` starts with `/` and excludes the host. */
export interface GraphClient {
  get(path: string, headers?: Record<string, string>): Promise<GraphResponse>;
  /** Needed only for search (document id links). */
  post?(path: string, body: unknown, headers?: Record<string, string>): Promise<GraphResponse>;
}

export type ValidationFailureKind = 'not_found' | 'permission' | 'throttled' | 'auth' | 'unsupported' | 'error';

export type ValidationOutcome =
  | { ok: true; verified: VerifiedResult }
  | { ok: false; kind: ValidationFailureKind; message: string; calls: string[]; retryAfterSeconds?: number };

/** Delegated permissions requested at sign in. Spike S2 may narrow these. */
export const DEFAULT_SCOPES = ['Files.Read.All', 'Sites.Read.All'];

/** Unresolved forms resolved through the shares endpoint (BC-038). */
export const SHARE_RESOLVABLE_FORMS: ReadonlySet<string> = new Set(['sharing-token/s', 'sharing-token/g', 'sharing-token/t', 'guest-access']);

/** Unresolved forms that carry only a document id (BC-039). */
export const DOCUMENT_ID_FORMS: ReadonlySet<string> = new Set(['doc-aspx', 'layouts-unique-id']);

/** Every Unresolved form the validator attempts. */
export const UNRESOLVED_VALIDATABLE_FORMS: ReadonlySet<string> = new Set([...SHARE_RESOLVABLE_FORMS, ...DOCUMENT_ID_FORMS]);

/** True when the validator can do something with this result. */
export function isValidatable(result: Pick<ParseSuccess, 'state' | 'form' | 'cloud'>): boolean {
  if (result.state === 'Verified' || result.cloud !== 'global') {
    return false;
  }
  if (result.state === 'Unresolved') {
    return UNRESOLVED_VALIDATABLE_FORMS.has(result.form);
  }
  return true;
}

/** How many segments beyond the parser's site path to try as subsites (BC-037). */
const MAX_SUBSITE_DEPTH = 3;

/** Search hits checked per query before giving up on it. */
const MAX_SEARCH_HITS = 10;

/** Asks Graph to grant the signed in user the link's permission on first use, as clicking the link would. */
const REDEEM_HEADERS = { prefer: 'redeemSharingLink' };

interface GraphSite {
  id: string;
  webUrl: string;
}

interface GraphDrive {
  id: string;
  name?: string;
  webUrl: string;
}

interface GraphItem {
  id: string;
  name: string;
  webUrl?: string;
  parentReference?: { driveId?: string; path?: string; siteId?: string };
  sharepointIds?: { listItemUniqueId?: string; siteId?: string };
  folder?: unknown;
  file?: unknown;
}

interface SearchResponse {
  value?: Array<{ hitsContainers?: Array<{ hits?: Array<{ resource?: { id?: string; parentReference?: { driveId?: string } } }> }> }>;
}

const ITEM_SELECT = '$select=id,name,webUrl,parentReference,sharepointIds,folder,file';

class GraphError extends Error {
  readonly kind: ValidationFailureKind;
  readonly retryAfterSeconds: number | undefined;

  constructor(kind: ValidationFailureKind, message: string, retryAfterSeconds?: number) {
    super(message);
    this.kind = kind;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** Errors that stop a validation outright rather than letting it try another route. */
function isFatal(error: unknown): boolean {
  return !(error instanceof GraphError) || error.kind === 'auth' || error.kind === 'throttled';
}

function errorMessage(body: unknown): string | undefined {
  const error = (body as { error?: { code?: string; message?: string } } | undefined)?.error;
  if (error === undefined) {
    return undefined;
  }
  return [error.code, error.message].filter((s) => typeof s === 'string' && s !== '').join(': ');
}

function encodeSegments(path: string): string {
  return path
    .split('/')
    .map((s) => encodeURIComponent(s))
    .join('/');
}

function decodedPathOf(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname).replace(/\/$/, '');
  } catch {
    return '';
  }
}

function toResult<T>(response: GraphResponse): T {
  if (response.status >= 200 && response.status < 300) {
    return response.body as T;
  }
  const detail = errorMessage(response.body);
  if (response.status === 401) {
    throw new GraphError('auth', `Graph rejected the sign in token${detail ? ` (${detail})` : ''}. Sign in again and retry.`);
  }
  if (response.status === 403) {
    throw new GraphError(
      'permission',
      `Graph refused the request${detail ? ` (${detail})` : ''}. The signed in account needs the ${DEFAULT_SCOPES.join(' and ')} delegated permissions; an administrator may need to grant consent.`,
    );
  }
  if (response.status === 429 || response.status === 503) {
    const retry = Number.parseInt(response.headers['retry-after'] ?? '', 10);
    const seconds = Number.isFinite(retry) && retry > 0 ? retry : 30;
    throw new GraphError('throttled', `Graph asked to slow down (${response.status}). Retry in ${seconds} seconds.`, seconds);
  }
  if (response.status === 404) {
    throw new GraphError('not_found', detail ?? 'Graph could not find the item.');
  }
  throw new GraphError('error', `Graph answered ${response.status}${detail ? ` (${detail})` : ''}.`);
}

async function call<T>(graph: GraphClient, path: string, calls: string[], headers?: Record<string, string>): Promise<T> {
  calls.push(path.replace(/\?.*$/, ''));
  return toResult<T>(await graph.get(path, headers));
}

async function callPost<T>(graph: GraphClient, path: string, body: unknown, calls: string[]): Promise<T> {
  if (graph.post === undefined) {
    throw new GraphError('unsupported', 'This Graph client cannot send POST requests.');
  }
  calls.push(`POST ${path}`);
  return toResult<T>(await graph.post(path, body));
}

function normaliseId(value: string): string {
  return value.toLowerCase().replace(/[^0-9a-f]/g, '');
}

function sameId(a: string | undefined, b: string | undefined): boolean {
  return a !== undefined && b !== undefined && normaliseId(a) === normaliseId(b);
}

function correction(was: string | undefined, now: string): Correction | undefined {
  return was !== undefined && was !== now ? { was, now } : undefined;
}

/** The link's own document id, if it carries one: `d` on sharing links, or a GUID on Doc.aspx and UniqueId links. */
function linkDocumentId(result: ParseSuccess): { linkValue: string; normalised: string } | undefined {
  const d = result.identifiers.find((i) => i.kind === 'd');
  if (d !== undefined) {
    // `d` is a type letter followed by the GUID without dashes, e.g. w1a2b…
    return { linkValue: d.value, normalised: normaliseId(d.value.replace(/^[a-z]/i, '')) };
  }
  const guid = result.identifiers.find((i) => i.kind === 'sourcedoc' || i.kind === 'uniqueId');
  return guid === undefined ? undefined : { linkValue: guid.value, normalised: normaliseId(guid.value) };
}

function buildVerified(
  result: ParseSuccess,
  drive: GraphDrive,
  item: GraphItem,
  relativeFolder: string[],
  siteId: string | undefined,
  calls: string[],
  methodText: string,
): VerifiedResult {
  const host = result.components.host.value;
  const drivePath = decodedPathOf(drive.webUrl);
  const driveSegments = drivePath.split('/').filter((s) => s !== '');
  const library = driveSegments.at(-1) ?? drive.name ?? '';
  const siteSegments = driveSegments.slice(0, -1);
  const sitePath = siteSegments.length === 0 ? '' : `/${siteSegments.join('/')}`;
  const isFolder = item.folder !== undefined;
  const folders = isFolder ? [...relativeFolder, item.name] : relativeFolder;
  const folderPath = `${sitePath}/${library}${folders.map((f) => `/${f}`).join('')}`;
  const path = isFolder ? folderPath : `${folderPath}/${item.name}`;
  const folderUrl = `https://${host}${encodeSegments(folderPath)}`;

  const components: VerifiedComponents = {
    tenant: result.components.tenant.value,
    host,
    sitePath,
    library,
    folders,
  };
  if (!isFolder) {
    components.fileName = item.name;
  }

  const corrections: VerifiedResult['corrections'] = {};
  const libraryWas = correction(result.components.library?.value, library);
  if (libraryWas !== undefined) corrections.library = libraryWas;
  const foldersWas = correction(result.components.folders?.value.join(' / '), folders.join(' / '));
  if (foldersWas !== undefined) corrections.folders = foldersWas;
  const siteWas = correction(result.components.sitePath?.value, sitePath);
  if (siteWas !== undefined) corrections.sitePath = siteWas;
  const fileWas = correction(result.components.fileName?.value, item.name);
  if (!isFolder && fileWas !== undefined) corrections.fileName = fileWas;

  const verified: VerifiedResult = {
    path,
    folderUrl,
    components,
    corrections,
    graph: {
      driveId: drive.id,
      itemId: item.id,
      ...(siteId !== undefined ? { siteId } : {}),
      ...(item.sharepointIds?.listItemUniqueId !== undefined ? { listItemUniqueId: item.sharepointIds.listItemUniqueId } : {}),
      ...(item.webUrl !== undefined ? { webUrl: item.webUrl } : {}),
    },
    validatedAt: new Date().toISOString(),
    calls,
    methodText,
  };
  if (!isFolder) {
    verified.fileUrl = `https://${host}${encodeSegments(path)}`;
  }
  const linkId = linkDocumentId(result);
  const unique = item.sharepointIds?.listItemUniqueId;
  if (linkId !== undefined && unique !== undefined) {
    verified.identifierCheck = { linkValue: linkId.linkValue, graphValue: unique, matches: linkId.normalised === normaliseId(unique) };
  }
  return verified;
}

/**
 * The item's folder chain below its library. Graph often omits
 * `parentReference.path` on items reached through the shares endpoint, so
 * the item is fetched again by drive and id; failing that, the folder is read
 * from `webUrl` when it lies under the library. If none of these work the
 * validation fails rather than guessing the library root.
 */
async function folderChain(item: GraphItem, drive: GraphDrive, graph: GraphClient, calls: string[]): Promise<string[] | undefined> {
  const fromPath = (path: string | undefined): string[] | undefined => {
    if (path === undefined || !path.includes('root:')) {
      return undefined;
    }
    return decodeURIComponent(path.slice(path.indexOf('root:') + 'root:'.length))
      .split('/')
      .filter((s) => s !== '');
  };
  const direct = fromPath(item.parentReference?.path);
  if (direct !== undefined) {
    return direct;
  }
  try {
    const again = await call<GraphItem>(graph, `/drives/${drive.id}/items/${item.id}?$select=id,name,parentReference`, calls);
    const refetched = fromPath(again.parentReference?.path);
    if (refetched !== undefined) {
      return refetched;
    }
  } catch (error) {
    if (isFatal(error)) throw error;
  }
  if (item.webUrl !== undefined) {
    const itemPath = decodedPathOf(item.webUrl);
    const drivePath = decodedPathOf(drive.webUrl);
    if (itemPath.toLowerCase().startsWith(`${drivePath.toLowerCase()}/`)) {
      const segments = itemPath.slice(drivePath.length).split('/').filter((s) => s !== '');
      return segments.slice(0, -1);
    }
  }
  return undefined;
}

/** From a driveItem returned by Graph, fetch its drive and build the Verified result. */
async function verifyFromItem(
  result: ParseSuccess,
  item: GraphItem,
  graph: GraphClient,
  calls: string[],
  describe: (kind: string, library: string) => string,
): Promise<ValidationOutcome> {
  const driveId = item.parentReference?.driveId;
  if (driveId === undefined) {
    return { ok: false, kind: 'error', message: 'Graph returned the item without its drive, so its library cannot be named.', calls };
  }
  const drive = await call<GraphDrive>(graph, `/drives/${driveId}?$select=id,name,webUrl`, calls);
  const relativeFolder = await folderChain(item, drive, graph, calls);
  if (relativeFolder === undefined) {
    return {
      ok: false,
      kind: 'error',
      message: `Graph found "${item.name}" in library "${drive.name ?? drive.webUrl}" but did not say which folder it is in, so the path is left unconfirmed.`,
      calls,
    };
  }
  const kind = item.folder !== undefined ? 'folder' : 'file';
  const methodText = describe(kind, drive.name ?? drive.webUrl);
  return { ok: true, verified: buildVerified(result, drive, item, relativeFolder, item.sharepointIds?.siteId ?? item.parentReference?.siteId, calls, methodText) };
}

/** Site paths to try: the parser's, then up to three segments deeper, so subsites resolve (BC-037). */
export function siteCandidates(sitePath: string, path: string): string[] {
  const after = path
    .slice(sitePath.length)
    .split('/')
    .filter((s) => s !== '');
  // The last segment is the file or the target folder; a subsite cannot be it.
  const usable = after.slice(0, -1);
  const candidates = [sitePath];
  for (let depth = 1; depth <= Math.min(MAX_SUBSITE_DEPTH, usable.length); depth++) {
    candidates.push(`${sitePath}/${usable.slice(0, depth).join('/')}`);
  }
  return candidates;
}

/** Derived and Inferred results: site by path, drives listed, item by path (BC-037). */
async function validateByPath(result: ParseSuccess, graph: GraphClient, calls: string[]): Promise<ValidationOutcome> {
  const host = result.components.host.value;
  const sitePath = result.components.sitePath?.value ?? '';
  const path = result.path;
  if (path === undefined) {
    return { ok: false, kind: 'unsupported', message: 'This result has no path to confirm.', calls };
  }
  const lowerPath = path.toLowerCase();
  let librariesSeen = 0;
  let lastSiteUrl: string | undefined;

  for (const candidate of siteCandidates(sitePath, path)) {
    let site: GraphSite;
    try {
      site = await call<GraphSite>(graph, candidate === '' ? `/sites/${host}` : `/sites/${host}:${encodeSegments(candidate)}`, calls);
    } catch (error) {
      if (error instanceof GraphError && error.kind === 'not_found') {
        continue;
      }
      if (error instanceof GraphError && error.kind === 'permission' && candidate === sitePath) {
        return await validateByPathThroughShares(result, graph, calls, error.message);
      }
      throw error;
    }
    lastSiteUrl = site.webUrl;
    const drives = await call<{ value: GraphDrive[] }>(graph, `/sites/${site.id}/drives?$select=id,name,webUrl`, calls);
    librariesSeen += drives.value.length;
    let drive: GraphDrive | undefined;
    let drivePath = '';
    for (const found of drives.value) {
      const foundPath = decodedPathOf(found.webUrl);
      const lower = foundPath.toLowerCase();
      if ((lowerPath === lower || lowerPath.startsWith(`${lower}/`)) && foundPath.length > drivePath.length) {
        drive = found;
        drivePath = foundPath;
      }
    }
    if (drive === undefined) {
      continue;
    }
    const relative = path.slice(drivePath.length).replace(/^\//, '');
    const itemPath = relative === '' ? `/drives/${drive.id}/root?${ITEM_SELECT}` : `/drives/${drive.id}/root:/${encodeSegments(relative)}?${ITEM_SELECT}`;
    const item = await call<GraphItem>(graph, itemPath, calls);
    const relativeFolder = relative.split('/').filter((s) => s !== '').slice(0, -1);
    const isFolder = item.folder !== undefined;
    const subsiteNote = candidate === sitePath ? '' : ` The site turned out to be the subsite ${candidate}.`;
    const methodText = `Confirmed by Microsoft Graph: the site was resolved by path, its document libraries were listed and "${drive.name ?? drive.webUrl}" contains the path, and the ${
      isFolder ? 'folder' : 'file'
    } was fetched by path within that library.${subsiteNote}`;
    return { ok: true, verified: buildVerified(result, drive, item, relativeFolder, site.id, calls, methodText) };
  }

  return {
    ok: false,
    kind: 'not_found',
    message:
      lastSiteUrl === undefined
        ? 'Graph could not find a site at this path, so it could not find the item.'
        : `None of the ${librariesSeen} document libraries in ${lastSiteUrl}${librariesSeen > 0 ? ' (or its subsites)' : ''} contains this path, so Graph could not find the item.`,
    calls,
  };
}

/** Encodes a sharing URL for the `/shares/{id}` endpoint: `u!` plus unpadded base64url. */
export function encodeSharingUrl(url: string): string {
  const bytes = new TextEncoder().encode(url);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  // btoa is a global in browsers and in Node 16+, so no Buffer fallback is needed.
  return `u!${btoa(binary).replace(/=+$/, '').replaceAll('+', '-').replaceAll('/', '_')}`;
}

/**
 * Fallback for accounts that can read files but not enumerate sites: the
 * shares endpoint accepts any item URL the user can open (BC-037, S2).
 */
async function validateByPathThroughShares(result: ParseSuccess, graph: GraphClient, calls: string[], reason: string): Promise<ValidationOutcome> {
  const url = result.fileUrl ?? result.folderUrl;
  if (url === undefined) {
    return { ok: false, kind: 'permission', message: reason, calls };
  }
  const item = await call<GraphItem>(graph, `/shares/${encodeSharingUrl(url)}/driveItem?${ITEM_SELECT}`, calls, REDEEM_HEADERS);
  return verifyFromItem(
    result,
    item,
    graph,
    calls,
    (kind, library) =>
      `Confirmed by Microsoft Graph: the account could not list the site, so the item URL was submitted to the shares endpoint, which returned the ${kind} and its library "${library}".`,
  );
}

/** Unresolved sharing token links: the shares endpoint (BC-038). */
async function validateByShare(result: ParseSuccess, graph: GraphClient, calls: string[]): Promise<ValidationOutcome> {
  const item = await call<GraphItem>(graph, `/shares/${encodeSharingUrl(result.original)}/driveItem?${ITEM_SELECT}`, calls, REDEEM_HEADERS);
  return verifyFromItem(
    result,
    item,
    graph,
    calls,
    (kind, library) => `Confirmed by Microsoft Graph: the sharing link was submitted to the shares endpoint, which returned the ${kind} and its library "${library}".`,
  );
}

/**
 * Doc.aspx and UniqueId links (BC-039, spike S5): the link names a document
 * only by its unique id. Routes tried in order, and a candidate counts only
 * when its list item unique id equals the link's:
 *   1. the link itself through the shares endpoint;
 *   2. a search for the unique id;
 *   3. a search for the file name within the site, when the link names the file.
 */
async function validateByDocumentId(result: ParseSuccess, graph: GraphClient, calls: string[]): Promise<ValidationOutcome> {
  const linkId = linkDocumentId(result);
  if (linkId === undefined) {
    return { ok: false, kind: 'unsupported', message: 'The link carries no document id to look up.', calls };
  }
  const guid = linkId.linkValue;
  const host = result.components.host.value;
  const sitePath = result.components.sitePath?.value ?? '';
  const fileName = result.components.fileName?.value;
  const attempts: string[] = [];
  let lastKind: ValidationFailureKind = 'not_found';

  try {
    const item = await call<GraphItem>(graph, `/shares/${encodeSharingUrl(result.original)}/driveItem?${ITEM_SELECT}`, calls, REDEEM_HEADERS);
    const unique = item.sharepointIds?.listItemUniqueId;
    if (unique === undefined || normaliseId(unique) === linkId.normalised) {
      return verifyFromItem(
        result,
        item,
        graph,
        calls,
        (kind, library) =>
          `Confirmed by Microsoft Graph: the link was submitted to the shares endpoint, which returned the ${kind} and its library "${library}"${
            unique === undefined ? '' : ", and its unique id matches the link's document id"
          }.`,
      );
    }
    attempts.push('the shares endpoint returned a different document');
  } catch (error) {
    if (isFatal(error)) throw error;
    const e = error as GraphError;
    lastKind = e.kind;
    attempts.push(`the shares endpoint answered: ${e.message}`);
  }

  if (graph.post === undefined) {
    return { ok: false, kind: lastKind, message: `Graph could not resolve document ${guid}: ${attempts.join('; ')}.`, calls };
  }

  const queries: Array<{ query: string; label: string }> = [{ query: `UniqueId:${guid}`, label: "the link's document id" }];
  if (fileName !== undefined) {
    queries.push({ query: `filename:"${fileName}" path:"https://${host}${sitePath}"`, label: `the file name in ${sitePath === '' ? 'the root site' : sitePath}` });
  }

  for (const { query, label } of queries) {
    let response: SearchResponse;
    try {
      response = await callPost<SearchResponse>(
        graph,
        '/search/query',
        { requests: [{ entityTypes: ['driveItem'], query: { queryString: query }, from: 0, size: MAX_SEARCH_HITS }] },
        calls,
      );
    } catch (error) {
      if (isFatal(error)) throw error;
      const e = error as GraphError;
      lastKind = e.kind === 'not_found' ? lastKind : e.kind;
      attempts.push(`search for ${label} answered: ${e.message}`);
      continue;
    }
    const hits = (response.value ?? []).flatMap((v) => v.hitsContainers ?? []).flatMap((c) => c.hits ?? []).slice(0, MAX_SEARCH_HITS);
    for (const hit of hits) {
      const id = hit.resource?.id;
      const driveId = hit.resource?.parentReference?.driveId;
      if (id === undefined || driveId === undefined) {
        continue;
      }
      let item: GraphItem;
      try {
        item = await call<GraphItem>(graph, `/drives/${driveId}/items/${id}?${ITEM_SELECT}`, calls);
      } catch (error) {
        if (isFatal(error)) throw error;
        continue;
      }
      if (sameId(item.sharepointIds?.listItemUniqueId, guid)) {
        return verifyFromItem(
          result,
          item,
          graph,
          calls,
          (kind, library) =>
            `Confirmed by Microsoft Graph: a search for ${label} found the ${kind} in library "${library}", and its unique id matches the link's document id.`,
        );
      }
    }
    attempts.push(`search for ${label} found ${hits.length} ${hits.length === 1 ? 'item' : 'items'}, none with this document id`);
  }

  return { ok: false, kind: lastKind === 'permission' ? 'permission' : 'not_found', message: `Graph could not find document ${guid}: ${attempts.join('; ')}.`, calls };
}

/**
 * Validates one parser result. Never throws: every Graph failure becomes an
 * outcome with a kind the page can act on (BC-041).
 */
export async function validateResult(result: ParseSuccess, graph: GraphClient): Promise<ValidationOutcome> {
  const calls: string[] = [];
  try {
    if (result.state === 'Verified') {
      return { ok: false, kind: 'unsupported', message: 'This result is already Verified.', calls };
    }
    if (result.cloud !== 'global') {
      return { ok: false, kind: 'unsupported', message: 'Authenticated validation covers the global Microsoft cloud only in this version.', calls };
    }
    if (result.state === 'Unresolved') {
      if (SHARE_RESOLVABLE_FORMS.has(result.form)) {
        return await validateByShare(result, graph, calls);
      }
      if (DOCUMENT_ID_FORMS.has(result.form)) {
        return await validateByDocumentId(result, graph, calls);
      }
      return { ok: false, kind: 'unsupported', message: 'This link form cannot be validated in this version.', calls };
    }
    return await validateByPath(result, graph, calls);
  } catch (error) {
    if (error instanceof GraphError) {
      return {
        ok: false,
        kind: error.kind,
        message: error.message,
        calls,
        ...(error.retryAfterSeconds !== undefined ? { retryAfterSeconds: error.retryAfterSeconds } : {}),
      };
    }
    return { ok: false, kind: 'error', message: error instanceof Error ? error.message : String(error), calls };
  }
}
