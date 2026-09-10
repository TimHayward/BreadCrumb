/**
 * @breadcrumb/parser: turns a Microsoft 365 SharePoint or OneDrive link into
 * the folder location it points at (BC-006).
 *
 * Pure by design (invariant 2): no network, no DOM, no Node built-ins.
 */
import { DecodeError, decodePercent, parseQuery } from './encoding.js';
import type { MatchContext } from './forms/context.js';
import { forms } from './forms/registry.js';
import { failure } from './result.js';
import type { ParseResult } from './types.js';
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
  ParseResult,
  ParseSuccess,
  Wrapper,
  WrapperType,
} from './types.js';
export { PARSER_VERSION } from './version.js';

/**
 * Parses a link. Never throws for string input: every outcome is either a
 * ParseSuccess carrying exactly one confidence state or a ParseFailure
 * carrying a reason code and a plain language message.
 */
export function parseLink(input: string): ParseResult {
  try {
    return parse(input);
  } catch (error) {
    if (error instanceof DecodeError) {
      return failure('truncated', { parameter: error.parameter });
    }
    return failure('parser_error');
  }
}

function parse(input: string): ParseResult {
  if (typeof input !== 'string') {
    return failure('not_a_url');
  }
  const original = input.trim();
  if (original === '') {
    return failure('not_a_url', undefined, 'Enter a link to convert.');
  }
  const url = safeParseUrl(original);
  if (url === undefined) {
    return failure('not_a_url');
  }
  const host = classifyHost(url.hostname);
  if (host.kind === 'unknown') {
    return failure('not_microsoft_365', { host: host.host });
  }
  const ctx: MatchContext = {
    url,
    host,
    pagePath: decodePercent(url.pathname, 'path'),
    query: parseQuery(url.search),
    original,
  };
  for (const matcher of forms) {
    const result = matcher(ctx);
    if (result !== undefined) {
      return result;
    }
  }
  return failure('unsupported_form');
}
