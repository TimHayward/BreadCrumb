import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ValidationSubmission } from '../src/validation/types.js';
import { TOKEN_LINK, WORKED_EXAMPLE, createTestServer, postForm, type TestContext } from './helpers.js';

const INFERRED_LINK = 'https://contoso.sharepoint.com/sites/SiteA/Lib/Forms/AllItems.aspx?id=%2Fsites%2FSiteA%2FArchive%2F2024%2FMinutes%2Edocx';

const AUTH = { tenantId: '11111111-1111-4111-8111-111111111111', clientId: '22222222-2222-4222-8222-222222222222', scopes: ['Files.Read.All', 'Sites.Read.All'] };

function submission(previousState: ValidationSubmission['previousState'], overrides: Partial<ValidationSubmission['verified']> = {}): ValidationSubmission {
  return {
    previousState,
    verified: {
      path: '/sites/SiteA/Archive/2024/Minutes.docx',
      folderUrl: 'https://contoso.sharepoint.com/sites/SiteA/Archive/2024',
      fileUrl: 'https://contoso.sharepoint.com/sites/SiteA/Archive/2024/Minutes.docx',
      components: { tenant: 'contoso', host: 'contoso.sharepoint.com', sitePath: '/sites/SiteA/Archive', library: '2024', folders: [], fileName: 'Minutes.docx' },
      corrections: { library: { was: 'Archive', now: '2024' }, sitePath: { was: '/sites/SiteA', now: '/sites/SiteA/Archive' }, folders: { was: '2024', now: '' } },
      graph: { siteId: 'site-id', driveId: 'b!arch', itemId: '01MIN', listItemUniqueId: '3f2a9c1e-7b4d-4e0a-9c6b-1d2e3f4a5b6c' },
      validatedAt: '2026-09-10T18:00:00.000Z',
      calls: ['/sites/contoso.sharepoint.com:/sites/SiteA', '/sites/site-id/drives', '/drives/b!arch/root:/Minutes.docx'],
      methodText: 'Confirmed by Microsoft Graph: the site was resolved by path, its document libraries were listed and "2024" contains the path, and the file was fetched by path within that library.',
      ...overrides,
    },
  };
}

describe('sign in control (BC-036)', () => {
  it('is absent and nothing else changes when auth is not configured', async () => {
    const ctx = await createTestServer();
    const page = await ctx.app.inject({ method: 'GET', url: '/' });
    expect(page.body).not.toContain('id="auth"');
    expect(page.body).not.toContain('validate.js');
    expect(page.body).not.toContain('data-auth-tenant');
    const converted = await postForm(ctx.app, '/convert', { link: WORKED_EXAMPLE });
    expect(converted.body).not.toContain('class="validate"');
    await ctx.app.close();
    ctx.db.close();
  });

  it('renders the control, the browser configuration and hidden validate blocks when configured', async () => {
    const ctx = await createTestServer({ config: { auth: AUTH } });
    const converted = await postForm(ctx.app, '/convert', { link: INFERRED_LINK });
    expect(converted.body).toContain('id="auth"');
    expect(converted.body).toContain(`data-auth-tenant="${AUTH.tenantId}" data-auth-client="${AUTH.clientId}" data-auth-scopes="Files.Read.All Sites.Read.All"`);
    expect(converted.body).toContain('<script src="/static/validate.js" type="module">');
    expect(converted.body).toContain('<div class="validate" data-validate-id="1" data-previous-state="Inferred" hidden>');
    expect(converted.body).toContain('Validate with Microsoft Graph');
    const unresolved = await postForm(ctx.app, '/convert', { link: TOKEN_LINK });
    expect(unresolved.body).toContain('sharing links resolve automatically once you are signed in');
    expect(unresolved.body).toContain('<div class="validate" data-validate-id="2" data-previous-state="Unresolved" data-auto="1" hidden>');
    const history = await ctx.app.inject({ method: 'GET', url: '/history' });
    expect(history.body).toContain('<div id="validate-all" class="validate-all" hidden>');
    await ctx.app.close();
    ctx.db.close();
  });

  it('marks only token sharing links for automatic validation', async () => {
    const ctx = await createTestServer({ config: { auth: AUTH } });
    const doc = await postForm(ctx.app, '/convert', {
      link: 'https://contoso.sharepoint.com/sites/SiteA/_layouts/15/Doc.aspx?sourcedoc=%7B3f2a9c1e-7b4d-4e0a-9c6b-1d2e3f4a5b6c%7D&file=Plan.docx',
    });
    expect(doc.body).toContain('data-previous-state="Unresolved" hidden>');
    expect(doc.body).not.toContain('data-auto');
    const unconfigured = await createTestServer();
    const plain = await postForm(unconfigured.app, '/convert', { link: TOKEN_LINK });
    expect(plain.body).not.toContain('data-auto');
    expect((await unconfigured.app.inject({ method: 'GET', url: '/history' })).body).not.toContain('validate-all');
    await ctx.app.close();
    ctx.db.close();
    await unconfigured.app.close();
    unconfigured.db.close();
  });
});

