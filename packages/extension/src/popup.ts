/**
 * Popup (BC-043 to BC-046): asks the content script for citations, lists
 * them with folder and state, and submits the selected ones to the API.
 */
import { surfaceOf } from './hosts.js';
import type { ContentToPopup, ExtractResponse, PopupToContent, ProbeResponse, SampleResponse } from './messages.js';
import { buildRows, submitRows, type PopupRow } from './popupModel.js';
import { getApiBaseUrl } from './storage.js';

const main = document.getElementById('main') as HTMLElement;
const optionsLink = document.getElementById('options-link') as HTMLAnchorElement;
optionsLink.addEventListener('click', (event) => {
  event.preventDefault();
  void chrome.runtime.openOptionsPage();
});

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...children: Array<Node | string>): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    node.setAttribute(k, v);
  }
  node.append(...children);
  return node;
}

function badge(state: PopupRow['state']): HTMLElement {
  const symbols: Record<PopupRow['state'], string> = { Verified: '●', Derived: '◆', Inferred: '◈', Unresolved: '○', failed: '✕' };
  return el('span', { class: `badge badge-${state.toLowerCase()}` }, `${symbols[state]} ${state}`);
}

async function askContent<T extends ContentToPopup>(tabId: number, message: PopupToContent): Promise<T> {
  return (await chrome.tabs.sendMessage(tabId, message)) as T;
}

function renderRows(rows: PopupRow[], baseUrl: string | undefined, tabId: number, surfaceNote?: string): void {
  main.replaceChildren();
  if (surfaceNote !== undefined) {
    main.append(el('p', { class: 'note' }, surfaceNote));
  }
  const list = el('ul', { class: 'rows' });
  for (const row of rows) {
    const checkbox = el('input', { type: 'checkbox', id: row.key, 'aria-label': `Select ${row.label}` });
    checkbox.checked = row.selected;
    checkbox.disabled = !row.result.ok;
    checkbox.addEventListener('change', () => {
      row.selected = checkbox.checked;
    });
    const label = el('label', { for: row.key, class: 'label' }, row.label);
    const folder = el('div', { class: 'folder' }, row.folder ?? (row.state === 'Unresolved' ? 'folder unknown until validated in BreadCrumb' : row.result.ok ? '' : row.result.message));
    const meta = el('div', { class: 'meta' }, badge(row.state));
    if (row.libraryInferred) {
      meta.append(el('span', { class: 'marker-inferred' }, 'library inferred'));
    }
    if (row.state === 'Unresolved') {
      meta.append(el('span', { class: 'note' }, 'needs validation in the web application'));
    }
    if (row.outcome !== undefined) {
      meta.append(
        row.outcome.ok
          ? el('span', { class: 'outcome-ok' }, `Sent: entry ${row.outcome.id} (${row.outcome.state})`)
          : el('span', { class: 'outcome-fail' }, row.outcome.message),
      );
    }
    list.append(el('li', { class: 'row' }, checkbox, label, folder, meta));
  }
  main.append(list);

  const actions = el('div', { class: 'actions' });
  const submit = el('button', { type: 'button' }, 'Send selected to BreadCrumb');
  const status = el('span', { class: 'note', role: 'status' });
  submit.addEventListener('click', async () => {
    if (baseUrl === undefined) {
      status.textContent = 'Set the BreadCrumb API base URL in the extension options first (Options link above). Nothing was sent.';
      return;
    }
    submit.disabled = true;
    status.textContent = 'Sending…';
    await submitRows(rows, baseUrl, (url, init) => fetch(url, init));
    renderRows(rows, baseUrl, tabId, surfaceNote);
  });
  actions.append(submit, status);
  main.append(actions);
}

function renderEmpty(kind: 'work' | 'consumer', tabId: number, baseUrl: string | undefined, strategy: string): void {
  main.replaceChildren();
  const box = el('div', { class: 'empty' });
  if (kind === 'consumer') {
    box.append(
      el('h2', {}, 'No SharePoint or OneDrive citations here'),
      el('p', {}, 'Copilot on this site cites web pages. SharePoint and OneDrive file citations appear only on the work surfaces (m365.cloud.microsoft and copilot.cloud.microsoft).'),
    );
    if (baseUrl !== undefined) {
      box.append(el('p', {}, 'Paste a link by hand in ', el('a', { href: `${baseUrl}/`, target: '_blank', rel: 'noopener' }, 'the BreadCrumb web application'), '.'));
    } else {
      box.append(el('p', {}, 'Paste a link by hand in the BreadCrumb web application (set its address in the extension options).'));
    }
  } else {
    box.append(
      el('h2', {}, 'No citations found'),
      el('p', {}, 'No SharePoint or OneDrive links were found in this response. If the response does cite files, the page markup may have changed.'),
      el('p', { class: 'note' }, `Looked in: ${strategy}.`),
    );
    const report = el('button', { type: 'button', class: 'secondary' }, 'Report markup');
    const note = el('span', { class: 'note', role: 'status' });
    report.addEventListener('click', async () => {
      const response = await askContent<SampleResponse>(tabId, { type: 'breadcrumb:sample' });
      await navigator.clipboard.writeText(response.sample);
      note.textContent = 'A redacted sample of the response markup is on the clipboard. Paste it into an issue.';
    });
    box.append(el('div', { class: 'actions' }, report, note));
  }
  main.append(box);
}

