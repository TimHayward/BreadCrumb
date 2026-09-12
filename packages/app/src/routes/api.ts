/**
 * JSON API (BC-024, BC-040). One link per request; the extension and the
 * page share this path into history. Validation results come from the
 * browser, which is where Graph is called (decision D3).
 */
import { documentKey, parseLink } from '@breadcrumb/parser';
import type { FastifyInstance } from 'fastify';
import { effectiveState, type ConversionSource, type HistoryStore } from '../db/historyStore.js';
import type { ConversionService } from '../services/conversionService.js';
import { isValidatable } from '../validation/graphValidation.js';
import { parseSubmission } from '../validation/submission.js';

const SOURCES: ReadonlySet<string> = new Set(['web', 'extension']);

/** Links per POST /api/lookup: one Copilot answer rarely cites more than a handful of files. */
const MAX_LOOKUP_LINKS = 50;

export interface ConvertRequestBody {
  link: string;
  source: ConversionSource;
}

export function registerApiRoutes(app: FastifyInstance, service: ConversionService, store: HistoryStore): void {
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

  /**
   * What BreadCrumb knows about citations (the extension popup): for each link,
   * the best history entry for the same document, with its Verified values
   * when it has been validated. At most 50 links per request.
   */
  app.post('/api/lookup', async (request, reply) => {
    const body = request.body as { links?: unknown } | null;
    const links = body?.links;
    if (!Array.isArray(links) || links.length > MAX_LOOKUP_LINKS || !links.every((l): l is string => typeof l === 'string' && l.trim() !== '')) {
      return reply.code(400).send({ reason: 'invalid_request', message: `Request body must be { "links": [ ...up to ${MAX_LOOKUP_LINKS} non-empty strings ] }.` });
    }
    const answers = links.map((link) => {
      const row = store.findLatest(link, documentKey(parseLink(link), link));
      if (row === undefined) {
        return { link, found: false as const };
      }
      const v = row.validation?.verified;
      return {
        link,
        found: true as const,
        id: row.id,
        state: effectiveState(row),
        verified: v !== undefined,
        path: v?.path ?? row.path,
        folderUrl: v?.folderUrl ?? row.folderUrl,
        fileUrl: v === undefined ? row.fileUrl : (v.fileUrl ?? null),
        fileName: v?.components.fileName ?? row.fileName,
      };
    });
    return reply.send({ answers });
  });

  /** Every unverified entry the browser can check with Graph, newest first, for "Verify all unverified". */
  app.get<{ Querystring: { limit?: string } }>('/api/history/validatable', async (request, reply) => {
    const requested = Number.parseInt(request.query.limit ?? '100', 10);
    const limit = Number.isInteger(requested) && requested > 0 ? Math.min(requested, 500) : 100;
    const entries = store
      .all()
      .filter((row) => row.validation === null && row.result.ok && isValidatable(row.result))
      .slice(0, limit)
      .map((row) => ({ id: row.id, previousState: row.state, result: row.result }));
    return reply.send({ entries });
  });

  app.post<{ Params: { id: string } }>('/api/history/:id/validate', async (request, reply) => {
    const id = /^\d+$/.test(request.params.id) ? Number(request.params.id) : undefined;
    const row = id === undefined ? undefined : store.getById(id);
    if (row === undefined) {
      return reply.code(404).send({ reason: 'not_found', message: `There is no history entry ${request.params.id}.` });
    }
    if (row.state === null || row.state === 'Verified') {
      return reply.code(409).send({ reason: 'not_validatable', message: 'Only Derived, Inferred and Unresolved entries can be validated.' });
    }
    const parsed = parseSubmission(request.body);
    if (!parsed.ok) {
      return reply.code(400).send({ reason: 'invalid_request', message: parsed.error });
    }
    if (parsed.value.previousState !== row.state) {
      return reply.code(409).send({ reason: 'state_mismatch', message: `The entry is ${row.state}, not ${parsed.value.previousState}.` });
    }
    const validation = store.addValidation(row.id, parsed.value);
    if (row.form !== null) {
      request.breadcrumb.form = row.form;
    }
    request.breadcrumb.state = 'Verified';
    request.log.info({ id: row.id, previousState: row.state, graphItemId: validation.verified.graph.itemId }, 'history entry validated');
    return reply.code(200).send({ ok: true, id: row.id, validation });
  });
}
