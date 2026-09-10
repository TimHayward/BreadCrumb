import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import cors from '@fastify/cors';
import formbody from '@fastify/formbody';
import fastifyStatic from '@fastify/static';
import Fastify, { LogController, type FastifyInstance } from 'fastify';
import type { AppConfig } from './config.js';
import type { Database } from './db/connection.js';
import type { HistoryStore } from './db/historyStore.js';
import { registerRequestLogging } from './logging.js';
import { registerApiRoutes } from './routes/api.js';
import { registerHealthRoute } from './routes/health.js';
import { registerPageRoutes } from './routes/pages.js';
import { createConversionService } from './services/conversionService.js';
import { DEFAULT_MAX_HOPS, createShortLinkExpander, type ShortLinkExpander } from './services/shortLinkExpander.js';

export interface ServerDeps {
  config: AppConfig;
  db: Database;
  store: HistoryStore;
  /** Pino logger options override, used by tests to silence output. */
  logger?: boolean | { level: string };
  /** Short link expander override, used by tests to avoid the network. */
  expander?: ShortLinkExpander;
}

/** `public/` next to `src/` in development, copied to `dist/public` in the build. */
export function resolvePublicDir(): string {
  for (const candidate of [new URL('./public/', import.meta.url), new URL('../public/', import.meta.url)]) {
    const dir = fileURLToPath(candidate);
    if (existsSync(dir)) {
      return dir;
    }
  }
  throw new Error('Static asset directory "public" not found');
}

export async function buildServer(deps: ServerDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: deps.logger ?? { level: deps.config.logLevel },
    // One line per request comes from registerRequestLogging, not Fastify's two default lines.
    logController: new LogController({ disableRequestLogging: true }),
    trustProxy: false,
  });

  registerRequestLogging(app, deps.config);

  // No access control in v1 (R4): any origin on the private network may call the API.
  await app.register(cors, { origin: true, methods: ['GET', 'POST', 'OPTIONS'] });
  await app.register(formbody);
  await app.register(fastifyStatic, { root: resolvePublicDir(), prefix: '/static/', cacheControl: true, maxAge: '1h' });

  const expander =
    deps.expander ??
    createShortLinkExpander({
      enabled: deps.config.shortLinkExpansionEnabled,
      timeoutMs: deps.config.shortLinkTimeoutMs,
      maxHops: DEFAULT_MAX_HOPS,
    });
  const service = createConversionService(deps.store, {
    expander,
    log: { warn: (obj, msg) => app.log.warn(obj, msg) },
  });
  registerHealthRoute(app, deps.db, deps.config.databasePath);
  registerApiRoutes(app, service);
  registerPageRoutes(app, service, deps.store);

  app.setErrorHandler((error: unknown, request, reply) => {
    const e = (typeof error === 'object' && error !== null ? error : {}) as { statusCode?: unknown; message?: unknown };
    const statusCode = typeof e.statusCode === 'number' && e.statusCode >= 400 ? e.statusCode : 500;
    if (statusCode >= 500) {
      request.log.error({ err: error }, 'unhandled error');
    }
    const message =
      statusCode >= 500
        ? 'Something went wrong on the server. The error has been logged.'
        : typeof e.message === 'string'
          ? e.message
          : 'Bad request.';
    if (request.url.startsWith('/api/')) {
      return reply.code(statusCode).send({ reason: statusCode >= 500 ? 'internal_error' : 'invalid_request', message });
    }
    return reply.code(statusCode).type('text/plain; charset=utf-8').send(message);
  });

  return app;
}
