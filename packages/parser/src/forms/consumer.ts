/**
 * OneDrive consumer links (matrix rows 7a and 7b; BC-015).
 *
 *   https://onedrive.live.com/?cid={hex}&resid={hex}%21{n}&authkey={key}   Unresolved, identifiers reported
 *   https://1drv.ms/x/s!{token}                                            Unresolved until expanded (BC-027)
 */
import { unresolved } from '../result.js';
import type { Identifier } from '../types.js';
import type { FormMatcher } from './context.js';

export const oneDriveConsumer: FormMatcher = (ctx) => {
  if (ctx.host.kind !== 'onedrive-consumer') {
    return undefined;
  }
  const identifiers: Identifier[] = [];
  for (const [kind, label] of [
    ['cid', 'OneDrive owner id (cid)'],
    ['resid', 'OneDrive item id (resid)'],
    ['id', 'OneDrive item id (id)'],
  ] as const) {
    const value = ctx.query.get(kind);
    if (value !== undefined && value !== '') {
      identifiers.push({ kind, value, label, flag: 'Derived' });
    }
  }
  return unresolved({
    host: ctx.host,
    form: 'onedrive-consumer',
    methodCode: 'onedrive-consumer/identifiers',
    methodText:
      'Recognised a consumer OneDrive link. Its owner and item identifiers are reported, but consumer OneDrive cannot be resolved to a path in this version.',
    original: ctx.original,
    wrappers: ctx.wrappers,
    identifiers,
  });
};

export const shortLink: FormMatcher = (ctx) => {
  if (ctx.host.kind !== 'shortlink') {
    return undefined;
  }
  return unresolved({
    host: ctx.host,
    form: 'onedrive-shortlink',
    methodCode: 'onedrive-shortlink/unexpanded',
    methodText: `Recognised a ${ctx.host.host} short link. It says nothing about the file until it is expanded to the link it redirects to, which the web application can do when short link expansion is enabled.`,
    original: ctx.original,
    wrappers: ctx.wrappers,
    hints: [{ kind: 'expansion', value: 'required', label: 'short link must be expanded before anything more can be said' }],
  });
};
