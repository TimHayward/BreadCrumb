/**
 * Renders a parser result (BC-023, BC-025). Used identically by the
 * conversion page and the history detail page (BC-031).
 */
import type { Component, ConfidenceState, ParseFailure, ParseSuccess } from '@breadcrumb/parser';
import { html, type Markup } from './html.js';

/** Each state has a distinct symbol so it is never conveyed by colour alone (BC-028). */
const STATE_SYMBOLS: Record<ConfidenceState, string> = {
  Verified: '●',
  Derived: '◆',
  Inferred: '◈',
  Unresolved: '○',
};

const STATE_HELP: Record<ConfidenceState, string> = {
  Verified: 'Confirmed by an authenticated Microsoft Graph lookup.',
  Derived: 'Decoded deterministically from the link with no guesswork.',
  Inferred: 'Best effort: at least one component is a guess.',
  Unresolved: 'The link form is recognised but cannot be decoded without signing in.',
};

export function stateBadge(state: ConfidenceState): Markup {
  return html`<span class="badge badge-${state.toLowerCase()}" title="${STATE_HELP[state]}"><span aria-hidden="true">${STATE_SYMBOLS[state]}</span> ${state}</span>`;
}

function inferredMarker(component: Component<unknown>): Markup | '' {
  return component.flag === 'Inferred' ? html` <span class="marker-inferred">inferred</span>` : '';
}

function copyButton(value: string, label: string): Markup {
  return html`<button type="button" class="copy" data-copy="${value}" aria-label="Copy ${label}">Copy</button>`;
}

function valueRow(label: string, id: string, value: string, link: boolean): Markup {
  const content = link
    ? html`<a href="${value}" target="_blank" rel="noopener noreferrer">${value}</a>`
    : html`<code>${value}</code>`;
  return html`<div class="row">
      <dt id="${id}-label">${label}</dt>
      <dd><span class="value" aria-labelledby="${id}-label">${content}</span> ${copyButton(value, label)}</dd>
    </div>`;
}

export function renderResult(result: ParseSuccess): Markup {
  const c = result.components;
  const sitePath = c.sitePath.value === '' ? html`<em>(root site)</em>` : html`<code>${c.sitePath.value}</code>`;
  const folders =
    c.folders.value.length === 0
      ? html`<em>(library root)</em>`
      : html`<ol class="folder-chain">${c.folders.value.map((f) => html`<li><code>${f}</code></li>`)}</ol>`;

  return html`<section class="result" aria-labelledby="result-heading">
    <div class="result-head">
      <h2 id="result-heading">Result</h2>
      ${stateBadge(result.state)}
      <span class="form-name">form: <code>${result.form}</code></span>
    </div>
    <dl class="result-rows">
      ${valueRow('Path', 'path', result.path, false)}
      ${valueRow('Folder URL', 'folder-url', result.folderUrl, true)}
      ${result.fileUrl !== undefined ? valueRow('File URL', 'file-url', result.fileUrl, true) : ''}
    </dl>
    <h3>Components</h3>
    <dl class="components">
      <div><dt>Tenant</dt><dd><code>${c.tenant.value}</code>${inferredMarker(c.tenant)}</dd></div>
      <div><dt>Host</dt><dd><code>${c.host.value}</code>${inferredMarker(c.host)}</dd></div>
      <div><dt>Site</dt><dd>${sitePath}${inferredMarker(c.sitePath)}</dd></div>
      <div><dt>Document library</dt><dd><code>${c.library.value}</code>${inferredMarker(c.library)} <span class="reason">(${c.library.reason})</span></dd></div>
      <div><dt>Folder chain</dt><dd>${folders}${inferredMarker(c.folders)}</dd></div>
      ${c.fileName !== undefined ? html`<div><dt>File name</dt><dd><code>${c.fileName.value}</code>${inferredMarker(c.fileName)}</dd></div>` : ''}
    </dl>
    <p class="method"><strong>How this was obtained:</strong> ${result.method.text}</p>
    ${
      result.wrappers.length > 0
        ? html`<p class="wrappers"><strong>Wrappers removed:</strong> ${result.wrappers.map((w) => w.type).join(', ')}</p>`
        : ''
    }
  </section>`;
}

export function renderFailure(failure: ParseFailure): Markup {
  return html`<section class="failure" role="alert">
    <h2>Could not convert this link</h2>
    <p>${failure.message}</p>
    <p class="reason-code">Reason code: <code>${failure.reason}</code></p>
  </section>`;
}
