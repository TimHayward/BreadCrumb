/**
 * Data access for conversion history (BC-029, BC-030, BC-032 to BC-035)
 * and validation upgrades (BC-040). Routes and pages talk to HistoryStore
 * only; SQL lives here.
 */
import { documentKey, type ConfidenceState, type ParseResult } from '@breadcrumb/parser';
import type { ValidationRecord, ValidationSubmission, VerifiedResult } from '@breadcrumb/validation';
import { isBusyError, type Database } from './connection.js';

export type ConversionSource = 'web' | 'extension';

export interface ConversionRow {
  id: number;
  createdAt: string;
  source: ConversionSource;
  input: string;
  /** The state the parser produced; null for a kept failure. */
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
  /** The newest validation, when the row has been upgraded to Verified. */
  validation: ValidationRecord | null;
}

/** Verified when a validation exists, otherwise the parser's state. */
export function effectiveState(row: Pick<ConversionRow, 'state' | 'validation'>): ConfidenceState | null {
  return row.validation !== null ? 'Verified' : row.state;
}

export interface NewConversion {
  source: ConversionSource;
  input: string;
  result: ParseResult;
  /** ISO 8601 UTC. Defaults to now. */
  createdAt?: string;
}

/** Filters for list, count, export and search (BC-032, BC-033, BC-040). All optional; combined with AND. */
export interface HistoryFilters {
  /** Case insensitive substring over input, path, folder URL, file URL and file name (verified values included). */
  q?: string;
  /** One confidence state (Verified includes validated rows), `failed` for kept failures, or `upgraded` for rows validated from Inferred or Unresolved. */
  state?: ConfidenceState | 'failed' | 'upgraded';
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
  /** Appends a validation to a conversion. Throws when the conversion does not exist. */
  addValidation(conversionId: number, submission: ValidationSubmission): ValidationRecord;
  /**
   * The entry that best answers a citation (the extension's lookup): rows for
   * the same document key or the exact link, and for id keys also rows whose
   * newest validation has that list item unique id. Verified rows first, then newest.
   */
  findLatest(link: string, key: string): ConversionRow | undefined;
  /** Fills doc_key for rows stored before migration 3; returns how many were filled. */
  backfillDocumentKeys(): number;
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
  v_id: number | null;
  v_previous_state: string | null;
  v_verified_json: string | null;
}

const COLUMNS =
  'c.id, c.created_at, c.source, c.input, c.state, c.failure_reason, c.form, c.method_text, c.host, c.tenant, c.site_path, c.library, c.path, c.folder_url, c.file_url, c.file_name, c.result_json, c.parser_version, v.id AS v_id, v.previous_state AS v_previous_state, v.verified_json AS v_verified_json';

