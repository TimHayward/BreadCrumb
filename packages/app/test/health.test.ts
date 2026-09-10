import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import { checkHealth } from '../src/routes/health.js';
import { redactLink } from '../src/logging.js';
import { createTestServer } from './helpers.js';

describe('GET /healthz (BC-047)', () => {
  it('returns 200 when the database is writable', async () => {
    const ctx = await createTestServer();
    const response = await ctx.app.inject({ method: 'GET', url: '/healthz' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok', database: ':memory:' });
    await ctx.app.close();
    ctx.db.close();
  });

  it('returns 503 naming the failed check when the database cannot take a write lock', async () => {
    const ctx = await createTestServer();
    ctx.db.close();
    const response = await ctx.app.inject({ method: 'GET', url: '/healthz' });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ status: 'error', failed: 'write-lock' });
    await ctx.app.close();
  });

  it('checks the file on disk is readable and writable', () => {
    const dir = mkdtempSync(join(tmpdir(), 'breadcrumb-health-'));
    const path = join(dir, 'nested', 'h.sqlite');
    const db = openDatabase(path);
    migrate(db);
    expect(checkHealth(db, path)).toEqual({ status: 'ok', database: path });
    expect(checkHealth(db, join(dir, 'missing.sqlite'))).toMatchObject({ status: 'error', failed: 'file-access' });
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('log redaction', () => {
  it('reduces a link to its host', () => {
    expect(redactLink('https://contoso.sharepoint.com/sites/SiteA/secret.pdf')).toBe('[redacted link on contoso.sharepoint.com]');
    expect(redactLink('not a url')).toBe('[redacted]');
  });
});
