/**
 * Public contract of @breadcrumb/parser (BC-006).
 *
 * The full shape ships from M1 so that later link forms (M2) and
 * authenticated validation (M3) add data without changing the contract.
 */

/** The four confidence states, with the meanings fixed in BACKLOG.md. */
export type ConfidenceState = 'Verified' | 'Derived' | 'Inferred' | 'Unresolved';

/** Per component flag: decoded deterministically, or a best effort guess. */
export type ComponentFlag = 'Derived' | 'Inferred';

export interface Component<T = string> {
  value: T;
  flag: ComponentFlag;
}

/** Why the library boundary sits where it does (BC-007, BC-018). */
export type LibraryReason = 'from page path' | 'well known library name' | 'first segment after site';

export interface LibraryComponent extends Component<string> {
  reason: LibraryReason;
}

/** Which Microsoft cloud the host belongs to (BC-020). */
export type Cloud = 'global' | 'gcc-high' | 'dod' | 'china' | 'unknown';

/** An opaque identifier carried by the link, such as a document GUID. */
export interface Identifier {
  kind: string;
  value: string;
  label: string;
  flag: ComponentFlag;
}

/** A best effort hint that is not a component, such as an item type code. */
export interface Hint {
  kind: string;
  value: string;
  label: string;
}

export type WrapperType = 'teams' | 'safelinks' | 'shortlink';

/** A wrapper removed before parsing, recorded in the order it was removed. */
export interface Wrapper {
  type: WrapperType;
  original: string;
}

/**
 * Decoded components. `tenant` and `host` are always present. The rest are
 * present when the link form reveals them; an Unresolved result may carry
 * only a site path or a file name.
 */
export interface Components {
  tenant: Component;
  host: Component;
  sitePath?: Component;
  library?: LibraryComponent;
  folders?: Component<string[]>;
  fileName?: Component;
}

export interface Method {
  /** Stable machine readable code, e.g. `library-view/id+parent`. */
  code: string;
  /** Plain language statement of how the result was obtained and what is inferred or unknown. */
  text: string;
}

export interface ParseSuccess {
  ok: true;
  state: ConfidenceState;
  /** Detected link form, e.g. `library-view`, `sharing-token/s`. */
  form: string;
  method: Method;
  cloud: Cloud;
  /** Decoded server relative path of the item. Absent when Unresolved. */
  path?: string;
  /** Encoded URL of the containing folder (or the folder itself). Absent when Unresolved. */
  folderUrl?: string;
  /** Encoded URL of the file. Absent for folder results and when Unresolved. */
  fileUrl?: string;
  components: Components;
  identifiers: Identifier[];
  hints: Hint[];
  wrappers: Wrapper[];
  /** The input exactly as received, after trimming. */
  original: string;
  parserVersion: string;
}

export type FailureReason =
  | 'not_a_url'
  | 'not_microsoft_365'
  | 'truncated'
  | 'unsupported_form'
  | 'missing_parameter'
  | 'parser_error';

export interface FailureDetail {
  host?: string;
  parameter?: string;
}

export interface ParseFailure {
  ok: false;
  reason: FailureReason;
  message: string;
  detail?: FailureDetail;
  parserVersion: string;
}

export type ParseResult = ParseSuccess | ParseFailure;

export interface ParseOptions {
  /**
   * Wrappers already removed by the caller, such as a short link the server
   * expanded (BC-027). They are recorded ahead of any the parser removes.
   */
  priorWrappers?: Wrapper[];
}
