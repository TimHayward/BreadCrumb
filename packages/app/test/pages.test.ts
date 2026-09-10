import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  FOLDER_LINK,
  SAFELINKS_LINK,
  TOKEN_LINK,
  WORKED_EXAMPLE,
  WORKED_EXAMPLE_PATH,
  createTestServer,
  postForm,
  type TestContext,
} from './helpers.js';

const WORKED_EXAMPLE_FOLDER_URL =
  'https://848.sharepoint.com/sites/848Technical/Projects/Projects%20WIP/Deloitte/Deloitte%20-%20Digital%20Development%20Environment';
const WORKED_EXAMPLE_FILE_URL = `${WORKED_EXAMPLE_FOLDER_URL}/SMR%20SIID%20029%20-%20Development%20Environment%20for%20Digital%20team.pdf`;
const INFERRED_LINK = 'https://contoso.sharepoint.com/sites/SiteA/Lib/Forms/AllItems.aspx?id=%2Fsites%2FSiteA%2FArchive%2F2024%2FMinutes%2Edocx';

describe('pages', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestServer();
  });

  afterEach(async () => {
    await ctx.app.close();
    ctx.db.close();
  });

  const postConvert = (link: string, extra: Record<string, string> = {}) => postForm(ctx.app, '/convert', { link, ...extra });

  describe('conversion page (BC-023)', () => {
    it('serves the form', async () => {
      const response = await ctx.app.inject({ method: 'GET', url: '/' });
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/html');
      expect(response.body).toContain('<form method="post" action="/convert"');
      expect(response.body).toContain('name="link"');
    });

    it('renders the worked example with path, folder URL, file URL and a Derived badge', async () => {
      const response = await postConvert(WORKED_EXAMPLE);
      expect(response.statusCode).toBe(200);
      const body = response.body;
      expect(body).toContain(`<code>${WORKED_EXAMPLE_PATH}</code>`);
      expect(body).toContain(`href="${WORKED_EXAMPLE_FOLDER_URL}" target="_blank" rel="noopener noreferrer"`);
      expect(body).toContain(`href="${WORKED_EXAMPLE_FILE_URL}" target="_blank" rel="noopener noreferrer"`);
      expect(body).toContain(`data-copy="${WORKED_EXAMPLE_PATH}"`);
      expect(body).toMatch(/class="badge badge-derived"[^>]*>.*Derived<\/span>/s);
      expect(body).not.toContain('marker-inferred');
      expect(body).toContain('Saved to history as <a href="/history/1">');
      expect(ctx.store.count()).toBe(1);
    });

    it('renders no file URL row for a folder result (BC-019)', async () => {
      const response = await postConvert(FOLDER_LINK);
      expect(response.body).toContain('Folder URL');
      expect(response.body).not.toContain('File URL');
      expect(response.body).not.toContain('File name');
    });

    it('escapes user input', async () => {
      const response = await postConvert('<script>alert(1)</script>');
      expect(response.body).not.toContain('<script>alert(1)</script>');
      expect(response.body).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    });
  });

  describe('honest labelling (BC-025)', () => {
    it('Derived: says no guesswork and carries no inferred marker', async () => {
      const response = await postConvert(WORKED_EXAMPLE);
      expect(response.body).toContain('Library boundary taken from the page path.');
      expect(response.body).not.toContain('marker-inferred');
    });

    it('Inferred: names the inferred components and the rule', async () => {
      const response = await postConvert(INFERRED_LINK);
      expect(response.body).toMatch(/class="badge badge-inferred"[^>]*>.*Inferred<\/span>/s);
      expect(response.body).toContain('<span class="marker-inferred">inferred</span>');
      expect(response.body).toContain('Library boundary and folder chain inferred: first segment after site.');
    });

    it('Unresolved: says what was recognised, shows no path, and offers the pre-M3 next step (BC-026)', async () => {
      const response = await postConvert(TOKEN_LINK);
      expect(response.body).toMatch(/class="badge badge-unresolved"[^>]*>.*Unresolved<\/span>/s);
      expect(response.body).toContain('What was recognised:');
      expect(response.body).toContain('cannot be decoded without signing in');
      expect(response.body).not.toContain('<dt id="path-label">');
      expect(response.body).toContain('Authenticated validation is not configured on this server');
      expect(response.body).toContain('<strong>SiteA</strong>');
      expect(ctx.store.getById(1)?.state).toBe('Unresolved');
    });

    it('lists wrappers removed in order', async () => {
      const response = await postConvert(SAFELINKS_LINK);
      expect(response.body).toContain('Wrappers removed');
      expect(response.body).toContain('Outlook Safe Links');
    });
  });

  describe('failure presentation (BC-026)', () => {
    it('shows the reason with the input retained, writes no row, and offers to keep it', async () => {
      const response = await postConvert('https://www.example.com/x');
      expect(response.statusCode).toBe(200);
      expect(response.body).toContain('role="alert"');
      expect(response.body).toContain('www.example.com is not a SharePoint or OneDrive host');
      expect(response.body).toContain('value="https://www.example.com/x"');
      expect(response.body).toContain('Keep this in history anyway');
      expect(ctx.store.count()).toBe(0);
    });

    it('keeps the failure as a row with no state when asked, filterable as a failure', async () => {
      const response = await postConvert('https://www.example.com/x', { keep: '1' });
      expect(response.body).toContain('Kept in history as <a href="/history/1">');
      expect(response.body).not.toContain('Keep this in history anyway');
      const row = ctx.store.getById(1);
      expect(row?.state).toBeNull();
      expect(row?.failureReason).toBe('not_microsoft_365');
      const list = await ctx.app.inject({ method: 'GET', url: '/history?state=failed' });
      expect(list.body).toContain('1 entry match.');
      expect(list.body).toContain('failed: not_microsoft_365');
    });
  });

  describe('history list (BC-031)', () => {
    it('shows an empty state before any conversion', async () => {
      const response = await ctx.app.inject({ method: 'GET', url: '/history' });
      expect(response.statusCode).toBe(200);
      expect(response.body).toContain('No conversions yet');
    });

    it('lists rows newest first with time, input, path, state and source, and pages via the URL', async () => {
      for (let i = 0; i < 51; i++) {
        await postConvert(i === 50 ? FOLDER_LINK : WORKED_EXAMPLE);
      }
      const page1 = await ctx.app.inject({ method: 'GET', url: '/history' });
      expect(page1.body).toContain('51 entries.');
      expect(page1.body).toContain('Page 1 of 2');
      expect(page1.body).toContain('href="/history?page=2"');
      expect(page1.body.indexOf('/history/51')).toBeLessThan(page1.body.indexOf('/history/50'));
      expect(page1.body).toContain('<code>/teams/SiteB/Lib/Projects/Alpha</code>');
      expect(page1.body).toContain('<td>web</td>');

      const page2 = await ctx.app.inject({ method: 'GET', url: '/history?page=2' });
      expect(page2.body).toContain('Page 2 of 2');
      expect(page2.body).toContain('href="/history/1"');
      expect(page2.body).not.toContain('href="/history/2"');
      expect(page2.body).toContain('href="/history?page=1"');
    });

    it('shows a stored entry in the same result layout as the conversion page', async () => {
      const converted = await postConvert(WORKED_EXAMPLE);
      const detail = await ctx.app.inject({ method: 'GET', url: '/history/1' });
      expect(detail.statusCode).toBe(200);
      const sectionOf = (html: string): string => html.slice(html.indexOf('<section class="result"'), html.indexOf('</section>') + '</section>'.length);
      expect(sectionOf(detail.body)).toBe(sectionOf(converted.body));
      expect(detail.body).toContain('<dt>Source</dt><dd>web</dd>');
    });

    it('returns 404 for an unknown entry', async () => {
      const response = await ctx.app.inject({ method: 'GET', url: '/history/999' });
      expect(response.statusCode).toBe(404);
      expect(response.body).toContain('There is no history entry 999.');
      expect((await ctx.app.inject({ method: 'GET', url: '/history/abc' })).statusCode).toBe(404);
    });
  });

  describe('search and filters (BC-032, BC-033)', () => {
    beforeEach(async () => {
      await postConvert(WORKED_EXAMPLE);
      await postConvert(INFERRED_LINK);
      await postConvert(TOKEN_LINK);
      await ctx.app.inject({ method: 'POST', url: '/api/convert', payload: { link: FOLDER_LINK, source: 'extension' } });
    });

    it('searches case insensitively and shows state badges on matches', async () => {
      const response = await ctx.app.inject({ method: 'GET', url: '/history?q=deloitte' });
      expect(response.body).toContain('1 entry match.');
      expect(response.body).toContain('href="/history/1"');
      expect(response.body).not.toContain('href="/history/2"');
      expect(response.body).toMatch(/badge badge-derived/);
      expect(response.body).toContain('value="deloitte"');
    });

    it('says when nothing matches and offers to clear', async () => {
      const response = await ctx.app.inject({ method: 'GET', url: '/history?q=zzzz' });
      expect(response.body).toContain('No entries match this search.');
      expect(response.body).toContain('<a href="/history">Clear the search</a>');
    });

    it('filters by state, source and date and reflects the combination in the URL', async () => {
      const state = await ctx.app.inject({ method: 'GET', url: '/history?state=Unresolved' });
      expect(state.body).toContain('1 entry match.');
      expect(state.body).toContain('href="/history/3"');

      const source = await ctx.app.inject({ method: 'GET', url: '/history?source=extension' });
      expect(source.body).toContain('1 entry match.');
      expect(source.body).toContain('href="/history/4"');

      const combined = await ctx.app.inject({ method: 'GET', url: '/history?q=SiteA&state=Inferred&from=2000-01-01&to=2999-12-31' });
      expect(combined.body).toContain('1 entry match.');
      expect(combined.body).toContain('href="/history/2"');
      expect(combined.body).toContain('href="/history/export.csv?q=SiteA&amp;state=Inferred&amp;from=2000-01-01&amp;to=2999-12-31"');

      const none = await ctx.app.inject({ method: 'GET', url: '/history?from=2999-01-01' });
      expect(none.body).toContain('0 entries match.');
    });
  });

  describe('delete (BC-034)', () => {
    beforeEach(async () => {
      await postConvert(WORKED_EXAMPLE);
      await postConvert(INFERRED_LINK);
      await postConvert(TOKEN_LINK);
    });

    it('asks for confirmation once, then deletes and reports the count', async () => {
      const confirm = await postForm(ctx.app, '/history/delete', { ids: ['1', '3'], return: '/history?q=x' });
      expect(confirm.statusCode).toBe(200);
      expect(confirm.body).toContain('Delete 2 entries?');
      expect(confirm.body).toContain('name="confirm" value="1"');
      expect(ctx.store.count()).toBe(3);

      const done = await postForm(ctx.app, '/history/delete', { ids: ['1', '3'], confirm: '1', return: '/history?q=x' });
      expect(done.statusCode).toBe(303);
      expect(done.headers['location']).toBe('/history?q=x&deleted=2');
      expect(ctx.store.count()).toBe(1);
      expect(ctx.store.getById(2)).toBeDefined();

      const list = await ctx.app.inject({ method: 'GET', url: '/history?deleted=2' });
      expect(list.body).toContain('2 entries deleted.');
    });

    it('deletes a single entry from its detail page', async () => {
      const detail = await ctx.app.inject({ method: 'GET', url: '/history/2' });
      expect(detail.body).toContain('Delete this entry');
      const confirm = await postForm(ctx.app, '/history/delete', { ids: '2', return: '/history' });
      expect(confirm.body).toContain('Delete 1 entry?');
      const done = await postForm(ctx.app, '/history/delete', { ids: '2', confirm: '1', return: '/history' });
      expect(done.headers['location']).toBe('/history?deleted=1');
      expect((await ctx.app.inject({ method: 'GET', url: '/history/2' })).statusCode).toBe(404);
    });

    it('cancelling changes nothing and unsafe return targets fall back to /history', async () => {
      await postForm(ctx.app, '/history/delete', { ids: '1', return: 'https://evil.example/' });
      expect(ctx.store.count()).toBe(3);
      const done = await postForm(ctx.app, '/history/delete', { ids: '999', confirm: '1', return: 'https://evil.example/' });
      expect(done.headers['location']).toBe('/history?deleted=0');
    });
  });

  describe('export (BC-035)', () => {
    it('exports only the filtered rows as CSV and JSON with a dated file name', async () => {
      await postConvert(WORKED_EXAMPLE);
      await postConvert(INFERRED_LINK);
      const csv = await ctx.app.inject({ method: 'GET', url: '/history/export.csv?state=Inferred' });
      expect(csv.statusCode).toBe(200);
      expect(csv.headers['content-type']).toContain('text/csv');
      expect(csv.headers['content-disposition']).toMatch(/attachment; filename="breadcrumb-history-\d{4}-\d{2}-\d{2}\.csv"/);
      const lines = csv.body.trim().split('\r\n');
      expect(lines).toHaveLength(2);
      expect(lines[1]).toContain('/sites/SiteA/Archive/2024/Minutes.docx');

      const json = await ctx.app.inject({ method: 'GET', url: '/history/export.json' });
      expect(json.headers['content-disposition']).toMatch(/\.json"$/);
      const entries = json.json() as Array<{ id: number; result: { components: { library: { flag: string } } } }>;
      expect(entries.map((e) => e.id)).toEqual([2, 1]);
      expect(entries[1]?.result.components.library.flag).toBe('Derived');
    });
  });

  it('serves static assets', async () => {
    expect((await ctx.app.inject({ method: 'GET', url: '/static/app.css' })).statusCode).toBe(200);
    expect((await ctx.app.inject({ method: 'GET', url: '/static/app.js' })).statusCode).toBe(200);
  });
});
