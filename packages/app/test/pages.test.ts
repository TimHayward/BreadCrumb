import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FOLDER_LINK, WORKED_EXAMPLE, WORKED_EXAMPLE_PATH, createTestServer, type TestContext } from './helpers.js';

const WORKED_EXAMPLE_FOLDER_URL =
  'https://848.sharepoint.com/sites/848Technical/Projects/Projects%20WIP/Deloitte/Deloitte%20-%20Digital%20Development%20Environment';
const WORKED_EXAMPLE_FILE_URL = `${WORKED_EXAMPLE_FOLDER_URL}/SMR%20SIID%20029%20-%20Development%20Environment%20for%20Digital%20team.pdf`;

describe('pages', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestServer();
  });

  afterEach(async () => {
    await ctx.app.close();
    ctx.db.close();
  });

  const postConvert = (link: string) =>
    ctx.app.inject({
      method: 'POST',
      url: '/convert',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({ link }).toString(),
    });

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

    it('marks inferred components and names the rule', async () => {
      const response = await postConvert(
        'https://contoso.sharepoint.com/sites/SiteA/Lib/Forms/AllItems.aspx?id=%2Fsites%2FSiteA%2FArchive%2F2024%2FMinutes%2Edocx',
      );
      expect(response.body).toMatch(/class="badge badge-inferred"[^>]*>.*Inferred<\/span>/s);
      expect(response.body).toContain('<span class="marker-inferred">inferred</span>');
      expect(response.body).toContain('Library boundary inferred: first segment after site.');
    });

    it('shows a failure with the input retained and writes no row', async () => {
      const response = await postConvert('https://www.example.com/x');
      expect(response.statusCode).toBe(200);
      expect(response.body).toContain('role="alert"');
      expect(response.body).toContain('www.example.com is not a SharePoint or OneDrive host');
      expect(response.body).toContain('value="https://www.example.com/x"');
      expect(ctx.store.count()).toBe(0);
    });

    it('escapes user input', async () => {
      const response = await postConvert('<script>alert(1)</script>');
      expect(response.body).not.toContain('<script>alert(1)</script>');
      expect(response.body).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    });
  });

  describe('history pages (BC-031)', () => {
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
      expect(page1.body).toContain('Page 1 of 2 (51 entries)');
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

  it('serves static assets', async () => {
    expect((await ctx.app.inject({ method: 'GET', url: '/static/app.css' })).statusCode).toBe(200);
    expect((await ctx.app.inject({ method: 'GET', url: '/static/app.js' })).statusCode).toBe(200);
  });
});
