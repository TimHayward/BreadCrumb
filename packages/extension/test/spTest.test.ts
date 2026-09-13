import { describe, expect, it } from 'vitest';
import { encodeSharingUrl, plannedCalls, runSessionTest, tenantOrigins, type FetchLike } from '../src/spTest.js';

const GUID = '3F2A9C1E-7B4D-4E0A-9C6B-1D2E3F4A5B6C';
const DOC = `https://contoso.sharepoint.com/sites/SiteA/_layouts/15/Doc.aspx?sourcedoc=%7B${GUID}%7D&file=Plan.pptx&action=edit`;
const TOKEN = 'https://contoso.sharepoint.com/:b:/s/SiteA/EaBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789abc?e=Ab12Cd';
const ONEDRIVE = 'https://contoso-my.sharepoint.com/personal/user_contoso_onmicrosoft_com/Documents/Budget.xlsx';

describe('plannedCalls (spike S9)', () => {
  it('uses GetFileById on the link\'s own site for document id links, plus the v2.0 shares call', () => {
    const plan = plannedCalls(DOC);
    expect(plan).toMatchObject({ host: 'contoso.sharepoint.com', form: 'doc-aspx' });
    expect(plan.calls.map((c) => c.label)).toEqual(['SharePoint REST GetFileById', 'SharePoint REST library root', 'SharePoint v2.0 shares']);
    expect(plan.calls[0]?.url).toBe(`https://contoso.sharepoint.com/sites/SiteA/_api/web/GetFileById('${GUID}')?$select=ServerRelativeUrl,Name,UniqueId`);
    expect(plan.calls[1]?.url).toBe(`https://contoso.sharepoint.com/sites/SiteA/_api/web/GetFileById('${GUID}')/ListItemAllFields/ParentList/RootFolder?$select=ServerRelativeUrl`);
    expect(plan.calls[2]?.url).toBe(`https://contoso.sharepoint.com/_api/v2.0/shares/${encodeSharingUrl(DOC)}/driveItem?$select=id,name,webUrl,parentReference,sharepointIds`);
    expect(plan.calls[2]?.headers).toEqual({ accept: 'application/json', prefer: 'redeemSharingLink' });
  });

  it('uses only the shares call for sharing tokens and path links, on the link\'s host', () => {
    expect(plannedCalls(TOKEN).calls.map((c) => c.label)).toEqual(['SharePoint v2.0 shares']);
    expect(plannedCalls(ONEDRIVE).calls[0]?.url.startsWith('https://contoso-my.sharepoint.com/_api/v2.0/shares/u!')).toBe(true);
  });

  it('plans nothing off the global SharePoint cloud or for unparseable input', () => {
    expect(plannedCalls('https://contoso.sharepoint.us/sites/SiteA/Lib/x.pdf')).toMatchObject({ calls: [], note: 'not on a sharepoint.com host' });
    expect(plannedCalls('not a link').calls).toEqual([]);
  });
});

describe('runSessionTest', () => {
  it('sends the user\'s cookies, reports status, body, redirects and failures per call', async () => {
    const seen: RequestInit[] = [];
    const fetchImpl: FetchLike = async (url, init) => {
      seen.push(init);
      if (url.includes('GetFileById') && !url.includes('RootFolder')) {
        return new Response(JSON.stringify({ ServerRelativeUrl: '/sites/SiteA/Shared Documents/Plan.pptx', Name: 'Plan.pptx' }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.includes('RootFolder')) {
        return new Response('<html>Sign in</html>', { status: 403, headers: { 'content-type': 'text/html' } });
      }
      throw new TypeError('Failed to fetch');
    };
    let clock = 0;
    const [report] = await runSessionTest([DOC, '   '], { fetchImpl, hasPermission: async () => true, now: () => (clock += 5) });
    expect(seen.every((init) => init.credentials === 'include')).toBe(true);
    expect(report).toMatchObject({ link: DOC, form: 'doc-aspx', host: 'contoso.sharepoint.com', permission: 'granted' });
    expect(report?.calls.map((c) => [c.label, c.status, c.ok])).toEqual([
      ['SharePoint REST GetFileById', 200, true],
      ['SharePoint REST library root', 403, false],
      ['SharePoint v2.0 shares', null, false],
    ]);
    expect(report?.calls[0]?.body).toEqual({ ServerRelativeUrl: '/sites/SiteA/Shared Documents/Plan.pptx', Name: 'Plan.pptx' });
    expect(report?.calls[1]?.body).toBe('<html>Sign in</html>');
    expect(report?.calls[2]?.error).toBe('Failed to fetch');
  });

  it('records a missing host permission and caps the number of links', async () => {
    const reports = await runSessionTest(Array.from({ length: 12 }, () => TOKEN), {
      fetchImpl: async () => new Response('{}', { status: 200 }),
      hasPermission: async () => false,
    });
    expect(reports).toHaveLength(10);
    expect(reports[0]?.permission).toBe('missing');
  });
});

describe('tenantOrigins', () => {
  it('asks for the tenant\'s SharePoint and OneDrive hosts only', () => {
    expect(tenantOrigins('contoso')).toEqual(['https://contoso.sharepoint.com/*', 'https://contoso-my.sharepoint.com/*']);
    expect(tenantOrigins('https://Contoso-my.sharepoint.com/personal/x')).toEqual(['https://contoso.sharepoint.com/*', 'https://contoso-my.sharepoint.com/*']);
    expect(tenantOrigins('')).toBeUndefined();
    expect(tenantOrigins('*')).toBeUndefined();
  });
});
