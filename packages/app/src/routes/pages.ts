/**
 * Server rendered pages (BC-023, BC-031). The form posts natively, so Enter
 * submits without any client script; app.js only adds copy buttons.
 */
import type { FastifyInstance } from 'fastify';
import type { HistoryStore } from '../db/historyStore.js';
import type { ConversionService } from '../services/conversionService.js';
import { renderConvertPage } from '../views/convertPage.js';
import { renderHistoryDetailPage, renderHistoryListPage, renderNotFoundPage } from '../views/historyPages.js';

export const HISTORY_PAGE_SIZE = 50;

const HTML = 'text/html; charset=utf-8';

export function registerPageRoutes(app: FastifyInstance, service: ConversionService, store: HistoryStore): void {
  app.get('/', async (_request, reply) => {
    return reply.type(HTML).send(renderConvertPage({ input: '' }));
  });

  app.post('/convert', async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const link = typeof body['link'] === 'string' ? body['link'] : '';
    request.breadcrumb.input = link;
    const outcome = service.convert(link, 'web');
    if (outcome.ok) {
      request.breadcrumb.form = outcome.result.form;
      request.breadcrumb.state = outcome.result.state;
    } else {
      request.breadcrumb.reason = outcome.failure.reason;
    }
    return reply.type(HTML).send(renderConvertPage({ input: link, outcome }));
  });

  app.get<{ Querystring: { page?: string } }>('/history', async (request, reply) => {
    const requested = Number.parseInt(request.query.page ?? '1', 10);
    const page = store.list({ page: Number.isFinite(requested) && requested > 0 ? requested : 1, pageSize: HISTORY_PAGE_SIZE });
    return reply.type(HTML).send(renderHistoryListPage(page));
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