type ReportOutcome = 'sent' | 'disabled' | 'unreachable' | 'no-base-url';

/**
 * Posts a diagnostic event to BreadCrumb's log. The server accepts it only
 * when it runs with CLIENT_LOG=true (local diagnosed runs); otherwise this is
 * a harmless 404.
 */
async function reportToServer(baseUrl: string | undefined, event: string, detail: unknown): Promise<ReportOutcome> {
  if (baseUrl === undefined) {
    return 'no-base-url';
  }
  try {
    const response = await fetch(`${baseUrl}/api/client-log`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ event, detail, page: 'extension-popup', at: new Date().toISOString() }),
    });
    return response.ok ? 'sent' : 'disabled';
  } catch {
    return 'unreachable';
  }
}

/** "Diagnose this page" (spike S1): probe the page's markup, send it to the log and copy it. */
function setupDiagnostics(tabId: number, baseUrl: string | undefined): void {
  const footer = document.getElementById('diag');
  if (footer === null) {
    return;
  }
  const button = el('button', { type: 'button', class: 'secondary' }, 'Diagnose this page');
  const status = el('span', { class: 'note', role: 'status' });
  button.addEventListener('click', async () => {
    button.disabled = true;
    status.textContent = 'Inspecting the page…';
    let response: ProbeResponse;
    try {
      response = await askContent<ProbeResponse>(tabId, { type: 'breadcrumb:probe' });
    } catch (error) {
      status.textContent = `The page did not answer (${error instanceof Error ? error.message : String(error)}). Reload it and try again.`;
      button.disabled = false;
      return;
    }
    if (response.report === null) {
      status.textContent = `The probe failed: ${response.error ?? 'unknown error'}.`;
      button.disabled = false;
      return;
    }
    const report = response.report;
    let copied = false;
    try {
      await navigator.clipboard.writeText(JSON.stringify(report, null, 1));
      copied = true;
    } catch {
      copied = false;
    }
    const sent = await reportToServer(baseUrl, 'extension-probe', report);
    const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;
    const found = `Found ${plural(report.hits.length, 'Microsoft 365 link')}, ${plural(report.citationLike.length, 'citation chip')} without a link and ${plural(report.iframes.length, 'iframe')}.`;
    const where =
      sent === 'sent'
        ? ' Sent to the BreadCrumb log.'
        : sent === 'disabled'
          ? ' The BreadCrumb server is not collecting diagnostics (CLIENT_LOG is off).'
          : sent === 'unreachable'
            ? ` Could not reach ${baseUrl ?? 'the API'}.`
            : ' No API base URL is set.';
    status.textContent = `${found}${where}${copied ? ' Copied to the clipboard.' : ''}`;
    button.disabled = false;
  });
  footer.replaceChildren(button, status);
}

async function start(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const baseUrl = await getApiBaseUrl();
  if (tab?.id === undefined || tab.url === undefined) {
    main.replaceChildren(el('p', {}, 'Open a Copilot page and try again.'));
    return;
  }
  const surface = surfaceOf(new URL(tab.url).hostname);
  if (surface === 'other') {
    main.replaceChildren(el('p', {}, 'BreadCrumb works on m365.cloud.microsoft, copilot.cloud.microsoft and copilot.microsoft.com. Open a Copilot response there.'));
    return;
  }
  setupDiagnostics(tab.id, baseUrl);
  let extracted: ExtractResponse;
  try {
    extracted = await askContent<ExtractResponse>(tab.id, { type: 'breadcrumb:extract' });
  } catch (error) {
    main.replaceChildren(el('p', {}, `The page did not answer (${error instanceof Error ? error.message : String(error)}). Reload the Copilot page and open the popup again.`));
    return;
  }
  void reportToServer(baseUrl, 'extension-extract', {
    host: extracted.host,
    surface: extracted.surface,
    strategy: extracted.strategy,
    citations: extracted.citations,
  });
  const rows = buildRows(extracted.citations);
  if (rows.length === 0) {
    renderEmpty(surface, tab.id, baseUrl, extracted.strategy);
    return;
  }
  renderRows(rows, baseUrl, tab.id, surface === 'consumer' ? 'Links found in the response text on the consumer surface.' : undefined);
}

void start();
