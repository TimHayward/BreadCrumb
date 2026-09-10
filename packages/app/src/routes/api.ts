/**
 * JSON API (BC-024). One link per request; the extension and the page share
 * this path into history.
 */
import type { FastifyInstance } from 'fastify';
import type { ConversionSource } from '../db/historyStore.js';
import type { ConversionService } from '../services/conversionService.js';

const SOURCES: ReadonlySet<string> = new Set(['web', 'extension']);

export interface ConvertRequestBody {
  link: string;
  source: ConversionSource;
}

export function registerApiRoutes(app: FastifyInstance, service: ConversionService): void {
  app.post('/api/convert', async (request, reply) => {
    const body = request.body;
    if (typeof body !== 'object' || body === null) {
      return reply.code(400).send({ reason: 'invalid_request', message: 'Request body must be a JSON object with "link" and "source".' });
    }
    const { link, source } = body as Partial<Record<string, unknown>>;
    if (typeof link !== 'string' || link.trim() === '') {
      return reply.code(400).send({ reason: 'invalid_request', message: 'Request body must include a non-empty "link" string.' });
    }
    if (typeof source !== 'string' || !SOURCES.has(source)) {
      return reply.code(400).send({ reason: 'invalid_request', message: 'Request body must include "source" set to "web" or "extension".' });
    }

    request.breadcrumb.input = link;
    const outcome = await service.convert(link, source as ConversionSource);
    if (!outcome.ok) {
      request.breadcrumb.reason = outcome.failure.reason;
      return reply.code(400).send(outcome.failure);
    }
    request.breadcrumb.form = outcome.result.form;
    request.breadcrumb.state = outcome.result.state;
    return reply.code(200).send({ id: outcome.id, createdAt: outcome.createdAt, result: outcome.result });
  });
}
