/**
 * HTTPS serving (decision D6). The certificate is generated at test time with
 * openssl (present on CI runners and in Git for Windows), so no key is ever
 * committed; the test is skipped where openssl is unavailable.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { get } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULTS } from '../src/config.js';
import { openDatabase } from '../src/db/connection.js';
import { SqliteHistoryStore } from '../src/db/historyStore.js';
import { migrate } from '../src/db/migrate.js';
import { buildServer } from '../src/server.js';

function hasOpenssl(): boolean {
  try {
    execFileSync('openssl', ['version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const dir = mkdtempSync(join(tmpdir(), 'breadcrumb-tls-'));
const available = hasOpenssl();

describe.skipIf(!available)('HTTPS server (D6)', () => {
  let cert: Buffer;
  let key: Buffer;

  beforeAll(() => {
    execFileSync(
      'openssl',
      ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem'), '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'],
      { stdio: 'ignore', env: { ...process.env, MSYS_NO_PATHCONV: '1' } },
    );
    cert = readFileSync(join(dir, 'cert.pem'));
    key = readFileSync(join(dir, 'key.pem'));
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('answers /healthz over HTTPS with the supplied certificate', async () => {
    const db = openDatabase(':memory:');
    migrate(db);
    const app = await buildServer({ config: { ...DEFAULTS, databasePath: ':memory:' }, db, store: new SqliteHistoryStore(db), logger: false, https: { cert, key } });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;

    const { status, body } = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      get({ host: '127.0.0.1', port, path: '/healthz', ca: cert, servername: 'localhost' }, (response) => {
        let text = '';
        response.on('data', (chunk: Buffer) => (text += chunk.toString()));
        response.on('end', () => resolve({ status: response.statusCode ?? 0, body: text }));
      }).on('error', reject);
    });
    expect(status).toBe(200);
    expect(JSON.parse(body)).toMatchObject({ status: 'ok' });
    await app.close();
    db.close();
  });
});
