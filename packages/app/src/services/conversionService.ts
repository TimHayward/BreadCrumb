/**
 * The one path into history (BC-024, BC-030): parse, then persist. Failures
 * are stored only when the caller asks to keep them (BC-026, D8). The server
 * makes no outbound requests while converting.
 */
import { parseLink, type ParseFailure, type ParseSuccess } from '@breadcrumb/parser';
import type { ConversionSource, HistoryStore } from '../db/historyStore.js';

export type ConversionOutcome =
  | { ok: true; id: number; createdAt: string; result: ParseSuccess }
  | { ok: false; failure: ParseFailure; id?: number; createdAt?: string };

export interface ConvertOptions {
  /** Store the failure as a history row with no state (BC-026). */
  keepFailure?: boolean;
}

export interface ConversionService {
  convert(input: string, source: ConversionSource, options?: ConvertOptions): Promise<ConversionOutcome>;
}

export function createConversionService(store: HistoryStore): ConversionService {
  return {
    async convert(input, source, options = {}) {
      const result = parseLink(input);
      if (!result.ok) {
        if (options.keepFailure) {
          const row = store.insert({ source, input: input.trim(), result });
          return { ok: false, failure: result, id: row.id, createdAt: row.createdAt };
        }
        return { ok: false, failure: result };
      }
      const row = store.insert({ source, input: result.original, result });
      return { ok: true, id: row.id, createdAt: row.createdAt, result };
    },
  };
}
