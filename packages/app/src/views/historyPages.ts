import { effectiveState, type ConversionRow, type HistoryFilters, type Page } from '../db/historyStore.js';
import { filtersToQuery, hasFilters } from '../routes/filters.js';
import { formatTime, truncate } from './format.js';
import { breakableUrl, html, type Markup } from './html.js';
import { layout, type ViewContext } from './layout.js';
import { renderFailure, renderResult, stateBadge } from './resultView.js';

function rowState(row: ConversionRow): Markup {
  const state = effectiveState(row);
  if (state === null) {
    return html`<span class="badge badge-failure"><span aria-hidden="true">✕</span> failed</span>`;
  }
  const upgraded = row.validation !== null ? html` <span class="marker-upgraded">upgraded from ${row.validation.previousState}</span>` : '';
  return html`${stateBadge(state)}${upgraded}`;
}

function rowPath(row: ConversionRow): Markup {
  const path = row.validation?.verified.path ?? row.path;
  if (path !== null) {
    return html`<code>${path}</code>`;
  }
  return html`<em>${row.state === null ? `failed: ${row.failureReason ?? ''}` : 'path not known'}</em>`;
}

function option(value: string, label: string, selected: string | undefined): Markup {
  return html`<option value="${value}" ${selected === value ? html`selected` : ''}>${label}</option>`;
}

function filterForm(filters: HistoryFilters): Markup {
  return html`<form method="get" action="/history" class="filters" aria-label="Search and filter history">
      <div class="field grow">
        <label for="q">Search</label>
        <input id="q" name="q" type="search" value="${filters.q ?? ''}" placeholder="client, file name, part of a link">
      </div>
      <div class="field">
        <label for="state">State</label>
        <select id="state" name="state">
          ${option('', 'Any', filters.state)}
          ${option('Verified', 'Verified', filters.state)}
          ${option('upgraded', 'Upgraded to Verified', filters.state)}
          ${option('Derived', 'Derived', filters.state)}
          ${option('Inferred', 'Inferred', filters.state)}
          ${option('Unresolved', 'Unresolved', filters.state)}
          ${option('failed', 'Failed', filters.state)}
        </select>
      </div>
      <div class="field">
        <label for="from">From</label>
        <input id="from" name="from" type="date" value="${filters.from ?? ''}">
      </div>
      <div class="field">
        <label for="to">To</label>
        <input id="to" name="to" type="date" value="${filters.to ?? ''}">
      </div>
      <div class="field">
        <label for="source">Source</label>
        <select id="source" name="source">
          ${option('', 'Any', filters.source)}
          ${option('web', 'web', filters.source)}
          ${option('extension', 'extension', filters.source)}
        </select>
      </div>
      <div class="field">
        <label for="host">Host or tenant</label>
        <input id="host" name="host" type="text" value="${filters.host ?? ''}" placeholder="contoso">
      </div>
      <div class="field actions">
        <button type="submit">Apply</button>
        ${hasFilters(filters) ? html`<a class="button-link" href="/history">Clear</a>` : ''}
      </div>
    </form>`;
}

export interface HistoryListOptions {
  page: Page<ConversionRow>;
  filters: HistoryFilters;
  deleted?: number;
  context: ViewContext;
}