describe('GET /api/history/validatable (BC-038 validate all)', () => {
  it('lists Unresolved entries the browser can resolve, newest first, skipping validated rows and doc ids', async () => {
    const ctx = await createTestServer({ config: { auth: AUTH } });
    await postForm(ctx.app, '/convert', { link: TOKEN_LINK });
    await ctx.app.inject({ method: 'POST', url: '/api/convert', payload: { link: 'https://contoso.sharepoint.com/:f:/t/SiteA/EaBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789abc?e=Ab12Cd', source: 'extension' } });
    await postForm(ctx.app, '/convert', { link: 'https://contoso.sharepoint.com/sites/SiteA/_layouts/15/Doc.aspx?sourcedoc=%7B3f2a9c1e-7b4d-4e0a-9c6b-1d2e3f4a5b6c%7D' });
    await postForm(ctx.app, '/convert', { link: INFERRED_LINK });
    await ctx.app.inject({
      method: 'POST',
      url: '/api/history/2/validate',
      payload: submission('Unresolved', { path: '/sites/SiteA/Lib/Folder', folderUrl: 'https://contoso.sharepoint.com/sites/SiteA/Lib/Folder', components: { tenant: 'contoso', host: 'contoso.sharepoint.com', sitePath: '/sites/SiteA', library: 'Lib', folders: ['Folder'] }, corrections: {} }),
    });
    const response = await ctx.app.inject({ method: 'GET', url: '/api/history/validatable' });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { entries: Array<{ id: number; previousState: string; result: { form: string } }> };
    expect(body.entries.map((e) => e.id)).toEqual([1]);
    expect(body.entries[0]).toMatchObject({ previousState: 'Unresolved', result: { form: 'sharing-token/s' } });
    const limited = await ctx.app.inject({ method: 'GET', url: '/api/history/validatable?limit=0' });
    expect((limited.json() as { entries: unknown[] }).entries).toHaveLength(1);
    await ctx.app.close();
    ctx.db.close();
  });
});

