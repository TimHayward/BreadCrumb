import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WORKED_EXAMPLE, WORKED_EXAMPLE_PATH, createTestServer, type TestContext } from './helpers.js';

describe('POST /api/convert (BC-024)', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestServer();
  });

  afterEach(async () => {
    await ctx.app.close();
    ctx.db.close();
  });

  it('returns the parser result and writes a history row with the given source', async () => {
    const response = await ctx.app.inject({ method: 'POST', url: '/api/convert', payload: { link: WORKED_EXAMPLE, source: 'extension' } });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { id: number; createdAt: string; result: { state: string; path: string } };
    expect(body.id).toBe(1);
    expect(body.result.state).toBe('Derived');
    expect(body.result.path).toBe(WORKED_EXAMPLE_PATH);

    const row = ctx.store.getById(1);
    expect(row?.source).toBe('extension');
    expect(row?.state).toBe('Derived');
  });

  it('returns 400 with the reason code for a parse failure and writes no row', async () => {
    const response = await ctx.app.inject({ method: 'POST', url: '/api/convert', payload: { link: 'https://www.example.com/x', source: 'web' } });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ ok: false, reason: 'not_microsoft_365', detail: { host: 'www.example.com' } });
    expect(ctx.store.count()).toBe(0);
  });

  it('returns 400 for a missing link or a bad source', async () => {
    const noLink = await ctx.app.inject({ method: 'POST', url: '/api/convert', payload: { source: 'web' } });
    expect(noLink.statusCode).toBe(400);
    expect(noLink.json()).toMatchObject({ reason: 'invalid_request' });

    const badSource = await ctx.app.inject({ method: 'POST', url: '/api/convert', payload: { link: WORKED_EXAMPLE, source: 'phone' } });
    expect(badSource.statusCode).toBe(400);
    expect(badSource.json()).toMatchObject({ reason: 'invalid_request' });
    expect(ctx.store.count()).toBe(0);
  });

  it('returns 400 JSON for malformed JSON', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/convert',
      headers: { 'content-type': 'application/json' },
      payload: '{"link": ',
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ reason: 'invalid_request' });
  });

  it('answers a cross-origin preflight from any origin (R4: no access control in v1)', async () => {
    const response = await ctx.app.inject({
      method: 'OPTIONS',
      url: '/api/convert',
      headers: {
        origin: 'chrome-extension://abcdefghijklmnop',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
      },
    });
    expect(response.statusCode).toBeLessThan(300);
    expect(response.headers['access-control-allow-origin']).toBe('chrome-extension://abcdefghijklmnop');
    expect(String(response.headers['access-control-allow-methods'])).toContain('POST');
  });
});
