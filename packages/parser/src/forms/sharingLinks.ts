/**
 * Modern sharing links (matrix rows 3a to 3d, 8 and 11; BC-010, BC-011).
 *
 *   /:w:/r/sites/SiteA/Lib/Folder/File.docx?d=w{guid}&csf=1&web=1&e={short}   path bearing
 *   /:b:/s/SiteA/{token}?e={short}                                             token, site scoped
 *   /:x:/g/personal/{alias}/{token}?e={short}                                  token, organisation scoped
 *   /:f:/t/SiteA/{token}?e={short}                                             token, "t" scope
 *   /_layouts/15/guestaccess.aspx?docid={id}&authkey={key}                      legacy guest access
 */
import { failure, locateByPath, unresolved } from '../result.js';
import { layoutsPages } from './layoutsPages.js';
import type { Hint, Identifier } from '../types.js';
import { itemTypeFromCode, layoutsPage, type FormMatcher } from './context.js';
import { ownerHint } from '../path.js';

const PATH_BEARING = /^\/:([a-z]{1,2}):\/r(\/.*)$/i;
const TOKEN_BEARING = /^\/:([a-z]{1,2}):\/([sgt])\/(.+)$/i;

function typeHint(code: string): Hint {
  return { kind: 'itemType', value: itemTypeFromCode(code), label: `item type from the link prefix ":${code.toLowerCase()}:"` };
}

export const sharingPath: FormMatcher = (ctx) => {
  if (ctx.host.kind !== 'sharepoint' && ctx.host.kind !== 'unknown') {
    return undefined;
  }
  const match = PATH_BEARING.exec(ctx.pagePath);
  if (match === null) {
    return undefined;
  }
  const code = match[1] ?? 'u';
  const path = match[2] ?? '/';
  // `/:w:/r/…/_layouts/15/Doc2.aspx?sourcedoc=…` wraps an Office web page, not a file
  // path: hand it to the layouts rules so the document id is read, never a made up path.
  if (/\/_layouts\//i.test(path)) {
    const inner = layoutsPages({ ...ctx, pagePath: path });
    if (inner === undefined) {
      return failure('unsupported_form', undefined, 'This sharing link points at a SharePoint page that does not identify a file or folder.');
    }
    return inner.ok ? { ...inner, hints: [typeHint(code), ...inner.hints] } : inner;
  }
  const identifiers: Identifier[] = [];
  const d = ctx.query.get('d');
  if (d !== undefined && d !== '') {
    identifiers.push({ kind: 'd', value: d, label: 'document id from link', flag: 'Derived' });
  }
  return locateByPath(path, {
    host: ctx.host,
    form: 'sharing-path',
    methodCode: 'sharing-path/r',
    methodText:
      'Path taken from the /r/ sharing link itself; the csf, web and e parameters are share bookkeeping and were dropped.',
    original: ctx.original,
    wrappers: ctx.wrappers,
    identifiers,
    hints: [typeHint(code)],
    folder: code.toLowerCase() === 'f',
  });
};

export const sharingToken: FormMatcher = (ctx) => {
  if (ctx.host.kind !== 'sharepoint' && ctx.host.kind !== 'unknown') {
    return undefined;
  }
  const match = TOKEN_BEARING.exec(ctx.pagePath);
  if (match === null) {
    return undefined;
  }
  const code = match[1] ?? 'u';
  const variant = (match[2] ?? 's').toLowerCase();
  const rest = (match[3] ?? '').split('/').filter((s) => s !== '');
  const hints: Hint[] = [typeHint(code)];
  let sitePath: string | undefined;
  let scopeText: string;

  if (rest[0]?.toLowerCase() === 'personal' && rest.length >= 3) {
    const alias = rest[1] ?? '';
    sitePath = `/personal/${alias}`;
    hints.push(ownerHint(alias));
    scopeText = `on the personal site of ${alias}`;
  } else if (rest.length >= 2) {
    const site = rest[0] ?? '';
    hints.push({ kind: 'site', value: site, label: 'site name from the sharing link (whether it lives under /sites/ or /teams/ is not known)' });
    scopeText = `for site ${site}`;
  } else {
    scopeText = 'with no site name in the link';
  }

  return unresolved({
    host: ctx.host,
    form: `sharing-token/${variant}`,
    methodCode: `sharing-token/${variant}`,
    methodText: `Recognised a sharing token link (/${variant}/ variant, ${itemTypeFromCode(code)}) ${scopeText}. The token cannot be decoded without signing in, so the path, library and folder are unknown. Authenticated validation can resolve it.`,
    original: ctx.original,
    wrappers: ctx.wrappers,
    hints,
    ...(sitePath !== undefined ? { sitePath } : {}),
  });
};

export const guestAccess: FormMatcher = (ctx) => {
  if (ctx.host.kind !== 'sharepoint' && ctx.host.kind !== 'unknown') {
    return undefined;
  }
  const page = layoutsPage(ctx.pagePath);
  if (page === undefined || page.page !== 'guestaccess.aspx') {
    return undefined;
  }
  const identifiers: Identifier[] = [];
  for (const [kind, label] of [
    ['docid', 'guest access document id'],
    ['share', 'guest access share id'],
  ] as const) {
    const value = ctx.query.get(kind);
    if (value !== undefined && value !== '') {
      identifiers.push({ kind, value, label, flag: 'Derived' });
    }
  }
  return unresolved({
    host: ctx.host,
    form: 'guest-access',
    methodCode: 'guest-access/legacy',
    methodText:
      'Recognised a legacy guest access link. Its identifiers cannot be decoded without signing in, so the path, library and folder are unknown.',
    original: ctx.original,
    wrappers: ctx.wrappers,
    identifiers,
    ...(page.sitePrefix !== '' ? { sitePath: page.sitePrefix } : {}),
  });
};
