import { buildUrl } from './encoding.js';
import type {
  Component,
  ComponentFlag,
  ConfidenceState,
  FailureDetail,
  FailureReason,
  LibraryReason,
  ParseFailure,
  ParseSuccess,
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

/** Everything a form matcher knows once it has located the item. */
export interface LocatedItem {
  host: HostInfo;
  form: string;
  methodCode: string;
  /** Plain language statement of how the path was decoded, without the library sentence. */
  methodText: string;
  original: string;
  sitePath: string;
  library: { value: string; flag: ComponentFlag; reason: LibraryReason };
  /** Folder chain below the library, up to but excluding the file. */
  folders: string[];
  /** Absent for folder results. */
  fileName?: string;
}

/**
 * Assembles a ParseSuccess from a located item. The overall state is Derived
 * only when every component is Derived; otherwise Inferred (BC-018). The
 * folder chain inherits the library's flag, because moving the library
 * boundary moves the folders with it.
 */
export function success(item: LocatedItem): ParseSuccess {
  const librarySegments = item.library.value === '' ? [] : [item.library.value];
  const folderPath = [item.sitePath, ...librarySegments.map((s) => `/${s}`), ...item.folders.map((s) => `/${s}`)].join('') || '/';
  const itemPath = item.fileName === undefined ? folderPath : `${folderPath === '/' ? '' : folderPath}/${item.fileName}`;

  const state: ConfidenceState = item.library.flag === 'Derived' ? 'Derived' : 'Inferred';
  const librarySentence =
    item.library.flag === 'Derived'
      ? 'Library boundary taken from the page path.'
      : `Library boundary inferred: ${item.library.reason}.`;

  const result: ParseSuccess = {
    ok: true,
    state,
    form: item.form,
    method: { code: item.methodCode, text: `${item.methodText} ${librarySentence}` },
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
    identifiers: [],
    hints: [],
    wrappers: [],
    original: item.original,
    parserVersion: PARSER_VERSION,
  };
  if (item.fileName !== undefined) {
    result.fileUrl = buildUrl(item.host.host, itemPath);
    result.components.fileName = derived(item.fileName);
  }
  return result;
}
