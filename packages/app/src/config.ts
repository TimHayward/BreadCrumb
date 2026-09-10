/**
 * Configuration from environment variables only (BC-005, invariant 14).
 * Every variable has a documented default. A malformed value stops the
 * process at start with a message naming the variable.
 */

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

const LOG_LEVELS: readonly LogLevel[] = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];

export interface AppConfig {
  /** Port the process listens on. */
  port: number;
  /** SQLite database file, or `:memory:` for tests. */
  databasePath: string;
  logLevel: LogLevel;
  /** When true, request logs carry only the host of a submitted link. */
  redactLinks: boolean;
}

export const DEFAULTS: Readonly<AppConfig> = {
  port: 3000,
  databasePath: './data/breadcrumb.sqlite',
  logLevel: 'info',
  redactLinks: false,
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

function parsePort(raw: string): number {
  const port = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ConfigError('PORT', 'must be an integer between 1 and 65535', raw);
  }
  return port;
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

/**
 * Loads configuration. Logs one line for every default in use. Throws
 * ConfigError for the first malformed variable found.
 */
export function loadConfig(env: Env = process.env, log: (line: string) => void = console.log): AppConfig {
  return {
    port: read(env, 'PORT', DEFAULTS.port, parsePort, log),
    databasePath: read(env, 'DATABASE_PATH', DEFAULTS.databasePath, (raw) => raw, log),
    logLevel: read(env, 'LOG_LEVEL', DEFAULTS.logLevel, parseLogLevel, log),
    redactLinks: read(env, 'LOG_REDACT_LINKS', DEFAULTS.redactLinks, parseBoolean('LOG_REDACT_LINKS'), log),
  };
}
