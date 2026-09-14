import { describe, expect, it } from 'vitest';
import { openDatabase } from '../src/db/connection.js';
import { SqliteHistoryStore } from '../src/db/historyStore.js';
import { migrate } from '../src/db/migrate.js';
import { createConversionService } from '../src/services/conversionService.js';

function createStore(): SqliteHistoryStore {
  const db = openDatabase(':memory:');
  migrate(db);
  return new SqliteHistoryStore(db);
}

describe('conversion service', () => {
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

  it.each(['https://1drv.ms/x/s!AaBbCcDdEeFfGgHh', 'https://onedrive.live.com/?cid=A1B2C3D4E5F60718&resid=A1B2C3D4E5F60718%21123'])(
    'says a consumer OneDrive link is not supported and stores nothing: %s',
    async (link) => {
      const store = createStore();
      const outcome = await createConversionService(store).convert(link, 'web');
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.failure.reason).toBe('consumer_onedrive');
        expect(outcome.failure.message).toContain('personal (consumer) OneDrive link');
        expect(outcome.failure.message).toContain('not supported');
      }
      expect(store.count()).toBe(0);
    },
  );
});
