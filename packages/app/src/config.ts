/**
 * Configuration from environment variables only (BC-005, invariant 14).
 * Every variable has a documented default. A malformed value stops the
 * process at start with a message naming the variable.
 */

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

const LOG_LEVELS: readonly LogLevel[] = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];

/** Microsoft sign in for authenticated validation (BC-036). Absent when not configured. */
export interface AuthConfig {
  tenantId: string;
  clientId: string;
  /** Delegated Graph scopes requested at sign in. */
  scopes: string[];
}

export interface AppConfig {
  /** Port the process listens on. */
  port: number;
  /** SQLite database file, or `:memory:` for tests. */
  databasePath: string;
  logLevel: LogLevel;
  /** When true, request logs carry only the host of a submitted link. */
  redactLinks: boolean;
  /** Whether the server may fetch 1drv.ms short links to expand them (BC-027). */
  shortLinkExpansionEnabled: boolean;
  /** Timeout for one short link expansion request, in milliseconds. */
  shortLinkTimeoutMs: number;
  /** Set only when both AUTH_TENANT_ID and AUTH_CLIENT_ID are present. */
  auth?: AuthConfig;
}

export const DEFAULT_AUTH_SCOPES = 'Files.Read.All Sites.Read.All';

export const DEFAULTS: Readonly<Omit<AppConfig, 'auth'>> = {
  port: 3000,
  databasePath: './data/breadcrumb.sqlite',
  logLevel: 'info',
  redactLinks: false,
  shortLinkExpansionEnabled: false,
  shortLinkTimeoutMs: 5000,
};

export class ConfigError extends Error {
  readonly variable: string;

  constructor(variable: string, problem: string, got: string) {
    super(`Configuration error: ${variable} ${problem} (got "${got}")`);
    this.name = 'ConfigError';
    this.variable = variable;
  }
}

type Env = Record<string, string | undefined>;

function read<T>(env: Env, name: string, fallback: T, parse: (raw: string) => T, log: (line: string) => void): T {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') {
    log(`config: ${name} not set, using "${String(fallback)}"`);
    return fallback;
  }
  return parse(raw.trim());
}

function parseInteger(name: string, min: number, max: number): (raw: string) => number {
  return (raw) => {
    const value = Number(raw);
    if (!/^\d+$/.test(raw) || !Number.isInteger(value) || value < min || value > max) {
      throw new ConfigError(name, `must be an integer between ${min} and ${max}`, raw);
    }
    return value;
  };
}

function parseLogLevel(raw: string): LogLevel {
  const level = raw.toLowerCase();
  if (!(LOG_LEVELS as readonly string[]).includes(level)) {
    throw new ConfigError('LOG_LEVEL', `must be one of ${LOG_LEVELS.join(', ')}`, raw);
  }
  return level as LogLevel;
}

function parseBoolean(name: string): (raw: string) => boolean {
  return (raw) => {
    const v = raw.toLowerCase();
    if (v === 'true' || v === '1' || v === 'yes') {
      return true;
    }
    if (v === 'false' || v === '0' || v === 'no') {
      return false;
    }
    throw new ConfigError(name, 'must be true or false', raw);
  };
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseGuid(name: string): (raw: string) => string {
  return (raw) => {
    if (!GUID.test(raw)) {
      throw new ConfigError(name, 'must be a GUID such as 00000000-0000-0000-0000-000000000000', raw);
    }
    return raw.toLowerCase();
  };
}

function parseAuth(env: Env, log: (line: string) => void): AuthConfig | undefined {
  const tenant = env['AUTH_TENANT_ID']?.trim() ?? '';
  const client = env['AUTH_CLIENT_ID']?.trim() ?? '';
  if (tenant === '' && client === '') {
    log('config: AUTH_TENANT_ID and AUTH_CLIENT_ID not set, authenticated validation is not configured');
    return undefined;
  }
  if (tenant === '') {
    throw new ConfigError('AUTH_TENANT_ID', 'must be set when AUTH_CLIENT_ID is set', '');
  }
  if (client === '') {
    throw new ConfigError('AUTH_CLIENT_ID', 'must be set when AUTH_TENANT_ID is set', '');
  }
  const scopes = read(env, 'AUTH_SCOPES', DEFAULT_AUTH_SCOPES, (raw) => raw, log)
    .split(/[\s,]+/)
    .filter((s) => s !== '');
  return { tenantId: parseGuid('AUTH_TENANT_ID')(tenant), clientId: parseGuid('AUTH_CLIENT_ID')(client), scopes };
}

/**
 * Loads configuration. Logs one line for every default in use. Throws
 * ConfigError for the first malformed variable found.
 */
export function loadConfig(env: Env = process.env, log: (line: string) => void = console.log): AppConfig {
  const config: AppConfig = {
    port: read(env, 'PORT', DEFAULTS.port, parseInteger('PORT', 1, 65535), log),
    databasePath: read(env, 'DATABASE_PATH', DEFAULTS.databasePath, (raw) => raw, log),
    logLevel: read(env, 'LOG_LEVEL', DEFAULTS.logLevel, parseLogLevel, log),
    redactLinks: read(env, 'LOG_REDACT_LINKS', DEFAULTS.redactLinks, parseBoolean('LOG_REDACT_LINKS'), log),
    shortLinkExpansionEnabled: read(
      env,
      'SHORTLINK_EXPANSION_ENABLED',
      DEFAULTS.shortLinkExpansionEnabled,
      parseBoolean('SHORTLINK_EXPANSION_ENABLED'),
      log,
    ),
    shortLinkTimeoutMs: read(env, 'SHORTLINK_TIMEOUT_MS', DEFAULTS.shortLinkTimeoutMs, parseInteger('SHORTLINK_TIMEOUT_MS', 100, 60000), log),
  };
  const auth = parseAuth(env, log);
  if (auth !== undefined) {
    config.auth = auth;
  }
  return config;
}
