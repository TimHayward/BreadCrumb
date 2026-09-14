import { parseLink } from '@breadcrumb/parser';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../src/db/connection.js';
import { SqliteHistoryStore } from '../src/db/historyStore.js';
import { migrate } from '../src/db/migrate.js';
import type { ValidationSubmission } from '@breadcrumb/validation';
import { TOKEN_LINK, createTestServer, type TestContext } from './helpers.js';

const GUID = '3F2A9C1E-7B4D-4E0A-9C6B-1D2E3F4A5B6C';
const DOC_EDIT = `https://contoso.sharepoint.com/sites/SiteA/_layouts/15/Doc.aspx?sourcedoc=%7B${GUID}%7D&file=Plan.pptx&action=edit&mobileredirect=true`;
const DOC_DEFAULT = `https://contoso.sharepoint.com/sites/SiteA/_layouts/15/Doc.aspx?sourcedoc=%7B${GUID}%7D&file=Plan.pptx&action=default`;
const DIRECT = 'https://contoso.sharepoint.com/sites/SiteA/Lib/Folder%20One/Report.pdf';

function verification(previousState: ValidationSubmission['previousState'], uniqueId = GUID.toLowerCase()): ValidationSubmission {
  return {
    previousState,
    verified: {
      path: '/sites/SiteA/Shared Documents/Plans/Plan.pptx',
      folderUrl: 'https://contoso.sharepoint.com/sites/SiteA/Shared%20Documents/Plans',
      fileUrl: 'https://contoso.sharepoint.com/sites/SiteA/Shared%20Documents/Plans/Plan.pptx',
      components: { tenant: 'contoso', host: 'contoso.sharepoint.com', sitePath: '/sites/SiteA', library: 'Shared Documents', folders: ['Plans'], fileName: 'Plan.pptx' },
      corrections: {},
      graph: { driveId: 'b!docs', itemId: '01PLAN', listItemUniqueId: uniqueId },
      validatedAt: '2026-09-12T10:00:00.000Z',
      calls: ['/shares/u!…/driveItem'],
      methodText: 'Confirmed by Microsoft Graph.',
    },
  };
}

describe('document keys (migration 3)', () => {
  it('stores the key on insert and backfills rows stored before the migration', () => {
    const db = openDatabase(':memory:');
    migrate(db);
    const store = new SqliteHistoryStore(db);
    store.insert({ source: 'web', input: DOC_EDIT, result: parseLink(DOC_EDIT) });
    const stored = db.prepare('SELECT doc_key FROM conversions WHERE id = 1').get() as { doc_key: string };
    expect(stored.doc_key).toBe('id:3f2a9c1e7b4d4e0a9c6b1d2e3f4a5b6c');

    db.exec('UPDATE conversions SET doc_key = NULL');
    store.insert({ source: 'web', input: DIRECT, result: parseLink(DIRECT) });
    expect(store.backfillDocumentKeys()).toBe(1);
    expect(store.backfillDocumentKeys()).toBe(0);
    const keys = (db.prepare('SELECT doc_key FROM conversions ORDER BY id').all() as Array<{ doc_key: string }>).map((r) => r.doc_key);
    expect(keys).toEqual(['id:3f2a9c1e7b4d4e0a9c6b1d2e3f4a5b6c', 'path:contoso.sharepoint.com/sites/sitea/lib/folder one/report.pdf']);
    db.close();
  });
});

describe('POST /api/lookup (extension popup)', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestServer();
  });

  afterEach(async () => {
    await ctx.app.close();
    ctx.db.close();
  });

  const convert = (link: string) => ctx.app.inject({ method: 'POST', url: '/api/convert', payload: { link, source: 'extension' } });
  const lookup = (links: unknown) => ctx.app.inject({ method: 'POST', url: '/api/lookup', payload: { links } });

  it('answers found or not per link, matching another link form of the same document', async () => {
    await convert(DOC_EDIT);
    await convert(DIRECT);
    const response = await lookup([DOC_DEFAULT, `${DIRECT}?web=1`, 'https://contoso.sharepoint.com/sites/SiteA/Lib/Unknown.pdf']);
    expect(response.statusCode).toBe(200);
    const { answers } = response.json() as { answers: Array<Record<string, unknown>> };
    expect(answers[0]).toMatchObject({ link: DOC_DEFAULT, found: true, id: 1, state: 'Unresolved', verified: false, path: null, fileName: 'Plan.pptx' });
    expect(answers[1]).toMatchObject({ found: true, id: 2, state: 'Inferred', verified: false, path: '/sites/SiteA/Lib/Folder One/Report.pdf' });
    expect(answers[2]).toEqual({ link: 'https://contoso.sharepoint.com/sites/SiteA/Lib/Unknown.pdf', found: false });
  });

  it('prefers the verified entry and returns the confirmed path and folder', async () => {
    await convert(DOC_EDIT);
    await convert(DOC_EDIT);
    await ctx.app.inject({ method: 'POST', url: '/api/history/1/validate', payload: verification('Unresolved') });
    const { answers } = (await lookup([DOC_DEFAULT])).json() as { answers: Array<Record<string, unknown>> };
    expect(answers[0]).toMatchObject({
      found: true,
      id: 1,
      state: 'Verified',
      verified: true,
      path: '/sites/SiteA/Shared Documents/Plans/Plan.pptx',
      folderUrl: 'https://contoso.sharepoint.com/sites/SiteA/Shared%20Documents/Plans',
      fileName: 'Plan.pptx',
    });
  });

  it('answers a Doc.aspx citation from a sharing-token entry verified to the same file', async () => {
    await convert(TOKEN_LINK);
    await ctx.app.inject({ method: 'POST', url: '/api/history/1/validate', payload: verification('Unresolved', `{${GUID}}`) });
    const { answers } = (await lookup([DOC_EDIT])).json() as { answers: Array<Record<string, unknown>> };
    expect(answers[0]).toMatchObject({ found: true, id: 1, state: 'Verified', verified: true });
  });

  it('rejects bad bodies and more than 50 links', async () => {
    expect((await lookup('nope')).statusCode).toBe(400);
    expect((await lookup([''])).statusCode).toBe(400);
    expect((await lookup(Array.from({ length: 51 }, (_, i) => `${DIRECT}?i=${i}`))).statusCode).toBe(400);
    expect((await lookup([])).json()).toEqual({ answers: [] });
  });
});
