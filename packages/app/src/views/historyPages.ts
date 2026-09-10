import type { ConversionRow, Page } from '../db/historyStore.js';
import { formatTime, truncate } from './format.js';
import { html, type Markup } from './html.js';
import { layout } from './layout.js';
import { renderFailure, renderResult, stateBadge } from './resultView.js';

function rowState(row: ConversionRow): Markup {
  return row.state === null ? html`<span class="badge badge-failure">failed</span>` : stateBadge(row.state);
}

export function renderHistoryListPage(page: Page<ConversionRow>): string {
  const pager = html`<nav class="pager" aria-label="History pages">
      ${page.page > 1 ? html`<a rel="prev" href="/history?page=${page.page - 1}">Newer</a>` : html`<span class="disabled">Newer</span>`}
      <span>Page ${page.page} of ${page.pageCount} (${page.total} ${page.total === 1 ? 'entry' : 'entries'})</span>
      ${page.page < page.pageCount ? html`<a rel="next" href="/history?page=${page.page + 1}">Older</a>` : html`<span class="disabled">Older</span>`}
    </nav>`;

  const table =
    page.total === 0
      ? html`<p class="empty">No conversions yet. <a href="/">Convert a link</a> to start the history.</p>`
      : html`<table class="history">
      <thead><tr><th scope="col">Time</th><th scope="col">Input</th><th scope="col">Path</th><th scope="col">State</th><th scope="col">Source</th></tr></thead>
      <tbody>
        ${page.rows.map(
          (row) => html`<tr>
          <td><a href="/history/${row.id}"><time datetime="${row.createdAt}">${formatTime(row.createdAt)}</time></a></td>
          <td class="input" title="${row.input}"><code>${truncate(row.input, 72)}</code></td>
          <td class="path">${row.path === null ? html`<em>${row.failureReason ?? ''}</em>` : html`<code>${row.path}</code>`}</td>
          <td>${rowState(row)}</td>
          <td>${row.source}</td>
        </tr>`,
        )}
      </tbody>
    </table>`;

  const body = html`<h1>History</h1>
    <p class="lede">Every conversion, newest first.</p>
    ${pager}
    ${table}
    ${page.total > page.pageSize ? pager : ''}`;
  return layout({ title: `History · page ${page.page}`, active: 'history', body });
}

export function renderHistoryDetailPage(row: ConversionRow): string {
  const body = html`<h1>History entry ${row.id}</h1>
    <dl class="meta">
      <div><dt>Converted</dt><dd><time datetime="${row.createdAt}">${formatTime(row.createdAt)}</time></dd></div>
      <div><dt>Source</dt><dd>${row.source}</dd></div>
      <div><dt>Parser version</dt><dd><code>${row.parserVersion}</code></dd></div>
      <div><dt>Input</dt><dd><code class="wrap">${row.input}</code></dd></div>
    </dl>
    ${row.result.ok ? renderResult(row.result) : renderFailure(row.result)}
    <p><a href="/history">Back to history</a></p>`;
  return layout({ title: `History entry ${row.id}`, active: 'history', body });
}

export function renderNotFoundPage(what: string): string {
  const body = html`<h1>Not found</h1><p>${what}</p><p><a href="/history">Back to history</a></p>`;
  return layout({ title: 'Not found', body });
}
