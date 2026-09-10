import type { ConversionOutcome } from '../services/conversionService.js';
import { html } from './html.js';
import { layout, type ViewContext } from './layout.js';
import { renderFailure, renderResult } from './resultView.js';

export interface ConvertPageOptions {
  input: string;
  outcome?: ConversionOutcome;
  context: ViewContext;
}

export function renderConvertPage(options: ConvertPageOptions): string {
  const outcome = options.outcome;
  const authConfigured = options.context.auth !== undefined;
  let resultMarkup = html``;
  if (outcome !== undefined) {
    resultMarkup = outcome.ok
      ? html`${renderResult(outcome.result, { id: outcome.id, authConfigured })}
      <p class="saved">Saved to history as <a href="/history/${outcome.id}">entry ${outcome.id}</a>.</p>`
      : renderFailure(outcome.failure, outcome.id !== undefined ? { keptAs: outcome.id } : { keepInput: options.input });
  }
  const body = html`<h1>Convert a link</h1>
    <p class="lede">Paste a SharePoint or OneDrive link to see the folder it points at. Every conversion is kept in <a href="/history">history</a>.</p>
    <form method="post" action="/convert" class="convert-form">
      <label for="link">Link</label>
      <input id="link" name="link" type="url" inputmode="url" required autocomplete="off" spellcheck="false" value="${options.input}" placeholder="https://contoso.sharepoint.com/sites/SiteA/Lib/Forms/AllItems.aspx?id=...">
      <button type="submit">Convert</button>
    </form>
    <div id="result-region" aria-live="polite">
      ${resultMarkup}
    </div>`;
  return layout({ title: 'Convert', active: 'convert', body, context: options.context });
}
