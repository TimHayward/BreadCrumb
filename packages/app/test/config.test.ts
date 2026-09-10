import { describe, expect, it } from 'vitest';
import { ConfigError, DEFAULTS, loadConfig } from '../src/config.js';

const TENANT = '11111111-1111-4111-8111-111111111111';
const CLIENT = '22222222-2222-4222-8222-222222222222';

describe('loadConfig (BC-005)', () => {
  it('uses documented defaults and logs each one when nothing is set', () => {
    const lines: string[] = [];
    const config = loadConfig({}, (l) => lines.push(l));
    expect(config).toEqual(DEFAULTS);
    expect(lines).toEqual([
      'config: PORT not set, using "3000"',
      'config: DATABASE_PATH not set, using "./data/breadcrumb.sqlite"',
      'config: LOG_LEVEL not set, using "info"',
      'config: LOG_REDACT_LINKS not set, using "false"',
      'config: SHORTLINK_EXPANSION_ENABLED not set, using "false"',
      'config: SHORTLINK_TIMEOUT_MS not set, using "5000"',
      'config: AUTH_TENANT_ID and AUTH_CLIENT_ID not set, authenticated validation is not configured',
    ]);
  });

  it('reads every variable when set', () => {
    const lines: string[] = [];
    const config = loadConfig(
      {
        PORT: '8080',
        DATABASE_PATH: '/data/x.sqlite',
        LOG_LEVEL: 'DEBUG',
        LOG_REDACT_LINKS: 'true',
        SHORTLINK_EXPANSION_ENABLED: 'yes',
        SHORTLINK_TIMEOUT_MS: '2500',
        AUTH_TENANT_ID: TENANT.toUpperCase(),
        AUTH_CLIENT_ID: CLIENT,
        AUTH_SCOPES: 'Files.Read.All',
      },
      (l) => lines.push(l),
    );
    expect(config).toEqual({
      port: 8080,
      databasePath: '/data/x.sqlite',
      logLevel: 'debug',
      redactLinks: true,
      shortLinkExpansionEnabled: true,
      shortLinkTimeoutMs: 2500,
      auth: { tenantId: TENANT, clientId: CLIENT, scopes: ['Files.Read.All'] },
    });
    expect(lines).toEqual([]);
  });

  it('defaults the scopes when only the tenant and client are set (BC-036)', () => {
    const lines: string[] = [];
    const config = loadConfig({ AUTH_TENANT_ID: TENANT, AUTH_CLIENT_ID: CLIENT }, (l) => lines.push(l));
    expect(config.auth).toEqual({ tenantId: TENANT, clientId: CLIENT, scopes: ['Files.Read.All', 'Sites.Read.All'] });
    expect(lines).toContain('config: AUTH_SCOPES not set, using "Files.Read.All Sites.Read.All"');
  });

  it.each([
    ['PORT', 'abc'],
    ['PORT', '0'],
    ['PORT', '70000'],
    ['PORT', '80.5'],
    ['LOG_LEVEL', 'loud'],
    ['LOG_REDACT_LINKS', 'maybe'],
    ['SHORTLINK_EXPANSION_ENABLED', 'sometimes'],
    ['SHORTLINK_TIMEOUT_MS', '10'],
  ])('rejects malformed %s=%s with an error naming the variable', (name, value) => {
    expect(() => loadConfig({ [name]: value }, () => {})).toThrowError(ConfigError);
    try {
      loadConfig({ [name]: value }, () => {});
    } catch (error) {
      expect((error as ConfigError).variable).toBe(name);
      expect((error as ConfigError).message).toContain(name);
      expect((error as ConfigError).message).toContain(value);
    }
  });

  it('requires AUTH_TENANT_ID and AUTH_CLIENT_ID together and as GUIDs', () => {
    const variableOf = (env: Record<string, string>): string => {
      try {
        loadConfig(env, () => {});
      } catch (error) {
        return (error as ConfigError).variable;
      }
      return 'no error';
    };
    expect(variableOf({ AUTH_TENANT_ID: TENANT })).toBe('AUTH_CLIENT_ID');
    expect(variableOf({ AUTH_CLIENT_ID: CLIENT })).toBe('AUTH_TENANT_ID');
    expect(variableOf({ AUTH_TENANT_ID: 'contoso', AUTH_CLIENT_ID: CLIENT })).toBe('AUTH_TENANT_ID');
    expect(variableOf({ AUTH_TENANT_ID: TENANT, AUTH_CLIENT_ID: 'not-a-guid' })).toBe('AUTH_CLIENT_ID');
  });
});
