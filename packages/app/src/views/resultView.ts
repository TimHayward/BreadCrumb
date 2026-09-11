/**
 * Renders a parser result (BC-023, BC-025, BC-026) and, once validated, the
 * Verified result with the original beneath it (BC-037, BC-040). Used
 * identically by the conversion page and the history detail page (BC-031).
 */
import type { Component, ConfidenceState, ParseFailure, ParseSuccess } from '@breadcrumb/parser';
import { UNRESOLVED_VALIDATABLE_FORMS, isValidatable } from '../validation/graphValidation.js';
import type { ValidationRecord, VerifiedResult } from '../validation/types.js';
import { formatTime } from './format.js';
import { Markup, breakableUrl, html } from './html.js';

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

export const UNRESOLVED_NEXT_STEP_CONFIGURED =
  'Sign in to Microsoft: sharing links resolve automatically once you are signed in, and the Validate with Microsoft Graph button does the same on demand. The result is kept in history with its Unresolved state until then.';

export const UNRESOLVED_NEXT_STEP_UNCONFIGURED =
  'Authenticated validation is not configured on this server, so this stays Unresolved. The result is kept in history and can be validated once sign in is set up.';

export function stateBadge(state: ConfidenceState): Markup {
  return html`<span class="badge badge-${state.toLowerCase()}" title="${STATE_HELP[state]}"><span aria-hidden="true">${STATE_SYMBOLS[state]}</span> ${state}</span>`;
}

function inferredMarker(component: Component<unknown> | undefined): Markup | '' {
  return component?.flag === 'Inferred' ? html` <span class="marker-inferred">inferred</span>` : '';
}

const confirmedMarker = html` <span class="marker-confirmed">confirmed</span>`;

function copyButton(value: string, label: string): Markup {
  return html`<button type="button" class="copy" data-copy="${value}" aria-label="Copy ${label}">Copy</button>`;
}

