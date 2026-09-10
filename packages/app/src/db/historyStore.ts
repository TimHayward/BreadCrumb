/**
 * Data access for conversion history (BC-029, BC-030, BC-032 to BC-035).
 * Routes and pages talk to HistoryStore only; SQL lives here.
 */
import type { ConfidenceState, ParseResult } from '@breadcrumb/parser';
import { isBusyError, type Database } from './connection.js';

export type ConversionSource = 'web' | 'extension';

export interface ConversionRow {
  id: number;
  createdAt: string;
  source: ConversionSource;
  input: string;
  state: ConfidenceState | null;
  failureReason: string | null;
  form: string | null;
  methodText: string | null;
  host: string | null;
  tenant: string | null;
  sitePath: string | null;
  library: string | null;
  path: string | null;
  folderUrl: string | null;
  fileUrl: string | null;
  fileName: string | null;
  result: ParseResult;
  parserVersion: string;
}

export interface NewConversion {
  source: ConversionSource;
  input: string;
  result: ParseResult;
  /** ISO 8601 UTC. Defaults to now. */
  createdAt?: string;
}

/** Filters for list, count, export and search (BC-032, BC-033). All optional; combined with AND. */
export interface HistoryFilters {
  /** Case insensitive substring over input, path, folder URL, file URL and file name. */
  q?: string;
  /** One confidence state, or `failed` for kept failures. */
  state?: ConfidenceState | 'failed';
  /** Inclusive start date, `YYYY-MM-DD` (UTC). */
  from?: string;
  /** Inclusive end date, `YYYY-MM-DD` (UTC). */
  to?: string;
  source?: ConversionSource;
  /** Substring of the host or tenant. */
  host?: string;
}

export interface ListOptions {
  /** 1-based page number. */
  page: number;
  pageSize: number;
  filters?: HistoryFilters;
}

export interface Page<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

export interface HistoryStore {
  insert(conversion: NewConversion): ConversionRow;
  getById(id: number): ConversionRow | undefined;
  /** Newest first. */
  list(options: ListOptions): Page<ConversionRow>;
  count(filters?: HistoryFilters): number;
  /** Every matching row, newest first, for export. */
  all(filters?: HistoryFilters): ConversionRow[];
  /** Deletes the given ids; returns how many rows were removed. */
  delete(ids: readonly number[]): number;
}

interface DbRow {
  id: number;
  created_at: string;
  source: string;
  input: string;
  state: string | null;
  failure_reason: string | null;
  form: string | null;
  method_text: string | null;
  host: string | null;
  tenant: string | null;
  site_path: string | null;
  library: string | null;
  path: string | null;
  folder_url: string | null;
  file_url: string | null;
  file_name: string | null;
  result_json: string;
  parser_version: string;
}

const COLUMNS =
  'id, created_at, source, input, state, failure_reason, form, method_text, host, tenant, site_path, library, path, folder_url, file_url, file_name, result_json, parser_version';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function toRow(r: DbRow): ConversionRow {
  return {
    id: r.id,
    createdAt: r.created_at,
    source: r.source as ConversionSource,
    input: r.input,
    state: r.state as ConfidenceState | null,
    failureReason: r.failure_reason,
    form: r.form,
    methodText: r.method_text,
    host: r.host,
    tenant: r.tenant,
    sitePath: r.site_path,
    library: r.library,
    path: r.path,
    folderUrl: r.folder_url,
    fileUrl: r.file_url,
    fileName: r.file_name,
    result: JSON.parse(r.result_json) as ParseResult,
    parserVersion: r.parser_version,
  };
}

