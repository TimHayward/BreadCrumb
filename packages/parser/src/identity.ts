import type { ParseResult } from './types.js';

/**
 * A key saying which document a link points at, so that different links to
 * one file compare equal: Copilot cites a file with `action=edit` in one place
 * and `action=default` in another, and a `/r/` sharing link carries the same
 * id in `d` as a Doc.aspx link carries in `sourcedoc`.
 *
 *   id:<32 hex>          unique id from sourcedoc, UniqueId or a sharing link's d
 *   path:<host><path>    decoded path, lower cased, when there is no id
 *   url:<link>           anything else (sharing tokens, failures)
 *
 * Used by the extension to show one row per document and by the server to
 * find a citation's history entry.
 */
export function documentKey(result: ParseResult, url: string): string {
  if (!result.ok) {
    return `url:${url.trim()}`;
  }
  const id = result.identifiers.find((i) => i.kind === 'sourcedoc' || i.kind === 'uniqueId' || i.kind === 'd');
  if (id !== undefined) {
    // `d` is an item type letter followed by the id without dashes, e.g. w1a2b…
    const raw = id.kind === 'd' ? id.value.replace(/^[a-z]/i, '') : id.value;
    const hex = raw.toLowerCase().replace(/[^0-9a-f]/g, '');
    if (hex.length === 32) {
      return `id:${hex}`;
    }
  }
  if (result.path !== undefined) {
    return `path:${result.components.host.value}${result.path}`.toLowerCase();
  }
  return `url:${result.original}`;
}

/** The `id:` key for a list item unique id as Graph reports it. */
export function documentKeyForUniqueId(uniqueId: string): string {
  return `id:${uniqueId.toLowerCase().replace(/[^0-9a-f]/g, '')}`;
}
