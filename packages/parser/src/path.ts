import type { LibraryReason } from './types.js';

/** Site collection prefixes recognised in a server relative path. */
const SITE_PREFIXES = new Set(['sites', 'teams', 'personal']);

/** Library names SharePoint creates by default (BC-018). */
const WELL_KNOWN_LIBRARIES = new Set(['shared documents', 'documents']);

export interface SiteSplit {
  /** `/sites/x`, `/teams/x`, `/personal/x`, or `''` for the root site. */
  sitePath: string;
  /** Decoded segments after the site path. */
  remainder: string[];
}

/** Splits a decoded server relative path into segments, dropping empties. */
export function segmentsOf(decodedPath: string): string[] {
  return decodedPath.split('/').filter((segment) => segment !== '');
}

/** Joins segments back into a server relative path with a leading slash. */
export function joinSegments(segments: readonly string[]): string {
  return segments.length === 0 ? '/' : `/${segments.join('/')}`;
}

/**
 * Splits off the site collection path using the `/sites/{name}`,
 * `/teams/{name}` and `/personal/{alias}` conventions. Anything else is the
 * root site with an empty site path.
 */
export function splitSitePath(decodedPath: string): SiteSplit {
  const segments = segmentsOf(decodedPath);
  const first = segments[0];
  const second = segments[1];
  if (first !== undefined && second !== undefined && SITE_PREFIXES.has(first.toLowerCase())) {
    return { sitePath: `/${first}/${second}`, remainder: segments.slice(2) };
  }
  return { sitePath: '', remainder: segments };
}

export interface LibraryInference {
  library: string;
  reason: LibraryReason;
  /** Segments after the library. */
  rest: string[];
}

/**
 * Best effort library boundary when the page path does not fix it (BC-018).
 * Returns undefined when there is no segment to choose from.
 */
export function inferLibrary(remainder: readonly string[]): LibraryInference | undefined {
  const first = remainder[0];
  if (first === undefined) {
    return undefined;
  }
  const reason: LibraryReason = WELL_KNOWN_LIBRARIES.has(first.toLowerCase())
    ? 'well known library name'
    : 'first segment after site';
  return { library: first, reason, rest: remainder.slice(1) };
}

/** True when `path` is `prefix` itself or lies beneath it, compared case insensitively. */
export function isUnderPath(path: string, prefix: string): boolean {
  const p = path.toLowerCase();
  const q = prefix.toLowerCase();
  return p === q || p.startsWith(q.endsWith('/') ? q : `${q}/`);
}

/** Returns the parent path of a server relative path, or `/` at the root. */
export function parentOf(decodedPath: string): string {
  const segments = segmentsOf(decodedPath);
  return joinSegments(segments.slice(0, -1));
}