export function renderHistoryListPage(options: HistoryListOptions): string {
  const { page, filters } = options;
  const query = (extra: Record<string, string | number | undefined>): string => {
    const qs = filtersToQuery(filters, extra);
    return qs === '' ? '/history' : `/history?${qs}`;
  };
  const currentUrl = query({ page: page.page > 1 ? page.page : undefined });

  const pager = html`<nav class="pager" aria-label="History pages">
      ${page.page > 1 ? html`<a rel="prev" href="${query({ page: page.page - 1 })}">Newer</a>` : html`<span class="disabled">Newer</span>`}
      <span>Page ${page.page} of ${page.pageCount}</span>
      ${page.page < page.pageCount ? html`<a rel="next" href="${query({ page: page.page + 1 })}">Older</a>` : html`<span class="disabled">Older</span>`}
    </nav>`;

  const count = html`<p class="count" aria-live="polite">${page.total} ${page.total === 1 ? 'entry' : 'entries'}${hasFilters(filters) ? ' match' : ''}.</p>`;

  let table: Markup;
  if (page.total === 0 && !hasFilters(filters)) {
    table = html`<p class="empty">No conversions yet. <a href="/">Convert a link</a> to start the history.</p>`;
  } else if (page.total === 0) {
    table = html`<p class="empty">No entries match this search. <a href="/history">Clear the search</a> to see everything.</p>`;
  } else {
    table = html`<form method="post" action="/history/delete" class="bulk">
      <input type="hidden" name="return" value="${currentUrl}">
      <table class="history">
        <thead><tr>
          <th scope="col" class="select"><input type="checkbox" id="select-all" aria-label="Select all entries on this page"></th>
          <th scope="col">Time</th><th scope="col">Input</th><th scope="col">Path</th><th scope="col">State</th><th scope="col">Source</th>
        </tr></thead>
        <tbody>
          ${page.rows.map(
            (row) => html`<tr>
            <td class="select"><input type="checkbox" name="ids" value="${row.id}" aria-label="Select entry ${row.id}"></td>
            <td><a href="/history/${row.id}"><time datetime="${row.createdAt}">${formatTime(row.createdAt)}</time></a></td>
            <td class="input" title="${row.input}"><code>${truncate(row.input, 72)}</code></td>
            <td class="path">${rowPath(row)}</td>
            <td>${rowState(row)}</td>
            <td>${row.source}</td>
          </tr>`,
          )}
        </tbody>
      </table>
      <div class="bulk-actions">
        <button type="submit" class="danger">Delete selected</button>
      </div>
    </form>`;
  }

  const exportQuery = filtersToQuery(filters) === '' ? '' : `?${filtersToQuery(filters)}`;
  const exportLinks = html`<p class="export">Export ${hasFilters(filters) ? 'the matching entries' : 'everything'} as
      <a href="/history/export.csv${exportQuery}">CSV</a> or
      <a href="/history/export.json${exportQuery}">JSON</a>.</p>`;

  const validateAll =
    options.context.auth !== undefined
      ? html`<div id="validate-all" class="validate-all" hidden>
      <button type="button">Verify all unverified</button>
      <span class="note" role="status" aria-live="polite"></span>
    </div>`
      : '';

  const body = html`<h1>History</h1>
    <p class="lede">Every conversion, newest first.</p>
    ${options.deleted !== undefined ? html`<p class="flash" role="status">${options.deleted} ${options.deleted === 1 ? 'entry' : 'entries'} deleted.</p>` : ''}
    ${validateAll}
    ${filterForm(filters)}
    ${count}
    ${exportLinks}
    ${page.total > 0 ? pager : ''}
    ${table}
    ${page.total > page.pageSize ? pager : ''}`;
  return layout({ title: `History · page ${page.page}`, active: 'history', body, context: options.context });
}

export interface HistoryDetailOptions {
  row: ConversionRow;
  context: ViewContext;
  /** Set after a validation just landed, to announce it. */
  validated?: boolean;
}

export function renderHistoryDetailPage(options: HistoryDetailOptions): string {
  const { row, context } = options;
  const body = html`<h1>History entry ${row.id}</h1>
    ${options.validated ? html`<p class="flash" role="status">Validated with Microsoft Graph. The result below is Verified; the original best effort result is kept beneath it.</p>` : ''}
    <dl class="meta">
      <div><dt>Converted</dt><dd><time datetime="${row.createdAt}">${formatTime(row.createdAt)}</time></dd></div>
      <div><dt>Source</dt><dd>${row.source}</dd></div>
      <div><dt>Parser version</dt><dd><code>${row.parserVersion}</code></dd></div>
      <div><dt>Input</dt><dd><code class="wrap">${breakableUrl(row.input)}</code></dd></div>
    </dl>
    ${
      row.result.ok
        ? renderResult(row.result, { id: row.id, validation: row.validation, authConfigured: context.auth !== undefined })
        : renderFailure(row.result)
    }
    <div class="detail-actions">
      <a href="/history">Back to history</a>
      <form method="post" action="/history/delete" class="inline">
        <input type="hidden" name="ids" value="${row.id}">
        <input type="hidden" name="return" value="/history">
        <button type="submit" class="danger">Delete this entry</button>
      </form>
    </div>`;
  return layout({ title: `History entry ${row.id}`, active: 'history', body, context });
}

export interface DeleteConfirmOptions {
  rows: ConversionRow[];
  returnTo: string;
  context: ViewContext;
}

export function renderDeleteConfirmPage(options: DeleteConfirmOptions): string {
  const n = options.rows.length;
  const body = html`<h1>Delete ${n} ${n === 1 ? 'entry' : 'entries'}?</h1>
    <p>This removes ${n === 1 ? 'the entry' : 'these entries'} from history and search. There is no undo.</p>
    <ul class="confirm-list">
      ${options.rows.map((row) => html`<li><time datetime="${row.createdAt}">${formatTime(row.createdAt)}</time> · <code>${truncate(row.input, 90)}</code></li>`)}
    </ul>
    <form method="post" action="/history/delete" class="confirm-form">
      ${options.rows.map((row) => html`<input type="hidden" name="ids" value="${row.id}">`)}
      <input type="hidden" name="confirm" value="1">
      <input type="hidden" name="return" value="${options.returnTo}">
      <button type="submit" class="danger">Delete</button>
      <a class="button-link" href="${options.returnTo}">Cancel</a>
    </form>`;
  return layout({ title: 'Confirm delete', active: 'history', body, context: options.context });
}

export function renderNotFoundPage(what: string, context: ViewContext): string {
  const body = html`<h1>Not found</h1><p>${what}</p><p><a href="/history">Back to history</a></p>`;
  return layout({ title: 'Not found', body, context });
}
