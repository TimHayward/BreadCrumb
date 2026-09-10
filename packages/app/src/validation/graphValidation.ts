/**
 * Validates a best effort parser result against Microsoft Graph (BC-037,
 * BC-038, BC-041). Pure: it takes a GraphClient and returns an outcome, so it
 * runs unchanged in the browser bundle and in Node tests with recorded
 * responses. Graph is called from the browser (decision D3), never from the
 * server.
 */
import type { ParseSuccess } from '@breadcrumb/parser';
import type { Correction, VerifiedComponents, VerifiedResult } from './types.js';

export interface GraphResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

/** Performs a GET against Graph v1.0; `path` starts with `/` and excludes the host. */
export interface GraphClient {
  get(path: string): Promise<GraphResponse>;
}

export type ValidationFailureKind = 'not_found' | 'permission' | 'throttled' | 'auth' | 'unsupported' | 'error';

export type ValidationOutcome =
  | { ok: true; verified: VerifiedResult }
  | { ok: false; kind: ValidationFailureKind; message: string; calls: string[]; retryAfterSeconds?: number };

/** Delegated permissions requested at sign in. Spike S2 may narrow these. */
export const DEFAULT_SCOPES = ['Files.Read.All', 'Sites.Read.All'];

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

async function call<T>(graph: GraphClient, path: string, calls: string[]): Promise<T> {
  calls.push(path.replace(/\?.*$/, ''));
  const response = await graph.get(path);
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

function normaliseId(value: string): string {
  return value.toLowerCase().replace(/[^0-9a-f]/g, '');
}

function correction(was: string | undefined, now: string): Correction | undefined {
  return was !== undefined && was !== now ? { was, now } : undefined;
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
  const d = result.identifiers.find((i) => i.kind === 'd');
  const unique = item.sharepointIds?.listItemUniqueId;
  if (d !== undefined && unique !== undefined) {
    const linkId = normaliseId(d.value.replace(/^[a-z]/i, ''));
    verified.identifierCheck = { linkValue: d.value, graphValue: unique, matches: linkId === normaliseId(unique) };
  }
  return verified;
}

/** Derived and Inferred results: site by path, drives listed, item by path (BC-037). */
async function validateByPath(result: ParseSuccess, graph: GraphClient, calls: string[]): Promise<ValidationOutcome> {
  const host = result.components.host.value;
  const sitePath = result.components.sitePath?.value ?? '';
  const path = result.path;
  if (path === undefined) {
    return { ok: false, kind: 'unsupported', message: 'This result has no path to confirm.', calls };
  }
  const site = await call<GraphSite>(graph, sitePath === '' ? `/sites/${host}` : `/sites/${host}:${encodeSegments(sitePath)}`, calls);
  const drives = await call<{ value: GraphDrive[] }>(graph, `/sites/${site.id}/drives?$select=id,name,webUrl`, calls);
  const lowerPath = path.toLowerCase();
  let drive: GraphDrive | undefined;
  let drivePath = '';
  for (const candidate of drives.value) {
    const candidatePath = decodedPathOf(candidate.webUrl);
    const lower = candidatePath.toLowerCase();
    if ((lowerPath === lower || lowerPath.startsWith(`${lower}/`)) && candidatePath.length > drivePath.length) {
      drive = candidate;
      drivePath = candidatePath;
    }
  }
  if (drive === undefined) {
    return {
      ok: false,
      kind: 'not_found',
      message: `None of the ${drives.value.length} document libraries in ${site.webUrl} contains this path, so Graph could not find the item.`,
      calls,
    };
  }
  const relative = path.slice(drivePath.length).replace(/^\//, '');
  const itemPath = relative === '' ? `/drives/${drive.id}/root?${ITEM_SELECT}` : `/drives/${drive.id}/root:/${encodeSegments(relative)}?${ITEM_SELECT}`;
  const item = await call<GraphItem>(graph, itemPath, calls);
  const relativeSegments = relative.split('/').filter((s) => s !== '');
  const relativeFolder = relativeSegments.slice(0, -1);
  const isFolder = item.folder !== undefined;
  const methodText = `Confirmed by Microsoft Graph: the site was resolved by path, its document libraries were listed and "${drive.name ?? drive.webUrl}" contains the path, and the ${
    isFolder ? 'folder' : 'file'
  } was fetched by path within that library.`;
  return { ok: true, verified: buildVerified(result, drive, item, isFolder ? relativeFolder : relativeFolder, site.id, calls, methodText) };
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

/** Unresolved sharing token links: the shares endpoint (BC-038). */
async function validateByShare(result: ParseSuccess, graph: GraphClient, calls: string[]): Promise<ValidationOutcome> {
  const item = await call<GraphItem>(graph, `/shares/${encodeSharingUrl(result.original)}/driveItem?${ITEM_SELECT}`, calls);
  const driveId = item.parentReference?.driveId;
  if (driveId === undefined) {
    return { ok: false, kind: 'error', message: 'Graph returned the shared item without its drive, so its library cannot be named.', calls };
  }
  const drive = await call<GraphDrive>(graph, `/drives/${driveId}?$select=id,name,webUrl`, calls);
  const parentPath = item.parentReference?.path ?? '';
  const afterRoot = parentPath.includes('root:') ? parentPath.slice(parentPath.indexOf('root:') + 'root:'.length) : '';
  const relativeFolder = decodeURIComponent(afterRoot)
    .split('/')
    .filter((s) => s !== '');
  const methodText = `Confirmed by Microsoft Graph: the sharing link was submitted to the shares endpoint, which returned the ${
    item.folder !== undefined ? 'folder' : 'file'
  } and its library "${drive.name ?? drive.webUrl}".`;
  return { ok: true, verified: buildVerified(result, drive, item, relativeFolder, item.sharepointIds?.siteId, calls, methodText) };
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
      if (result.form.startsWith('sharing-token/') || result.form === 'guest-access') {
        return await validateByShare(result, graph, calls);
      }
      if (result.form === 'doc-aspx' || result.form === 'layouts-unique-id') {
        return {
          ok: false,
          kind: 'unsupported',
          message: 'Resolving a document by its id alone awaits spike S5; this link stays Unresolved for now.',
          calls,
        };
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
