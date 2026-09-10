import { describe, expect, it } from 'vitest';
import { ConfigError, DEFAULTS, loadConfig } from '../src/config.js';

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
    });
    expect(lines).toEqual([]);
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
});
