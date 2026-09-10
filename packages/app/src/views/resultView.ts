/**
 * Renders a parser result (BC-023, BC-025, BC-026). Used identically by the
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

const WRAPPER_LABELS: Record<string, string> = {
  teams: 'Teams file link',
  safelinks: 'Outlook Safe Links',
  shortlink: 'short link (expanded by the server)',
};

/** Shown beneath an Unresolved result until authenticated validation (M3) ships. */
export const UNRESOLVED_NEXT_STEP =
  'Authenticated validation is not yet available in this version. The result has been kept in history with its Unresolved state, so it can be validated later.';

export function stateBadge(state: ConfidenceState): Markup {
  return html`<span class="badge badge-${state.toLowerCase()}" title="${STATE_HELP[state]}"><span aria-hidden="true">${STATE_SYMBOLS[state]}</span> ${state}</span>`;
}

function inferredMarker(component: Component<unknown> | undefined): Markup | '' {
  return component?.flag === 'Inferred' ? html` <span class="marker-inferred">inferred</span>` : '';
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

function componentRows(result: ParseSuccess): Markup {
  const c = result.components;
  const sitePath =
    c.sitePath === undefined
      ? html`<em>not known from this link</em>`
      : c.sitePath.value === ''
        ? html`<em>(root site)</em>`
        : html`<code>${c.sitePath.value}</code>`;
  const folders =
    c.folders === undefined
      ? html`<em>not known from this link</em>`
      : c.folders.value.length === 0
        ? html`<em>(library root)</em>`
        : html`<ol class="folder-chain">${c.folders.value.map((f) => html`<li><code>${f}</code></li>`)}</ol>`;
  return html`<dl class="components">
      <div><dt>Tenant</dt><dd>${c.tenant.value === '' ? html`<em>none (consumer service)</em>` : html`<code>${c.tenant.value}</code>`}${inferredMarker(c.tenant)}</dd></div>
      <div><dt>Host</dt><dd><code>${c.host.value}</code>${inferredMarker(c.host)}</dd></div>
      <div><dt>Site</dt><dd>${sitePath}${inferredMarker(c.sitePath)}</dd></div>
      <div><dt>Document library</dt><dd>${
        c.library === undefined
          ? html`<em>not known from this link</em>`
          : html`<code>${c.library.value}</code>${inferredMarker(c.library)} <span class="reason">(${c.library.reason})</span>`
      }</dd></div>
      <div><dt>Folder chain</dt><dd>${folders}${inferredMarker(c.folders)}</dd></div>
      ${c.fileName !== undefined ? html`<div><dt>File name</dt><dd><code>${c.fileName.value}</code>${inferredMarker(c.fileName)}</dd></div>` : ''}
    </dl>`;
}

function extras(result: ParseSuccess): Markup {
  return html`${
    result.identifiers.length > 0
      ? html`<h3>Identifiers in the link</h3>
    <dl class="components identifiers">
      ${result.identifiers.map((i) => html`<div><dt>${i.label}</dt><dd><code>${i.value}</code>${i.flag === 'Inferred' ? html` <span class="marker-inferred">inferred</span>` : ''}</dd></div>`)}
    </dl>`
      : ''
  }${
    result.hints.length > 0
      ? html`<h3>Hints</h3>
    <ul class="hints">
      ${result.hints.map((h) => html`<li><strong>${h.value}</strong> <span class="reason">(${h.label})</span></li>`)}
    </ul>`
      : ''
  }${
    result.wrappers.length > 0
      ? html`<h3>Wrappers removed</h3>
    <ol class="wrappers">
      ${result.wrappers.map((w) => html`<li><strong>${WRAPPER_LABELS[w.type] ?? w.type}</strong>: <code class="wrap">${w.original}</code></li>`)}
    </ol>`
      : ''
  }`;
}

export function renderResult(result: ParseSuccess): Markup {
  const head = html`<div class="result-head">
      <h2 id="result-heading">Result</h2>
      ${stateBadge(result.state)}
      <span class="form-name">form: <code>${result.form}</code></span>
    </div>`;

  if (result.state === 'Unresolved') {
    return html`<section class="result result-unresolved" aria-labelledby="result-heading">
    ${head}
    <p class="method"><strong>What was recognised:</strong> ${result.method.text}</p>
    <p class="unresolved-note">No path is shown because it is not known. Nothing below is a guess at the folder.</p>
    <h3>Components read from the link</h3>
    ${componentRows(result)}
    ${extras(result)}
    <p class="next-step"><strong>Next step:</strong> ${UNRESOLVED_NEXT_STEP}</p>
  </section>`;
  }

  return html`<section class="result" aria-labelledby="result-heading">
    ${head}
    <dl class="result-rows">
      ${result.path !== undefined ? valueRow('Path', 'path', result.path, false) : ''}
      ${result.folderUrl !== undefined ? valueRow('Folder URL', 'folder-url', result.folderUrl, true) : ''}
      ${result.fileUrl !== undefined ? valueRow('File URL', 'file-url', result.fileUrl, true) : ''}
    </dl>
    <h3>Components</h3>
    ${componentRows(result)}
    ${extras(result)}
    <p class="method"><strong>How this was obtained:</strong> ${result.method.text}</p>
  </section>`;
}

export interface FailureViewOptions {
  /** Offer the "keep in history" action with this input (conversion page only). */
  keepInput?: string;
  /** Set when the failure was already kept as this history entry. */
  keptAs?: number;
}

export function renderFailure(failure: ParseFailure, options: FailureViewOptions = {}): Markup {
  return html`<section class="failure" role="alert">
    <h2>Could not convert this link</h2>
    <p>${failure.message}</p>
    <p class="reason-code">Reason code: <code>${failure.reason}</code></p>
    ${
      options.keptAs !== undefined
        ? html`<p class="saved">Kept in history as <a href="/history/${options.keptAs}">entry ${options.keptAs}</a> (a failure with no state).</p>`
        : options.keepInput !== undefined
          ? html`<form method="post" action="/convert" class="keep-form">
      <input type="hidden" name="link" value="${options.keepInput}">
      <input type="hidden" name="keep" value="1">
      <button type="submit" class="secondary">Keep this in history anyway</button>
    </form>`
          : ''
    }
  </section>`;
}
