import { buildUrl } from './encoding.js';
import { hasSiteShape, inferLibrary, isUnderPath, looksLikeFolder, ownerHint, segmentsOf, splitSitePath } from './path.js';
import type {
  Component,
  ComponentFlag,
  ConfidenceState,
  FailureDetail,
  FailureReason,
  Hint,
  Identifier,
  LibraryReason,
  ParseFailure,
  ParseSuccess,
  Wrapper,
} from './types.js';
import type { HostInfo } from './url.js';
import { PARSER_VERSION } from './version.js';

const FAILURE_MESSAGES: Record<FailureReason, (detail: FailureDetail) => string> = {
  not_a_url: () => 'That does not look like a link. Paste a full URL starting with https://.',
  not_microsoft_365: (d) => `${d.host ?? 'This host'} is not a SharePoint or OneDrive host, so there is nothing to decode.`,
  truncated: (d) => `The link appears truncated: the "${d.parameter ?? 'link'}" value is incomplete.`,
  unsupported_form: () => 'This link is on a Microsoft 365 host but its form is not supported yet.',
  missing_parameter: (d) => `The link is missing its "${d.parameter ?? ''}" parameter, so the item cannot be located.`,
  parser_error: () => 'The link could not be interpreted because of an unexpected parser error.',
};

export function failure(reason: FailureReason, detail?: FailureDetail, message?: string): ParseFailure {
  const result: ParseFailure = {
    ok: false,
    reason,
    message: message ?? FAILURE_MESSAGES[reason](detail ?? {}),
    parserVersion: PARSER_VERSION,
  };
  if (detail !== undefined) {
    result.detail = detail;
  }
  return result;
}

export function derived<T>(value: T): Component<T> {
  return { value, flag: 'Derived' };
}

export function flagged<T>(value: T, flag: ComponentFlag): Component<T> {
  return { value, flag };
}

/** Everything shared by every result builder. */
export interface ResultBase {
  host: HostInfo;
  form: string;
  methodCode: string;
  /** Plain language statement of how the item was located, before the inference sentence. */
  methodText: string;
  original: string;
  wrappers: Wrapper[];
  identifiers?: Identifier[];
  hints?: Hint[];
}

/** A located item: the site, library and folder chain are all known or inferred. */
export interface LocatedItem extends ResultBase {
  sitePath: string;
  library: { value: string; flag: ComponentFlag; reason: LibraryReason };
  /** Folder chain below the library, up to but excluding the file. */
  folders: string[];
  /** Absent for folder results. */
  fileName?: string;
}

function unknownHostNote(host: HostInfo): string {
  return ` The host ${host.host} is not a known Microsoft cloud, so the result is inferred.`;
}

/**
 * Assembles a ParseSuccess from a located item. The state is Derived only
 * when every component is Derived and the host is a known Microsoft cloud;
 * otherwise Inferred (BC-018, BC-020). The folder chain inherits the
 * library's flag, because moving the library boundary moves the folders.
 */
export function success(item: LocatedItem): ParseSuccess {
  const librarySegments = item.library.value === '' ? [] : [item.library.value];
  const folderPath = [item.sitePath, ...librarySegments.map((s) => `/${s}`), ...item.folders.map((s) => `/${s}`)].join('') || '/';
  const itemPath = item.fileName === undefined ? folderPath : `${folderPath === '/' ? '' : folderPath}/${item.fileName}`;

  const libraryDerived = item.library.flag === 'Derived';
  const hints = [...(item.hints ?? [])];
  let state: ConfidenceState = libraryDerived ? 'Derived' : 'Inferred';
  let text = `${item.methodText} ${
    libraryDerived ? 'Library boundary taken from the page path.' : `Library boundary and folder chain inferred: ${item.library.reason}.`
  }`;
  if (item.host.kind === 'unknown') {
    state = 'Inferred';
    text += unknownHostNote(item.host);
    hints.push({ kind: 'host', value: item.host.host, label: 'host is not a known Microsoft cloud' });
  }
  if (item.sitePath.toLowerCase().startsWith('/personal/')) {
    const alias = segmentsOf(item.sitePath)[1];
    if (alias !== undefined && !hints.some((h) => h.kind === 'owner')) {
      hints.push(ownerHint(alias));
    }
  }

  const result: ParseSuccess = {
    ok: true,
    state,
    form: item.form,
    method: { code: item.methodCode, text },
    cloud: item.host.cloud,
    path: itemPath,
    folderUrl: buildUrl(item.host.host, folderPath),
    components: {
      tenant: derived(item.host.tenant),
      host: derived(item.host.host),
      sitePath: derived(item.sitePath),
      library: { value: item.library.value, flag: item.library.flag, reason: item.library.reason },
      folders: flagged([...item.folders], item.library.flag),
    },
    identifiers: [...(item.identifiers ?? [])],
    hints,
    wrappers: [...item.wrappers],
    original: item.original,
    parserVersion: PARSER_VERSION,
  };
  if (item.fileName !== undefined) {
    result.fileUrl = buildUrl(item.host.host, itemPath);
    result.components.fileName = derived(item.fileName);
  }
  return result;
}

