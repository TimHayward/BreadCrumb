/**
 * Percent encoding fidelity (BC-009, invariant 7).
 *
 * Decoding happens exactly once, from the raw query or path value. Rebuilt
 * URLs are encoded exactly once, from the decoded value, one path segment at
 * a time. Nothing that is already encoded is ever encoded again.
 */

/** Thrown when a percent encoded value cannot be decoded, usually because it was cut off. */
export class DecodeError extends Error {
  readonly parameter: string;

  constructor(parameter: string) {
    super(`The value of "${parameter}" is not valid percent encoding`);
    this.name = 'DecodeError';
    this.parameter = parameter;
  }
}

/**
 * Decodes a percent encoded value. Mixed case hex (`%2d`, `%2D`) decodes
 * identically. A literal `+` stays a `+`: SharePoint never uses `+` for a
 * space in these parameters, so treating it as one would corrupt file names.
 */
export function decodePercent(value: string, parameter: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new DecodeError(parameter);
  }
}

/**
 * Parses a query string without URLSearchParams, which would turn `+` into a
 * space. Keys are lower cased for lookup. The first `=` splits key and value;
 * a key with no `=` has an empty value.
 */
export function parseQuery(search: string): Map<string, string> {
  const query = search.startsWith('?') ? search.slice(1) : search;
  const result = new Map<string, string>();
  if (query === '') {
    return result;
  }
  for (const pair of query.split('&')) {
    if (pair === '') {
      continue;
    }
    const eq = pair.indexOf('=');
    const rawKey = eq === -1 ? pair : pair.slice(0, eq);
    const rawValue = eq === -1 ? '' : pair.slice(eq + 1);
    const key = decodePercent(rawKey, rawKey).toLowerCase();
    if (!result.has(key)) {
      result.set(key, decodePercent(rawValue, key));
    }
  }
  return result;
}

/**
 * Encodes one decoded path segment. Spaces become `%20`; `-` `.` `_` `~` and
 * the sub-delimiters `!` `'` `(` `)` `*` stay literal; `&` `#` `+` `%` `?`
 * and non ASCII characters are encoded.
 */
export function encodeSegment(segment: string): string {
  return encodeURIComponent(segment);
}

/** Encodes a decoded server relative path segment by segment. */
export function encodePath(decodedPath: string): string {
  return decodedPath.split('/').map(encodeSegment).join('/');
}

/** Builds an absolute https URL from a host and a decoded server relative path. */
export function buildUrl(host: string, decodedPath: string): string {
  return `https://${host}${encodePath(decodedPath)}`;
}