function valueRow(label: string, id: string, value: string, link: boolean): Markup {
  const content = link
    ? html`<a href="${value}" target="_blank" rel="noopener noreferrer">${breakableUrl(value)}</a>`
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

export interface ResultViewOptions {
  /** History entry id; enables the validate control and embeds the result for the browser. */
  id?: number;
  /** Newest validation of the entry, when it has been upgraded. */
  validation?: ValidationRecord | null;
  /** Whether Microsoft sign in is configured on this server. */
  authConfigured?: boolean;
}

/** The validate control, hidden until the browser confirms a signed in account (BC-036). */
function validateControl(result: ParseSuccess, id: number): Markup {
  // Unresolved links the validator can attempt (sharing tokens, document ids) resolve on their own once signed in.
  const auto = result.state === 'Unresolved' && UNRESOLVED_VALIDATABLE_FORMS.has(result.form);
  return html`<div class="validate" data-validate-id="${id}" data-previous-state="${result.state}"${auto ? html` data-auto="1"` : ''} hidden>
      <script type="application/json" class="result-json">${new Markup(JSON.stringify(result).replaceAll('<', '\\u003c'))}</script>
      <button type="button" class="validate-button">Validate with Microsoft Graph</button>
      <p class="validate-status" role="status" aria-live="polite"></p>
    </div>`;
}

function wasMarker(correction: { was: string } | undefined, kind: string): Markup | '' {
  return correction === undefined ? '' : html`<div class="was">was ${kind} as <code>${correction.was === '' ? '(root site)' : correction.was}</code></div>`;
}

function renderVerified(result: ParseSuccess, validation: ValidationRecord): Markup {
  const v: VerifiedResult = validation.verified;
  const c = v.components;
  const previousKind = validation.previousState === 'Inferred' ? 'inferred' : validation.previousState === 'Unresolved' ? 'unresolved, unknown' : 'derived';
  return html`<section class="result result-verified" aria-labelledby="result-heading">
    <div class="result-head">
      <h2 id="result-heading">Result</h2>
      ${stateBadge('Verified')}
      <span class="marker-upgraded">upgraded from ${validation.previousState}</span>
      <span class="form-name">form: <code>${result.form}</code></span>
    </div>
    <dl class="result-rows">
      ${valueRow('Path', 'path', v.path, false)}
      ${valueRow('Folder URL', 'folder-url', v.folderUrl, true)}
      ${v.fileUrl !== undefined ? valueRow('File URL', 'file-url', v.fileUrl, true) : ''}
    </dl>
    <h3>Components</h3>
    <dl class="components">
      <div><dt>Tenant</dt><dd><code>${c.tenant}</code>${confirmedMarker}</dd></div>
      <div><dt>Host</dt><dd><code>${c.host}</code>${confirmedMarker}</dd></div>
      <div><dt>Site</dt><dd>${c.sitePath === '' ? html`<em>(root site)</em>` : html`<code>${c.sitePath}</code>`}${confirmedMarker}${wasMarker(v.corrections.sitePath, previousKind)}</dd></div>
      <div><dt>Document library</dt><dd><code>${c.library}</code>${confirmedMarker}${wasMarker(v.corrections.library, previousKind)}</dd></div>
      <div><dt>Folder chain</dt><dd>${
        c.folders.length === 0 ? html`<em>(library root)</em>` : html`<ol class="folder-chain">${c.folders.map((f) => html`<li><code>${f}</code></li>`)}</ol>`
      }${confirmedMarker}${wasMarker(v.corrections.folders, previousKind)}</dd></div>
      ${c.fileName !== undefined ? html`<div><dt>File name</dt><dd><code>${c.fileName}</code>${confirmedMarker}${wasMarker(v.corrections.fileName, previousKind)}</dd></div>` : ''}
    </dl>
    ${
      v.identifierCheck !== undefined
        ? html`<p class="id-check ${v.identifierCheck.matches ? 'id-match' : 'id-mismatch'}"><strong>Document id check:</strong> the link's id <code>${v.identifierCheck.linkValue}</code> ${
            v.identifierCheck.matches ? 'matches' : 'does not match'
          } the item's list item unique id <code>${v.identifierCheck.graphValue}</code>.</p>`
        : ''
    }
    <p class="method"><strong>How this was obtained:</strong> ${v.methodText} Confirmed at <time datetime="${v.validatedAt}">${formatTime(v.validatedAt)}</time>. Graph item <code>${v.graph.itemId}</code> in drive <code>${v.graph.driveId}</code>. Calls: ${v.calls.join(', ')}.</p>
    <details class="original">
      <summary>Original best effort result (${validation.previousState})</summary>
      ${result.state !== 'Unresolved' && result.path !== undefined ? html`<p>Path: <code>${result.path}</code></p>` : ''}
      ${componentRows(result)}
      <p class="method"><strong>Original method:</strong> ${result.method.text}</p>
    </details>
  </section>`;
}

export function renderResult(result: ParseSuccess, options: ResultViewOptions = {}): Markup {
  if (options.validation !== undefined && options.validation !== null) {
    return renderVerified(result, options.validation);
  }
  const head = html`<div class="result-head">
      <h2 id="result-heading">Result</h2>
      ${stateBadge(result.state)}
      <span class="form-name">form: <code>${result.form}</code></span>
    </div>`;
  const validate = options.id !== undefined && options.authConfigured && isValidatable(result) ? validateControl(result, options.id) : '';

  if (result.state === 'Unresolved') {
    return html`<section class="result result-unresolved" aria-labelledby="result-heading">
    ${head}
    <p class="method"><strong>What was recognised:</strong> ${result.method.text}</p>
    <p class="unresolved-note">No path is shown because it is not known. Nothing below is a guess at the folder.</p>
    <h3>Components read from the link</h3>
    ${componentRows(result)}
    ${extras(result)}
    <p class="next-step"><strong>Next step:</strong> ${options.authConfigured ? UNRESOLVED_NEXT_STEP_CONFIGURED : UNRESOLVED_NEXT_STEP_UNCONFIGURED}</p>
    ${validate}
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
    ${validate}
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
