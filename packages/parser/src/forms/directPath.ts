/**
 * Direct server relative file or folder URLs (matrix rows 2, 6, 11, 13;
 * BC-008, BC-014). Query parameters such as `web=1` or `csf=1&web=1&e=`
 * are ignored, so a copy link output with them converts identically.
 */
import { locateByPath } from '../result.js';
import type { FormMatcher } from './context.js';

export const directPath: FormMatcher = (ctx) => {
  if (ctx.host.kind !== 'sharepoint' && ctx.host.kind !== 'unknown') {
    return undefined;
  }
  if (/\/_(layouts|vti_bin|api|catalogs)\//i.test(ctx.pagePath) || ctx.pagePath === '/') {
    return undefined;
  }
  return locateByPath(ctx.pagePath, {
    host: ctx.host,
    form: 'direct-path',
    methodCode: 'direct/path',
    methodText: 'Path taken from the link itself.',
    original: ctx.original,
    wrappers: ctx.wrappers,
  });
};
