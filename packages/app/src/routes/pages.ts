/**
 * Server rendered pages (BC-023, BC-026, BC-031, BC-033 to BC-035). Forms
 * post natively, so everything works without client script; app.js only
 * adds copy buttons and a select-all checkbox.
 */
import type { FastifyInstance } from 'fastify';
import type { HistoryStore } from '../db/historyStore.js';
import type { ConversionService } from '../services/conversionService.js';
import { exportFileName, toCsv, toJson } from '../services/exporters.js';
import { renderConvertPage } from '../views/convertPage.js';
import { renderDeleteConfirmPage, renderHistoryDetailPage, renderHistoryListPage, renderNotFoundPage } from '../views/historyPages.js';
import { parseFilters, parsePage, type Query } from './filters.js';

export const HISTORY_PAGE_SIZE = 50;

const HTML = 'text/html; charset=utf-8';

function idsFrom(value: unknown): number[] {
  const raw = Array.isArray(value) ? value : value === undefined ? [] : [value];
  return raw.map((v) => Number.parseInt(String(v), 10)).filter((n) => Number.isInteger(n) && n > 0);
}

/** Only ever redirect back inside the history pages. */
function safeReturn(value: unknown): string {
  const text = typeof value === 'string' ? value : '';
  return text.startsWith('/history') && !text.startsWith('//') ? text : '/history';
}

export function registerPageRoutes(app: FastifyInstance, service: ConversionService, store: HistoryStore): void {
  app.get('/', async (_request, reply) => {
    return reply.type(HTML).send(renderConvertPage({ input: '' }));
  });

  app.post('/convert', async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const link = typeof body['link'] === 'string' ? body['link'] : '';
    const keepFailure = body['keep'] === '1';
    request.breadcrumb.input = link;
    const outcome = await service.convert(link, 'web', { keepFailure });
    if (outcome.ok) {
      request.breadcrumb.form = outcome.result.form;
      request.breadcrumb.state = outcome.result.state;
    } else {
      request.breadcrumb.reason = outcome.failure.reason;
    }
    return reply.type(HTML).send(renderConvertPage({ input: link, outcome }));
  });

  app.get<{ Querystring: Query }>('/history', async (request, reply) => {
    const filters = parseFilters(request.query);
    const page = store.list({ page: parsePage(request.query), pageSize: HISTORY_PAGE_SIZE, filters });
    const deletedRaw = Number.parseInt(String(request.query['deleted'] ?? ''), 10);
    const deleted = Number.isInteger(deletedRaw) && deletedRaw >= 0 ? deletedRaw : undefined;
    return reply.type(HTML).send(renderHistoryListPage({ page, filters, ...(deleted !== undefined ? { deleted } : {}) }));
  });

  app.get<{ Querystring: Query }>('/history/export.csv', async (request, reply) => {
    const rows = store.all(parseFilters(request.query));
    return reply
      .type('text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="${exportFileName('csv')}"`)
      .send(toCsv(rows));
  });

  app.get<{ Querystring: Query }>('/history/export.json', async (request, reply) => {
    const rows = store.all(parseFilters(request.query));
    return reply
      .type('application/json; charset=utf-8')
      .header('content-disposition', `attachment; filename="${exportFileName('json')}"`)
      .send(toJson(rows));
  });

  app.post('/history/delete', async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const ids = idsFrom(body['ids']);
    const returnTo = safeReturn(body['return']);
    if (ids.length === 0) {
      return reply.redirect(returnTo, 303);
    }
    if (body['confirm'] !== '1') {
      const rows = ids.map((id) => store.getById(id)).filter((row) => row !== undefined);
      return reply.type(HTML).send(renderDeleteConfirmPage({ rows, returnTo }));
    }
    const deleted = store.delete(ids);
    request.log.info({ deleted, ids }, 'history entries deleted');
    const separator = returnTo.includes('?') ? '&' : '?';
    return reply.redirect(`${returnTo}${separator}deleted=${deleted}`, 303);
  });

  app.get<{ Params: { id: string } }>('/history/:id', async (request, reply) => {
    const id = /^\d+$/.test(request.params.id) ? Number(request.params.id) : undefined;
    const row = id === undefined ? undefined : store.getById(id);
    if (row === undefined) {
      return reply.code(404).type(HTML).send(renderNotFoundPage(`There is no history entry ${request.params.id}.`));
    }
    return reply.type(HTML).send(renderHistoryDetailPage(row));
  });
}