/** Conversions joined with each row's newest validation, if any. */
const FROM = 'FROM conversions c LEFT JOIN validations v ON v.id = (SELECT MAX(id) FROM validations WHERE conversion_id = c.id)';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function toRow(r: DbRow): ConversionRow {
  let validation: ValidationRecord | null = null;
  if (r.v_id !== null && r.v_verified_json !== null && r.v_previous_state !== null) {
    validation = {
      id: r.v_id,
      conversionId: r.id,
      previousState: r.v_previous_state as ValidationRecord['previousState'],
      verified: JSON.parse(r.v_verified_json) as VerifiedResult,
    };
  }
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
    validation,
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
    const columns = ['c.input', 'c.path', 'c.folder_url', 'c.file_url', 'c.file_name', 'v.path', 'v.folder_url', 'v.file_url', 'v.file_name'];
    clauses.push(`(${columns.map((col) => `${col} LIKE ? ESCAPE '\\'`).join(' OR ')})`);
    for (let i = 0; i < columns.length; i++) {
      params.push(pattern);
    }
  }
  switch (filters.state) {
    case undefined:
      break;
    case 'failed':
      clauses.push('c.state IS NULL');
      break;
    case 'upgraded':
      clauses.push("v.previous_state IN ('Inferred', 'Unresolved')");
      break;
    case 'Verified':
      clauses.push("(c.state = 'Verified' OR v.id IS NOT NULL)");
      break;
    default:
      clauses.push('c.state = ? AND v.id IS NULL');
      params.push(filters.state);
  }
  if (filters.from !== undefined && DATE.test(filters.from)) {
    clauses.push('c.created_at >= ?');
    params.push(`${filters.from}T00:00:00.000Z`);
  }
  if (filters.to !== undefined && DATE.test(filters.to)) {
    const next = new Date(`${filters.to}T00:00:00.000Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    clauses.push('c.created_at < ?');
    params.push(next.toISOString());
  }
  if (filters.source !== undefined) {
    clauses.push('c.source = ?');
    params.push(filters.source);
  }
  const host = filters.host?.trim();
  if (host !== undefined && host !== '') {
    const pattern = likePattern(host);
    clauses.push("(c.host LIKE ? ESCAPE '\\' OR c.tenant LIKE ? ESCAPE '\\')");
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
      `INSERT INTO conversions (created_at, source, input, state, failure_reason, form, method_text, host, tenant, site_path, library, path, folder_url, file_url, file_name, result_json, parser_version, doc_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      documentKey(r, conversion.input),
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
    const r = this.#db.prepare(`SELECT ${COLUMNS} ${FROM} WHERE c.id = ?`).get(id) as DbRow | undefined;
    return r === undefined ? undefined : toRow(r);
  }

  list(options: ListOptions): Page<ConversionRow> {
    const pageSize = Math.max(1, Math.floor(options.pageSize));
    const total = this.count(options.filters);
    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(Math.max(1, Math.floor(options.page)), pageCount);
    const where = whereClause(options.filters);
    const rows = this.#db
      .prepare(`SELECT ${COLUMNS} ${FROM}${where.sql} ORDER BY c.created_at DESC, c.id DESC LIMIT ? OFFSET ?`)
      .all(...where.params, pageSize, (page - 1) * pageSize) as unknown as DbRow[];
    return { rows: rows.map(toRow), total, page, pageSize, pageCount };
  }

  count(filters?: HistoryFilters): number {
    const where = whereClause(filters);
    const r = this.#db.prepare(`SELECT COUNT(*) AS n ${FROM}${where.sql}`).get(...where.params) as { n: number };
    return r.n;
  }

  all(filters?: HistoryFilters): ConversionRow[] {
    const where = whereClause(filters);
    const rows = this.#db
      .prepare(`SELECT ${COLUMNS} ${FROM}${where.sql} ORDER BY c.created_at DESC, c.id DESC`)
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

  addValidation(conversionId: number, submission: ValidationSubmission): ValidationRecord {
    const row = this.getById(conversionId);
    if (row === undefined) {
      throw new Error(`Conversion ${conversionId} does not exist`);
    }
    const v = submission.verified;
    const result = this.#db
      .prepare(
        `INSERT INTO validations (conversion_id, validated_at, previous_state, graph_item_id, drive_id, site_id, list_item_unique_id, web_url, path, folder_url, file_url, file_name, library, method_text, verified_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        conversionId,
        v.validatedAt,
        submission.previousState,
        v.graph.itemId,
        v.graph.driveId,
        v.graph.siteId ?? null,
        v.graph.listItemUniqueId ?? null,
        v.graph.webUrl ?? null,
        v.path,
        v.folderUrl,
        v.fileUrl ?? null,
        v.components.fileName ?? null,
        v.components.library,
        v.methodText,
        JSON.stringify(v),
      );
    return { id: Number(result.lastInsertRowid), conversionId, previousState: submission.previousState, verified: v };
  }

  findLatest(link: string, key: string): ConversionRow | undefined {
    const clauses = ['c.doc_key = ?', 'c.input = ?'];
    const params: string[] = [key, link.trim()];
    if (key.startsWith('id:')) {
      // A verified entry reached by another link form (a sharing token, say) still names the file's unique id.
      clauses.push("('id:' || lower(replace(replace(replace(v.list_item_unique_id, '-', ''), '{', ''), '}', ''))) = ?");
      params.push(key);
    }
    const r = this.#db
      .prepare(`SELECT ${COLUMNS} ${FROM} WHERE ${clauses.join(' OR ')} ORDER BY (v.id IS NOT NULL) DESC, c.created_at DESC, c.id DESC LIMIT 1`)
      .get(...params) as DbRow | undefined;
    return r === undefined ? undefined : toRow(r);
  }

  backfillDocumentKeys(): number {
    const rows = this.#db.prepare('SELECT id, input, result_json FROM conversions WHERE doc_key IS NULL').all() as Array<{ id: number; input: string; result_json: string }>;
    if (rows.length === 0) {
      return 0;
    }
    const update = this.#db.prepare('UPDATE conversions SET doc_key = ? WHERE id = ?');
    this.#db.exec('BEGIN');
    try {
      for (const row of rows) {
        update.run(documentKey(JSON.parse(row.result_json) as ParseResult, row.input), row.id);
      }
      this.#db.exec('COMMIT');
    } catch (error) {
      this.#db.exec('ROLLBACK');
      throw error;
    }
    return rows.length;
  }
}
