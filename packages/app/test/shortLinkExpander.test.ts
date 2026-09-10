import { describe, expect, it } from 'vitest';
import { openDatabase } from '../src/db/connection.js';
import { SqliteHistoryStore } from '../src/db/historyStore.js';
import { migrate } from '../src/db/migrate.js';
import { createConversionService } from '../src/services/conversionService.js';
import { createShortLinkExpander, type FetchLike } from '../src/services/shortLinkExpander.js';

const SHORT = 'https://1drv.ms/x/s!AaBbCcDdEeFfGgHh';

function fakeFetch(routes: Record<string, { status: number; location?: string } | Error>): { fetch: FetchLike; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    fetch: async (url) => {
      calls.push(url);
      const route = routes[url];
      if (route === undefined) {
        throw new Error(`unexpected fetch of ${url}`);
      }
      if (route instanceof Error) {
        throw route;
      }
      return new Response(null, { status: route.status, headers: route.location === undefined ? {} : { location: route.location } });
    },
  };
}

function createStore(): SqliteHistoryStore {
  const db = openDatabase(':memory:');
  migrate(db);
  return new SqliteHistoryStore(db);
}

describe('short link expansion (BC-027)', () => {
  it('follows redirects on the allow list and stops at the first host off it without fetching it', async () => {
    const { fetch, calls } = fakeFetch({
      [SHORT]: { status: 301, location: 'https://1drv.ms/redir/second' },
      'https://1drv.ms/redir/second': { status: 302, location: 'https://onedrive.live.com/?cid=A1B2C3D4E5F60718&resid=A1B2C3D4E5F60718%21123' },
    });
    const expander = createShortLinkExpander({ enabled: true, timeoutMs: 1000, maxHops: 5 }, fetch);
    const result = await expander.expand(SHORT);
    expect(result).toEqual({ ok: true, finalUrl: 'https://onedrive.live.com/?cid=A1B2C3D4E5F60718&resid=A1B2C3D4E5F60718%21123', hops: 2 });
    expect(calls).toEqual([SHORT, 'https://1drv.ms/redir/second']);
  });

  it('never fetches a host outside the allow list', async () => {
    const { fetch, calls } = fakeFetch({});
    const expander = createShortLinkExpander({ enabled: true, timeoutMs: 1000, maxHops: 5 }, fetch);
    const token = await expander.expand('https://contoso.sharepoint.com/:b:/s/SiteA/EaBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789abc');
    expect(token).toMatchObject({ ok: false, reason: 'not_allowed' });
    expect(calls).toEqual([]);
  });

  it('reports disabled, timeout, network, no redirect and too many hops', async () => {
    const disabled = createShortLinkExpander({ enabled: false, timeoutMs: 1000, maxHops: 5 }, fakeFetch({}).fetch);
    expect(await disabled.expand(SHORT)).toMatchObject({ ok: false, reason: 'disabled' });

    const timeoutError = new Error('aborted');
    timeoutError.name = 'TimeoutError';
    const timedOut = createShortLinkExpander({ enabled: true, timeoutMs: 1000, maxHops: 5 }, fakeFetch({ [SHORT]: timeoutError }).fetch);
    expect(await timedOut.expand(SHORT)).toMatchObject({ ok: false, reason: 'timeout' });

    const network = createShortLinkExpander({ enabled: true, timeoutMs: 1000, maxHops: 5 }, fakeFetch({ [SHORT]: new Error('ENOTFOUND') }).fetch);
    expect(await network.expand(SHORT)).toMatchObject({ ok: false, reason: 'network' });

    const noRedirect = createShortLinkExpander({ enabled: true, timeoutMs: 1000, maxHops: 5 }, fakeFetch({ [SHORT]: { status: 200 } }).fetch);
    expect(await noRedirect.expand(SHORT)).toMatchObject({ ok: false, reason: 'no_redirect' });

    const loop = createShortLinkExpander({ enabled: true, timeoutMs: 1000, maxHops: 3 }, fakeFetch({ [SHORT]: { status: 302, location: SHORT } }).fetch);
    expect(await loop.expand(SHORT)).toMatchObject({ ok: false, reason: 'too_many_redirects' });
  });
});

describe('conversion service with expansion', () => {
  it('records the short link as a wrapper and parses the target', async () => {
    const { fetch } = fakeFetch({ [SHORT]: { status: 301, location: 'https://onedrive.live.com/?cid=A1B2C3D4E5F60718&resid=A1B2C3D4E5F60718%21123' } });
    const service = createConversionService(createStore(), {
      expander: createShortLinkExpander({ enabled: true, timeoutMs: 1000, maxHops: 5 }, fetch),
    });
    const outcome = await service.convert(SHORT, 'web');
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.result.form).toBe('onedrive-consumer');
      expect(outcome.result.state).toBe('Unresolved');
      expect(outcome.result.wrappers).toEqual([{ type: 'shortlink', original: SHORT }]);
      expect(outcome.result.original).toBe(SHORT);
      expect(outcome.result.identifiers.map((i) => i.kind)).toEqual(['cid', 'resid']);
    }
  });

  it('fails cleanly naming the host when the target is not a Microsoft host', async () => {
    const { fetch } = fakeFetch({ [SHORT]: { status: 301, location: 'https://www.example.com/landing' } });
    const service = createConversionService(createStore(), {
      expander: createShortLinkExpander({ enabled: true, timeoutMs: 1000, maxHops: 5 }, fetch),
    });
    const outcome = await service.convert(SHORT, 'web');
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.failure).toMatchObject({ reason: 'not_microsoft_365', detail: { host: 'www.example.com' } });
    }
  });

  it('stays Unresolved with the reason and logs when expansion is disabled or fails', async () => {
    const warnings: string[] = [];
    const service = createConversionService(createStore(), {
      expander: createShortLinkExpander({ enabled: false, timeoutMs: 1000, maxHops: 5 }, fakeFetch({}).fetch),
      log: { warn: (_obj, msg) => warnings.push(msg) },
    });
    const outcome = await service.convert(SHORT, 'web');
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.result.state).toBe('Unresolved');
      expect(outcome.result.method.code).toBe('onedrive-shortlink/expansion-failed/disabled');
      expect(outcome.result.method.text).toContain('could not be expanded');
    }
    expect(warnings).toHaveLength(1);
  });

  it('keeps a failure in history only when asked', async () => {
    const store = createStore();
    const service = createConversionService(store);
    const dropped = await service.convert('not a link', 'web');
    expect(dropped.ok).toBe(false);
    expect(store.count()).toBe(0);
    const kept = await service.convert('not a link', 'web', { keepFailure: true });
    expect(kept.ok).toBe(false);
    if (!kept.ok) {
      expect(kept.id).toBe(1);
    }
    expect(store.getById(1)?.state).toBeNull();
    expect(store.getById(1)?.failureReason).toBe('not_a_url');
  });
});
