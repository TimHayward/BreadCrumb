/**
 * History export (BC-035): CSV and JSON of the currently filtered rows.
 */
import type { ConversionRow } from '../db/historyStore.js';

export const CSV_COLUMNS = ['time', 'input', 'path', 'folderUrl', 'fileUrl', 'state', 'method', 'source', 'inferredComponents'] as const;

/** Escapes one CSV field: quoted when it contains a comma, quote, or line break. */
export function csvField(value: string | null | undefined): string {
  const text = value ?? '';
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function inferredComponents(row: ConversionRow): string[] {
  if (!row.result.ok) {
    return [];
  }
  return Object.entries(row.result.components)
    .filter(([, component]) => component !== undefined && component.flag === 'Inferred')
    .map(([name]) => name);
}

export function toCsv(rows: readonly ConversionRow[]): string {
  const lines = [CSV_COLUMNS.join(',')];
  for (const row of rows) {
    lines.push(
      [
        row.createdAt,
        row.input,
        row.path,
        row.folderUrl,
        row.fileUrl,
        row.state ?? `failed: ${row.failureReason ?? ''}`,
        row.methodText,
        row.source,
        inferredComponents(row).join(';'),
      ]
        .map(csvField)
        .join(','),
    );
  }
  return `${lines.join('\r\n')}\r\n`;
}

export function toJson(rows: readonly ConversionRow[]): string {
  return JSON.stringify(
    rows.map((row) => ({
      id: row.id,
      createdAt: row.createdAt,
      source: row.source,
      input: row.input,
      state: row.state,
      failureReason: row.failureReason,
      parserVersion: row.parserVersion,
      result: row.result,
    })),
    null,
    2,
  );
}

/** File name for a download, e.g. `breadcrumb-history-2026-09-10.csv`. */
export function exportFileName(extension: 'csv' | 'json', now: Date = new Date()): string {
  return `breadcrumb-history-${now.toISOString().slice(0, 10)}.${extension}`;
}
