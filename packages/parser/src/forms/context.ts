import type { ParseResult } from '../types.js';
import type { HostInfo } from '../url.js';

/** What every form matcher receives. Built once per parse in index.ts. */
export interface MatchContext {
  url: URL;
  host: HostInfo;
  /** URL path, percent decoded once. */
  pagePath: string;
  /** Query parameters, keys lower cased, values percent decoded once. */
  query: Map<string, string>;
  /** Trimmed input. */
  original: string;
}

/** Returns a result when the form matches, undefined to let the next matcher try. */
export type FormMatcher = (ctx: MatchContext) => ParseResult | undefined;