/** An Unresolved result: the form is recognised but the path is unknown without sign in. */
export interface UnresolvedItem extends ResultBase {
  sitePath?: string;
  fileName?: string;
}

export function unresolved(item: UnresolvedItem): ParseSuccess {
  const hints = [...(item.hints ?? [])];
  if (item.sitePath?.toLowerCase().startsWith('/personal/')) {
    const alias = segmentsOf(item.sitePath)[1];
    if (alias !== undefined && !hints.some((h) => h.kind === 'owner')) {
      hints.push(ownerHint(alias));
    }
  }
  const result: ParseSuccess = {
    ok: true,
    state: 'Unresolved',
    form: item.form,
    method: { code: item.methodCode, text: item.methodText },
    cloud: item.host.cloud,
    components: {
      tenant: derived(item.host.tenant),
      host: derived(item.host.host),
    },
    identifiers: [...(item.identifiers ?? [])],
    hints,
    wrappers: [...item.wrappers],
    original: item.original,
    parserVersion: PARSER_VERSION,
  };
  if (item.sitePath !== undefined) {
    result.components.sitePath = derived(item.sitePath);
  }
  if (item.fileName !== undefined) {
    result.components.fileName = derived(item.fileName);
  }
  return result;
}

export interface LocateOptions extends ResultBase {
  /** Force a folder result regardless of what the last segment looks like. */
  folder?: boolean;
}

/**
 * Locates an item from a decoded server relative path when nothing fixes the
 * library boundary: the site is split by convention and the library is
 * inferred by the BC-018 rules. Used by the direct, sharing, download and
 * OneDrive forms.
 */
/** SharePoint system folders: never a document library, folder or file (invariant 4). */
const SYSTEM_SEGMENTS = /^(_layouts|_vti_bin|_vti_pvt|_api|_catalogs|_cts|_private|_windows)$/i;

export function locateByPath(decodedPath: string, options: LocateOptions): ParseSuccess | ParseFailure {
  if (options.host.kind === 'unknown' && !hasSiteShape(decodedPath)) {
    return failure('not_microsoft_365', { host: options.host.host });
  }
  if (segmentsOf(decodedPath).some((segment) => SYSTEM_SEGMENTS.test(segment))) {
    return failure('unsupported_form', undefined, 'The link points at a SharePoint system page rather than a document library, folder or file.');
  }
  const isFolder = options.folder ?? looksLikeFolder(decodedPath);
  const split = splitSitePath(decodedPath);
  const inferred = inferLibrary(split.remainder);
  if (inferred === undefined) {
    return failure('unsupported_form', undefined, 'The link points at a site rather than a document library, folder or file.');
  }
  const { folder: _folder, ...base } = options;
  const item: LocatedItem = {
    ...base,
    sitePath: split.sitePath,
    library: { value: inferred.library, flag: 'Inferred', reason: inferred.reason },
    folders: isFolder ? inferred.rest : inferred.rest.slice(0, -1),
  };
  if (!isFolder) {
    const fileName = inferred.rest.at(-1);
    if (fileName === undefined) {
      // A file directly under the site with no library: treat the "library" as the file's container.
      return failure('unsupported_form', undefined, 'The link points at a site rather than a document library, folder or file.');
    }
    item.fileName = fileName;
  }
  return success(item);
}

/** Re-exported for form matchers that need the library-derived rule. */
export { isUnderPath };
