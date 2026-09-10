/**
 * Wrapper removal (BC-016 Teams deep links, BC-017 Outlook Safe Links).
 * Each wrapper's inner URL is decoded exactly once by the query parser.
 */
import { parseQuery } from '../encoding.js';
import { failure } from '../result.js';
import type { ParseFailure, Wrapper } from '../types.js';
import { safeParseUrl, type HostInfo } from '../url.js';

/** Returns the inner URL, or a failure when the wrapper is malformed. */
export function unwrap(url: URL, host: HostInfo, wrappers: Wrapper[]): URL | ParseFailure {
  const query = parseQuery(url.search);
  if (host.kind === 'teams') {
    if (!/^\/l\/file\//i.test(url.pathname)) {
      return failure('unsupported_form', undefined, 'This Teams link is not a file link, so there is no SharePoint URL inside it.');
    }
    const inner = query.get('objecturl');
    const innerUrl = inner === undefined ? undefined : safeParseUrl(inner);
    if (innerUrl === undefined) {
      return failure('missing_parameter', { parameter: 'objectUrl' }, 'The Teams file link has no usable "objectUrl" parameter, which should carry the SharePoint URL.');
    }
    wrappers.push({ type: 'teams', original: url.href });
    return innerUrl;
  }
  if (host.kind === 'safelinks') {
    const inner = query.get('url');
    if (inner === undefined || inner === '') {
      return failure('missing_parameter', { parameter: 'url' }, 'The Safe Links wrapper has no "url" parameter, so there is no protected link to unwrap.');
    }
    const innerUrl = safeParseUrl(inner);
    if (innerUrl === undefined) {
      return failure('truncated', { parameter: 'url' }, 'The wrapped link inside this Safe Links URL is incomplete, so it cannot be converted.');
    }
    wrappers.push({ type: 'safelinks', original: url.href });
    return innerUrl;
  }
  return failure('parser_error');
}
