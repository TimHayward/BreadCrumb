import { describe, expect, it } from 'vitest';
import { documentKey, documentKeyForUniqueId, parseLink } from '../src/index.js';

const GUID = '3F2A9C1E-7B4D-4E0A-9C6B-1D2E3F4A5B6C';
const HEX = '3f2a9c1e7b4d4e0a9c6b1d2e3f4a5b6c';
const key = (url: string): string => documentKey(parseLink(url), url);

describe('documentKey', () => {
  it('keys document id links by their id, whatever the query parameters or form', () => {
    expect(key(`https://contoso.sharepoint.com/sites/SiteA/_layouts/15/Doc.aspx?sourcedoc=%7B${GUID}%7D&file=Plan.docx&action=edit`)).toBe(`id:${HEX}`);
    expect(key(`https://contoso.sharepoint.com/sites/SiteA/_layouts/15/Doc.aspx?sourcedoc=${GUID.toLowerCase()}&action=default&mobileredirect=true`)).toBe(`id:${HEX}`);
    expect(key(`https://contoso.sharepoint.com/sites/SiteA/_layouts/15/download.aspx?UniqueId=${GUID}`)).toBe(`id:${HEX}`);
    expect(key(`https://contoso.sharepoint.com/:w:/r/sites/SiteA/Lib/Plan.docx?d=w${HEX}&csf=1&web=1`)).toBe(`id:${HEX}`);
    expect(documentKeyForUniqueId(GUID.toLowerCase())).toBe(`id:${HEX}`);
  });

  it('keys path links by host and decoded path, ignoring case and query parameters', () => {
    const expected = 'path:contoso.sharepoint.com/sites/sitea/lib/folder one/report.pdf';
    expect(key('https://contoso.sharepoint.com/sites/SiteA/Lib/Folder%20One/Report.pdf')).toBe(expected);
    expect(key('https://contoso.sharepoint.com/sites/SiteA/Lib/Folder%20One/Report.pdf?web=1')).toBe(expected);
    expect(key('https://CONTOSO.sharepoint.com/sites/SiteA/Lib/Folder%20One/Report.pdf')).toBe(expected);
  });

  it('falls back to the link for sharing tokens and failures', () => {
    const token = 'https://contoso.sharepoint.com/:b:/s/SiteA/EaBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789abc?e=Ab12Cd';
    expect(key(token)).toBe(`url:${token}`);
    expect(key('  not a link ')).toBe('url:not a link');
  });
});