function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** Builds the WHERE clause and its parameters for a set of filters. */
function whereClause(filters: HistoryFilters = {}): { sql: string; params: Array<string | number> } {
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  const q = filters.q?.trim();
  if (q !== undefined && q !== '') {
    const pattern = likePattern(q);
    clauses.push(
      "(input LIKE ? ESCAPE '\\' OR path LIKE ? ESCAPE '\\' OR folder_url LIKE ? ESCAPE '\\' OR file_url LIKE ? ESCAPE '\\' OR file_name LIKE ? ESCAPE '\\')",
    );
    params.push(pattern, pattern, pattern, pattern, pattern);
  }
  if (filters.state === 'failed') {
    clauses.push('state IS NULL');
  } else if (filters.state !== undefined) {
    clauses.push('state = ?');
    params.push(filters.state);
  }
  if (filters.from !== undefined && DATE.test(filters.from)) {
    clauses.push('created_at >= ?');
    params.push(`${filters.from}T00:00:00.000Z`);
  }
  if (filters.to !== undefined && DATE.test(filters.to)) {
    const next = new Date(`${filters.to}T00:00:00.000Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    clauses.push('created_at < ?');
    params.push(next.toISOString());
  }
  if (filters.source !== undefined) {
    clauses.push('source = ?');
    params.push(filters.source);
  }
  const host = filters.host?.trim();
  if (host !== undefined && host !== '') {
    const pattern = likePattern(host);
    clauses.push("(host LIKE ? ESCAPE '\\' OR tenant LIKE ? ESCAPE '\\')");
    params.push(pattern, pattern);
  }
  return { sql: clauses.length === 0 ? '' : ` WHERE ${clauses.join(' AND ')}`, params };
}

export class SqliteHistoryStore implements HistoryStore {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  insert(conversion: NewConversion): ConversionRow {
    const createdAt = conversion.createdAt ?? new Date().toISOString();
    const r = conversion.result;
    const params = r.ok
      ? {
          state: r.state,
          failure_reason: null,
          form: r.form,
          method_text: r.method.text,
          host: r.components.host.value,
          tenant: r.components.tenant.value,
          site_path: r.components.sitePath?.value ?? null,
          library: r.components.library?.value ?? null,
          path: r.path ?? null,
          folder_url: r.folderUrl ?? null,
          file_url: r.fileUrl ?? null,
          file_name: r.components.fileName?.value ?? null,
        }
      : {
          state: null,
          failure_reason: r.reason,
          form: null,
          method_text: r.message,
          host: r.detail?.host ?? null,
          tenant: null,
          site_path: null,
          library: null,
          path: null,
          folder_url: null,
          file_url: null,
          file_name: null,
        };

    const statement = this.#db.prepare(
      `INSERT INTO conversions (created_at, source, input, state, failure_reason, form, method_text, host, tenant, site_path, library, path, folder_url, file_url, file_name, result_json, parser_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const args = [
      createdAt,
      conversion.source,
      conversion.input,
      params.state,
      params.failure_reason,
      params.form,
      params.method_text,
      params.host,
      params.tenant,
      params.site_path,
      params.library,
      params.path,
      params.folder_url,
      params.file_url,
      params.file_name,
      JSON.stringify(r),
      r.parserVersion,
    ];

    // S4 saw one SQLITE_BUSY in 2000 writes under contention; retry once
    // rather than lose a row, and surface anything else (invariant 12).
    let id: number;
    try {
      id = Number(statement.run(...args).lastInsertRowid);
    } catch (error) {
      if (!isBusyError(error)) {
        throw error;
      }
      id = Number(statement.run(...args).lastInsertRowid);
    }
    const row = this.getById(id);
    if (row === undefined) {
      throw new Error(`Conversion ${id} was inserted but could not be read back`);
    }
    return row;
  }

  getById(id: number): ConversionRow | undefined {
    const r = this.#db.prepare(`SELECT ${COLUMNS} FROM conversions WHERE id = ?`).get(id) as DbRow | undefined;
    return r === undefined ? undefined : toRow(r);
  }

  list(options: ListOptions): Page<ConversionRow> {
    const pageSize = Math.max(1, Math.floor(options.pageSize));
    const total = this.count(options.filters);
    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(Math.max(1, Math.floor(options.page)), pageCount);
    const where = whereClause(options.filters);
    const rows = this.#db
      .prepare(`SELECT ${COLUMNS} FROM conversions${where.sql} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`)
      .all(...where.params, pageSize, (page - 1) * pageSize) as unknown as DbRow[];
    return { rows: rows.map(toRow), total, page, pageSize, pageCount };
  }

  count(filters?: HistoryFilters): number {
    const where = whereClause(filters);
    const r = this.#db.prepare(`SELECT COUNT(*) AS n FROM conversions${where.sql}`).get(...where.params) as { n: number };
    return r.n;
  }

  all(filters?: HistoryFilters): ConversionRow[] {
    const where = whereClause(filters);
    const rows = this.#db
      .prepare(`SELECT ${COLUMNS} FROM conversions${where.sql} ORDER BY created_at DESC, id DESC`)
      .all(...where.params) as unknown as DbRow[];
    return rows.map(toRow);
  }

  delete(ids: readonly number[]): number {
    const valid = [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))];
    if (valid.length === 0) {
      return 0;
    }
    const placeholders = valid.map(() => '?').join(', ');
    const result = this.#db.prepare(`DELETE FROM conversions WHERE id IN (${placeholders})`).run(...valid);
    return Number(result.changes);
  }
}
