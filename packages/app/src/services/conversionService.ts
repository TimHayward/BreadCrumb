/**
 * The one path into history (BC-024, BC-030): parse, optionally expand a
 * short link first (BC-027), then persist. Failures are stored only when the
 * caller asks to keep them (BC-026, D8).
 */
import { parseLink, type ParseFailure, type ParseSuccess } from '@breadcrumb/parser';
import type { ConversionSource, HistoryStore } from '../db/historyStore.js';
import type { ShortLinkExpander } from './shortLinkExpander.js';

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

export interface ConversionLogger {
  warn(obj: Record<string, unknown>, msg: string): void;
}

export interface ConversionDeps {
  expander?: ShortLinkExpander;
  log?: ConversionLogger;
}

export function createConversionService(store: HistoryStore, deps: ConversionDeps = {}): ConversionService {
  return {
    async convert(input, source, options = {}) {
      let result = parseLink(input);

      if (result.ok && result.form === 'onedrive-shortlink' && deps.expander !== undefined) {
        const original = result.original;
        const expansion = await deps.expander.expand(original);
        if (expansion.ok) {
          result = parseLink(expansion.finalUrl, { priorWrappers: [{ type: 'shortlink', original }] });
          if (result.ok) {
            result = { ...result, original };
          }
        } else {
          deps.log?.warn({ host: new URL(original).hostname, reason: expansion.reason }, `short link expansion failed: ${expansion.message}`);
          result = {
            ...result,
            method: {
              code: `onedrive-shortlink/expansion-failed/${expansion.reason}`,
              text: `Recognised a short link but it could not be expanded: ${expansion.message} The link stays Unresolved.`,
            },
          };
        }
      }

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
