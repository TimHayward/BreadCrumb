/**
 * Link form matrix rows 1 and 1b (BC-007): library view pages such as
 * `.../Lib/Forms/AllItems.aspx?id={enc}&parent={enc}` and the classic
 * `...?RootFolder={enc}&viewid={guid}` variant.
 *
 * This is the one form where the library boundary is deterministic: the page
 * path places `/Forms/<view>.aspx` at the library root.
 */
import { decodePercent } from '../encoding.js';
import { inferLibrary, isUnderPath, parentOf, segmentsOf, splitSitePath } from '../path.js';
import { failure, success, type LocatedItem } from '../result.js';
import { safeParseUrl } from '../url.js';
import type { FormMatcher } from './context.js';

const VIEW_PAGE = /^(.*)\/Forms\/[^/]+\.aspx$/i;

/** Some links carry an absolute URL in `id`; reduce it to a decoded server relative path. */
export function toServerRelative(value: string, parameter: string): string {
  if (/^https?:\/\//i.test(value)) {
    const url = safeParseUrl(value);
    if (url !== undefined) {
      return decodePercent(url.pathname, parameter);
    }
  }
  return value;
}

export const libraryView: FormMatcher = (ctx) => {
  if (ctx.host.kind !== 'sharepoint' && ctx.host.kind !== 'unknown') {
    return undefined;
  }
  const match = VIEW_PAGE.exec(ctx.pagePath);
  if (match === null) {
    return undefined;
  }
  const libraryRoot = match[1] ?? '';
  const rootSegments = segmentsOf(libraryRoot);
  const pageLibrary = rootSegments[rootSegments.length - 1];
  if (pageLibrary === undefined) {
    return failure('unsupported_form', undefined, 'The view page is not inside a document library.');
  }
  const pageSitePath = `/${rootSegments.slice(0, -1).join('/')}`.replace(/^\/$/, '');

  const id = ctx.query.get('id');
  const parent = ctx.query.get('parent');
  const rootFolder = ctx.query.get('rootfolder');

  let form = 'library-view';
  let methodCode: string;
  let methodText: string;
  let targetPath: string;
  let fileName: string | undefined;

  if (id !== undefined && id !== '') {
    const itemPath = toServerRelative(id, 'id');
    const parentPath = parent === undefined || parent === '' ? undefined : toServerRelative(parent, 'parent');
    const isFolder = parentPath !== undefined && isUnderPath(itemPath, parentPath) && isUnderPath(parentPath, itemPath);
    if (isFolder) {
      methodCode = 'library-view/id+parent';
      methodText = "Folder decoded from the link's id parameter, which equals parent.";
      targetPath = itemPath;
    } else if (parentPath !== undefined) {
      methodCode = 'library-view/id+parent';
      methodText = "Path decoded from the link's id and parent parameters.";
      targetPath = parentPath;
      fileName = segmentsOf(itemPath).at(-1);
    } else {
      methodCode = 'library-view/id';
      methodText = "Path decoded from the link's id parameter; the folder is its parent.";
      targetPath = parentOf(itemPath);
      fileName = segmentsOf(itemPath).at(-1);
    }
  } else if (rootFolder !== undefined && rootFolder !== '') {
    form = 'library-view-classic';
    methodCode = 'library-view/root-folder';
    methodText = "Folder decoded from the link's RootFolder parameter.";
    targetPath = toServerRelative(rootFolder, 'rootfolder');
  } else {
    methodCode = 'library-view/library-root';
    methodText = "The link opens the library's default view, so the folder is the library root.";
    targetPath = libraryRoot;
  }

  // Library rule (BC-007): Derived when the item sits under the library named
  // by the page path, otherwise Inferred by the BC-018 rules.
  let sitePath: string;
  let library: LocatedItem['library'];
  let folders: string[];
  if (isUnderPath(targetPath, libraryRoot)) {
    sitePath = pageSitePath;
    library = { value: pageLibrary, flag: 'Derived', reason: 'from page path' };
    folders = segmentsOf(targetPath).slice(rootSegments.length);
  } else {
    const split = splitSitePath(targetPath);
    const inferred = inferLibrary(split.remainder);
    if (inferred === undefined) {
      return failure('unsupported_form', undefined, 'The id parameter does not point inside a document library.');
    }
    sitePath = split.sitePath;
    library = { value: inferred.library, flag: 'Inferred', reason: inferred.reason };
    folders = inferred.rest;
  }

  const item: LocatedItem = {
    host: ctx.host,
    form,
    methodCode,
    methodText,
    original: ctx.original,
    wrappers: ctx.wrappers,
    sitePath,
    library,
    folders,
  };
  if (fileName !== undefined) {
    item.fileName = fileName;
  }
  return success(item);
};
