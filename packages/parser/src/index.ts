/**
 * @breadcrumb/parser: turns a Microsoft 365 SharePoint or OneDrive link into
 * the folder location it points at (BC-006).
 *
 * Pure by design (invariant 2): no network, no DOM, no Node built-ins.
 */
import { DecodeError, decodePercent, parseQuery } from './encoding.js';
import type { MatchContext } from './forms/context.js';
import { forms } from './forms/registry.js';
import { unwrap } from './forms/wrappers.js';
import { failure } from './result.js';
import type { ParseOptions, ParseResult, Wrapper } from './types.js';
import { classifyHost, safeParseUrl } from './url.js';

export type {
  Cloud,
  Component,
  ComponentFlag,
  Components,
  ConfidenceState,
  FailureDetail,
  FailureReason,
  Hint,
  Identifier,
  LibraryComponent,
  LibraryReason,
  Method,
  ParseFailure,
  ParseOptions,
  ParseResult,
  ParseSuccess,
  Wrapper,
  WrapperType,
} from './types.js';
export { SHORT_LINK_HOSTS, classifyHost } from './url.js';
export { documentKey, documentKeyForUniqueId } from './identity.js';
export { PARSER_VERSION } from './version.js';

/** Wrappers nested deeper than this are treated as malformed. */
const MAX_WRAPPERS = 5;

/**
 * Parses a link. Never throws for string input: every outcome is either a
 * ParseSuccess carrying exactly one confidence state or a ParseFailure
 * carrying a reason code and a plain language message.
 */
export function parseLink(input: string, options: ParseOptions = {}): ParseResult {
  try {
    return parse(input, options);
  } catch (error) {
    if (error instanceof DecodeError) {
      return failure('truncated', { parameter: error.parameter });
    }
    return failure('parser_error');
  }
}

function parse(input: string, options: ParseOptions): ParseResult {
  if (typeof input !== 'string') {
    return failure('not_a_url');
  }
  const original = input.trim();
  if (original === '') {
    return failure('not_a_url', undefined, 'Enter a link to convert.');
  }
  let url = safeParseUrl(original);
  if (url === undefined) {
    return failure('not_a_url');
  }

  const wrappers: Wrapper[] = [...(options.priorWrappers ?? [])];
  let host = classifyHost(url.hostname);
  for (let depth = 0; host.kind === 'teams' || host.kind === 'safelinks'; depth++) {
    if (depth >= MAX_WRAPPERS) {
      return failure('unsupported_form', undefined, 'The link is wrapped too many times to be unwrapped safely.');
    }
    const inner = unwrap(url, host, wrappers);
    if (!(inner instanceof URL)) {
      return inner;
    }
    url = inner;
    host = classifyHost(url.hostname);
  }

  const ctx: MatchContext = {
    url,
    host,
    pagePath: decodePercent(url.pathname, 'path'),
    query: parseQuery(url.search),
    original,
    wrappers,
  };
  for (const matcher of forms) {
    const result = matcher(ctx);
    if (result !== undefined) {
      return result;
    }
  }
  return host.kind === 'unknown' ? failure('not_microsoft_365', { host: host.host }) : failure('unsupported_form');
}
