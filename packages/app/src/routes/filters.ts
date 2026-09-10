/**
 * Parses and re-serialises history filters (BC-033) so the URL always
 * reflects the current search and filter combination.
 */
import type { ConfidenceState } from '@breadcrumb/parser';
import type { ConversionSource, HistoryFilters } from '../db/historyStore.js';

const STATES = new Set<string>(['Verified', 'Derived', 'Inferred', 'Unresolved', 'failed']);
const SOURCES = new Set<string>(['web', 'extension']);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export type Query = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  return v === undefined ? undefined : v.trim();
}

export function parseFilters(query: Query): HistoryFilters {
  const filters: HistoryFilters = {};
  const q = first(query['q']);
  if (q !== undefined && q !== '') filters.q = q;
  const state = first(query['state']);
  if (state !== undefined && STATES.has(state)) filters.state = state as ConfidenceState | 'failed';
  const from = first(query['from']);
  if (from !== undefined && DATE.test(from)) filters.from = from;
  const to = first(query['to']);
  if (to !== undefined && DATE.test(to)) filters.to = to;
  const source = first(query['source']);
  if (source !== undefined && SOURCES.has(source)) filters.source = source as ConversionSource;
  const host = first(query['host']);
  if (host !== undefined && host !== '') filters.host = host;
  return filters;
}

export function parsePage(query: Query): number {
  const raw = Number.parseInt(first(query['page']) ?? '1', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 1;
}

/** Query string (without `?`) for the filters plus any extra parameters. */
export function filtersToQuery(filters: HistoryFilters, extra: Record<string, string | number | undefined> = {}): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...filters, ...extra })) {
    if (value !== undefined && value !== '') {
      params.set(key, String(value));
    }
  }
  return params.toString();
}

export function hasFilters(filters: HistoryFilters): boolean {
  return Object.keys(filters).length > 0;
}
