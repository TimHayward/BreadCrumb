import type { ParseResult, Wrapper } from '../types.js';
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
  /** Wrappers removed before this URL was reached, outermost first. */
  wrappers: Wrapper[];
}

/** Returns a result when the form matches, undefined to let the next matcher try. */
export type FormMatcher = (ctx: MatchContext) => ParseResult | undefined;

/** Item types implied by the `:x:` prefix of modern sharing links (BC-010). */
const TYPE_CODES: Record<string, string> = {
  w: 'Word document',
  x: 'Excel workbook',
  p: 'PowerPoint presentation',
  o: 'OneNote notebook',
  b: 'PDF or other binary file',
  f: 'folder',
  v: 'Visio drawing',
  i: 'image',
  u: 'file',
  t: 'text file',
  l: 'list',
  li: 'list item',
  fl: 'Loop component',
};

export function itemTypeFromCode(code: string): string {
  return TYPE_CODES[code.toLowerCase()] ?? `unknown type code ":${code}:"`;
}

/** Layouts page name from a decoded path such as `/sites/A/_layouts/15/Doc.aspx`, lower cased. */
export function layoutsPage(pagePath: string): { sitePrefix: string; page: string } | undefined {
  const match = /^(.*?)\/_layouts\/(?:\d+\/)?([^/]+\.aspx)$/i.exec(pagePath);
  if (match === null) {
    return undefined;
  }
  return { sitePrefix: match[1] ?? '', page: (match[2] ?? '').toLowerCase() };
}