describe('POST /api/history/:id/validate (BC-037, BC-040)', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestServer({ config: { auth: AUTH } });
    await postForm(ctx.app, '/convert', { link: INFERRED_LINK });
    await postForm(ctx.app, '/convert', { link: WORKED_EXAMPLE });
    await postForm(ctx.app, '/convert', { link: 'nope', keep: '1' });
  });

  afterEach(async () => {
    await ctx.app.close();
    ctx.db.close();
  });

  it('records the upgrade, keeps the original, and renders Verified with "was inferred as"', async () => {
    const response = await ctx.app.inject({ method: 'POST', url: '/api/history/1/validate', payload: submission('Inferred') });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ok: true, id: 1, validation: { previousState: 'Inferred' } });

    const row = ctx.store.getById(1);
    expect(row?.state).toBe('Inferred');
    expect(row?.validation?.previousState).toBe('Inferred');
    expect(row?.validation?.verified.graph.itemId).toBe('01MIN');
    expect(row?.result.ok && row.result.components.library?.value).toBe('Archive');

    const detail = await ctx.app.inject({ method: 'GET', url: '/history/1?validated=1' });
    expect(detail.body).toMatch(/class="badge badge-verified"[^>]*>.*Verified<\/span>/s);
    expect(detail.body).toContain('upgraded from Inferred');
    expect(detail.body).toContain('<code>2024</code> <span class="marker-confirmed">confirmed</span><div class="was">was inferred as <code>Archive</code></div>');
    expect(detail.body).toContain('Original best effort result (Inferred)');
    expect(detail.body).toContain('Confirmed by Microsoft Graph: the site was resolved by path');
    expect(detail.body).toContain('Confirmed at <time datetime="2026-09-10T18:00:00.000Z">2026-09-10 18:00 UTC</time>');
    expect(detail.body).toContain('Validated with Microsoft Graph.');
    expect(detail.body).not.toContain('class="validate"');
  });

  it('shows the upgraded marker in the list and supports the upgraded and Verified filters', async () => {
    await ctx.app.inject({ method: 'POST', url: '/api/history/1/validate', payload: submission('Inferred') });
    const list = await ctx.app.inject({ method: 'GET', url: '/history' });
    expect(list.body).toContain('<span class="marker-upgraded">upgraded from Inferred</span>');
    expect(list.body).toContain('<code>/sites/SiteA/Archive/2024/Minutes.docx</code>');
    expect((list.body.match(/marker-upgraded/g) ?? []).length).toBe(1);

    const upgraded = await ctx.app.inject({ method: 'GET', url: '/history?state=upgraded' });
    expect(upgraded.body).toContain('1 entry match.');
    expect(upgraded.body).toContain('href="/history/1"');

    const verified = await ctx.app.inject({ method: 'GET', url: '/history?state=Verified' });
    expect(verified.body).toContain('1 entry match.');

    const inferred = await ctx.app.inject({ method: 'GET', url: '/history?state=Inferred' });
    expect(inferred.body).toContain('0 entries match.');

    const csv = await ctx.app.inject({ method: 'GET', url: '/history/export.csv?state=upgraded' });
    expect(csv.body).toContain(',Verified,');
    expect(csv.body).toContain('/sites/SiteA/Archive/2024/Minutes.docx');
    const json = await ctx.app.inject({ method: 'GET', url: '/history/export.json?state=upgraded' });
    expect((json.json() as Array<{ state: string; validation: { previousState: string } | null }>)[0]).toMatchObject({ state: 'Verified', validation: { previousState: 'Inferred' } });
  });

  it('search finds the verified path', async () => {
    await ctx.app.inject({ method: 'POST', url: '/api/history/1/validate', payload: submission('Inferred') });
    const list = await ctx.app.inject({ method: 'GET', url: '/history?q=Archive%2F2024%2FMinutes' });
    expect(list.body).toContain('1 entry match.');
  });

  it('rejects unknown entries, failures, state mismatches and malformed payloads', async () => {
    expect((await ctx.app.inject({ method: 'POST', url: '/api/history/99/validate', payload: submission('Inferred') })).statusCode).toBe(404);
    expect((await ctx.app.inject({ method: 'POST', url: '/api/history/3/validate', payload: submission('Inferred') })).statusCode).toBe(409);
    expect((await ctx.app.inject({ method: 'POST', url: '/api/history/1/validate', payload: submission('Derived') })).statusCode).toBe(409);
    const bad = await ctx.app.inject({ method: 'POST', url: '/api/history/1/validate', payload: { previousState: 'Inferred', verified: { path: '' } } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toMatchObject({ reason: 'invalid_request' });
    const badUrl = await ctx.app.inject({ method: 'POST', url: '/api/history/1/validate', payload: submission('Inferred', { folderUrl: 'javascript:alert(1)' }) });
    expect(badUrl.statusCode).toBe(400);
    expect(ctx.store.getById(1)?.validation).toBeNull();
  });

  it('a Derived entry that is validated is Verified but not "upgraded" in the filter', async () => {
    const derived = submission('Derived', {
      path: '/sites/848Technical/Projects/Projects WIP/Deloitte/Deloitte - Digital Development Environment/SMR SIID 029 - Development Environment for Digital team.pdf',
      folderUrl: 'https://848.sharepoint.com/sites/848Technical/Projects/Projects%20WIP/Deloitte/Deloitte%20-%20Digital%20Development%20Environment',
      components: { tenant: '848', host: '848.sharepoint.com', sitePath: '/sites/848Technical', library: 'Projects', folders: ['Projects WIP', 'Deloitte', 'Deloitte - Digital Development Environment'], fileName: 'SMR SIID 029 - Development Environment for Digital team.pdf' },
      corrections: {},
    });
    expect((await ctx.app.inject({ method: 'POST', url: '/api/history/2/validate', payload: derived })).statusCode).toBe(200);
    expect((await ctx.app.inject({ method: 'GET', url: '/history?state=upgraded' })).body).toContain('0 entries match.');
    expect((await ctx.app.inject({ method: 'GET', url: '/history?state=Verified' })).body).toContain('1 entry match.');
    const detail = await ctx.app.inject({ method: 'GET', url: '/history/2' });
    expect(detail.body).toContain('upgraded from Derived');
    expect(detail.body).not.toContain('class="was"');
  });
});
