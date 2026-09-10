/**
 * `_layouts/15/` pages (matrix rows 4, 5, 5b, 6; BC-012, BC-013, BC-014).
 *
 *   Doc.aspx?sourcedoc={guid}&file=File.docx&action=default   Unresolved, site and file name known
 *   WopiFrame.aspx?sourcedoc={guid}                             as Doc.aspx
 *   download.aspx?SourceUrl={enc}                               full, library inferred
 *   any page?SourceUrl={enc}                                    as download.aspx
 *   download.aspx?UniqueId={guid}                               Unresolved, site known
 *   onedrive.aspx?id={enc}                                      full, library inferred (OneDrive for Business)
 */
import { failure, locateByPath, unresolved } from '../result.js';
import { layoutsPage, type FormMatcher } from './context.js';
import { toServerRelative } from './libraryView.js';

const GUID = /^\{?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\}?$/i;

export const layoutsPages: FormMatcher = (ctx) => {
  if (ctx.host.kind !== 'sharepoint' && ctx.host.kind !== 'unknown') {
    return undefined;
  }
  const page = layoutsPage(ctx.pagePath);
  if (page === undefined) {
    return undefined;
  }
  const sitePath = page.sitePrefix;
  const base = { host: ctx.host, original: ctx.original, wrappers: ctx.wrappers };

  const sourceDoc = ctx.query.get('sourcedoc');
  if ((page.page === 'doc.aspx' || page.page === 'wopiframe.aspx') && sourceDoc !== undefined) {
    const guid = GUID.exec(sourceDoc.trim())?.[1];
    if (guid === undefined) {
      return failure('truncated', { parameter: 'sourcedoc' }, 'The "sourcedoc" value is not a complete document id.');
    }
    const file = ctx.query.get('file');
    const fileName = file === undefined || file === '' ? undefined : file;
    return unresolved({
      ...base,
      form: 'doc-aspx',
      methodCode: `doc-aspx/${page.page.replace('.aspx', '')}`,
      methodText: `Recognised a ${page.page === 'doc.aspx' ? 'Doc.aspx' : 'WopiFrame.aspx'} link. The site${
        fileName === undefined ? '' : ' and file name'
      } can be read from the link, but the document is identified only by its id, so the folder cannot be known without signing in.`,
      identifiers: [{ kind: 'sourcedoc', value: guid, label: 'document id (list item unique id) from sourcedoc', flag: 'Derived' }],
      ...(sitePath !== '' ? { sitePath } : {}),
      ...(fileName !== undefined ? { fileName } : {}),
    });
  }

  const sourceUrl = ctx.query.get('sourceurl');
  if (sourceUrl !== undefined && sourceUrl !== '') {
    return locateByPath(toServerRelative(sourceUrl, 'sourceurl'), {
      ...base,
      form: 'layouts-source-url',
      methodCode: `layouts/${page.page.replace('.aspx', '')}/source-url`,
      methodText: `Path taken from the SourceUrl parameter of the ${page.page} page.`,
      folder: false,
    });
  }

  const uniqueId = ctx.query.get('uniqueid');
  if (uniqueId !== undefined && uniqueId !== '') {
    const guid = GUID.exec(uniqueId.trim())?.[1];
    if (guid === undefined) {
      return failure('truncated', { parameter: 'UniqueId' }, 'The "UniqueId" value is not a complete document id.');
    }
    return unresolved({
      ...base,
      form: 'layouts-unique-id',
      methodCode: `layouts/${page.page.replace('.aspx', '')}/unique-id`,
      methodText: `Recognised a ${page.page} link that identifies the item only by its unique id, so the folder cannot be known without signing in.`,
      identifiers: [{ kind: 'uniqueId', value: guid, label: 'document id (unique id) from the link', flag: 'Derived' }],
      ...(sitePath !== '' ? { sitePath } : {}),
    });
  }

  const id = ctx.query.get('id');
  if (page.page === 'onedrive.aspx' && id !== undefined && id !== '') {
    return locateByPath(toServerRelative(id, 'id'), {
      ...base,
      form: 'onedrive-view',
      methodCode: 'onedrive-view/id',
      methodText: "Path decoded from the onedrive.aspx link's id parameter.",
    });
  }

  return failure('unsupported_form', undefined, `The ${page.page} page link carries no parameter that locates a file or folder.`);
};
