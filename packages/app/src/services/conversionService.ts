/**
 * The one path into history (BC-024, BC-030): parse, then persist successes.
 * Failures are not stored by default (BC-021; D8 revisits in M2).
 */
import { parseLink, type ParseFailure, type ParseSuccess } from '@breadcrumb/parser';
import type { ConversionSource, HistoryStore } from '../db/historyStore.js';

export type ConversionOutcome =
  | { ok: true; id: number; createdAt: string; result: ParseSuccess }
  | { ok: false; failure: ParseFailure };

export interface ConversionService {
  convert(input: string, source: ConversionSource): ConversionOutcome;
}

export function createConversionService(store: HistoryStore): ConversionService {
  return {
    convert(input, source) {
      const result = parseLink(input);
      if (!result.ok) {
        return { ok: false, failure: result };
      }
      const row = store.insert({ source, input: result.original, result });
      return { ok: true, id: row.id, createdAt: row.createdAt, result };
    },
  };
}
