/**
 * One structured log line per request (BC-047). Routes attach conversion
 * facts (form, state, input) to `request.breadcrumb`; the onResponse hook
 * emits them, with the link reduced to its host when redaction is on.
 */
import type { FastifyInstance } from 'fastify';
import type { AppConfig } from './config.js';

export interface RequestLogContext {
  form?: string;
  state?: string;
  reason?: string;
  input?: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    breadcrumb: RequestLogContext;
  }
}

export function redactLink(input: string): string {
  try {
    return `[redacted link on ${new URL(input).host}]`;
  } catch {
    return '[redacted]';
  }
}

export function registerRequestLogging(app: FastifyInstance, config: Pick<AppConfig, 'redactLinks'>): void {
  // Fastify asks reference-typed decorations to start as null and be assigned per request.
  app.decorateRequest('breadcrumb', null as unknown as RequestLogContext);
  app.addHook('onRequest', async (request) => {
    request.breadcrumb = {};
  });
  app.addHook('onResponse', async (request, reply) => {
    const ctx = request.breadcrumb ?? {};
    const line: Record<string, unknown> = {
      method: request.method,
      route: request.routeOptions.url ?? request.url,
      status: reply.statusCode,
      durationMs: Math.round(reply.elapsedTime * 10) / 10,
    };
    if (ctx.form !== undefined) line['form'] = ctx.form;
    if (ctx.state !== undefined) line['state'] = ctx.state;
    if (ctx.reason !== undefined) line['reason'] = ctx.reason;
    if (ctx.input !== undefined) line['input'] = config.redactLinks ? redactLink(ctx.input) : ctx.input;
    request.log.info(line, 'request');
  });
}
