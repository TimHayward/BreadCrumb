/**
 * Popup (BC-043 to BC-046): asks the content script for citations, lists
 * them with folder and state, and submits the selected ones to the API.
 */
import { surfaceOf } from './hosts.js';
import type { ContentToPopup, ExtractResponse, PopupToContent, ProbeResponse, SampleResponse } from './messages.js';
import { applyLookup, buildRows, describeRow, followUntilVerified, lookupRows, pathSegments, submitRows, verificationUrl, type PopupRow } from './popupModel.js';
import { confirmWithSession } from './session.js';
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

function badge(state: PopupRow['state'], label: string = state): HTMLElement {
  const symbols: Record<PopupRow['state'], string> = { Verified: '●', Derived: '◆', Inferred: '◈', Unresolved: '○', failed: '✕' };
  // The symbol repeats the state for colour-blind users; screen readers get the word only.
  return el('span', { class: `badge badge-${state.toLowerCase()}` }, el('span', { 'aria-hidden': 'true' }, symbols[state]), ` ${label}`);
}

async function askContent<T extends ContentToPopup>(tabId: number, message: PopupToContent): Promise<T> {
  return (await chrome.tabs.sendMessage(tabId, message)) as T;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Decorative 16px line icons (hidden from assistive technology; the link text carries the meaning). */
const ICONS = {
  link: ['M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71', 'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71'],
  folder: ['M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z'],
  history: ['M3 12a9 9 0 1 0 3-6.7L3 8', 'M3 3v5h5', 'M12 7v5l3 2'],
} as const;

function icon(name: keyof typeof ICONS): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', width: '16', height: '16', 'aria-hidden': 'true', focusable: 'false', class: 'icon' })) {
    svg.setAttribute(k, v);
  }
  for (const d of ICONS[name]) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

/** A link that opens in a new tab: the visible text starts the accessible name (WCAG 2.5.3). */
function tabLink(url: string, text: string, iconName: keyof typeof ICONS, context: string): HTMLAnchorElement {
  const link = el('a', { href: url, class: 'row-link', 'aria-label': `${text}: ${context} (opens a new tab)` }, icon(iconName), el('span', {}, text));
  link.addEventListener('click', (event) => {
    event.preventDefault();
    void chrome.tabs.create({ url });
  });
  return link;
}

/** A path that wraps between segments, never inside a folder or file name unless it must. */
function pathText(path: string): HTMLElement {
  const node = el('span', { class: 'path' });
  for (const segment of pathSegments(path)) {
    node.append(segment, el('wbr'));
  }
  return node;
}

function renderRow(row: PopupRow, baseUrl: string | undefined): HTMLLIElement {
  const view = describeRow(row);
  const locationId = `${row.key}-location`;

  const checkbox = el('input', { type: 'checkbox', id: row.key, class: 'row-select', 'aria-describedby': locationId });
  checkbox.checked = row.selected;
  checkbox.disabled = view.failed;
  checkbox.addEventListener('change', () => {
    row.selected = checkbox.checked;
  });
  const name = el('label', { for: row.key, class: 'row-name' }, row.label);

  let location: HTMLElement;
  if (view.failed) {
    // No location heading: the row says why the link cannot be converted.
    location = el('p', { class: 'row-location location-note failed', id: locationId }, view.locationNote ?? '');
  } else {
    const term = el('dt', {}, view.locationLabel);
    if (view.libraryInferred) {
      term.append(' ', el('span', { class: 'marker-inferred', title: 'The document library boundary was guessed from the path.' }, 'library inferred'));
    }
    location = el(
      'dl',
      { class: 'row-location', id: locationId },
      term,
      view.location !== undefined ? el('dd', {}, pathText(view.location)) : el('dd', { class: 'location-note' }, view.locationNote ?? ''),
    );
  }

  const item = el('li', { class: `row${view.failed ? ' row-failed' : ''}` }, checkbox, name, badge(view.state, view.stateLabel), location);

  const links = el('div', { class: 'row-links' });
  if (!view.failed) {
    links.append(tabLink(view.originalUrl, 'Original link', 'link', row.label));
  }
  if (view.folderUrl !== undefined) {
    links.append(tabLink(view.folderUrl, 'Folder link', 'folder', row.label));
  }
  if (view.entryId !== undefined && baseUrl !== undefined) {
    links.append(tabLink(`${baseUrl}/history/${view.entryId}`, 'In BreadCrumb', 'history', `${row.label}, entry ${view.entryId}`));
  }
  if (links.childElementCount > 0) {
    item.append(links);
  }

  if (view.notes.length > 0) {
    const notes = el('ul', { class: 'row-notes' });
    for (const note of view.notes) {
      notes.append(el('li', { class: `tone-${note.tone}`, ...(note.detail !== undefined ? { title: note.detail } : {}) }, note.text));
    }
    item.append(notes);
  }
  return item;
}

function renderRows(rows: PopupRow[], baseUrl: string | undefined, tabId: number, surfaceNote?: string, notice?: string): void {
  main.replaceChildren();
  if (notice !== undefined) {
    main.append(el('p', { class: 'notice', role: 'status' }, notice));
  }
  if (surfaceNote !== undefined) {
    main.append(el('p', { class: 'note' }, surfaceNote));
  }
  const list = el('ul', { class: 'rows', 'aria-label': 'Cited files' });
  for (const row of rows) {
    list.append(renderRow(row, baseUrl));
  }
  main.append(list);

  const actions = el('div', { class: 'actions sticky' });
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
    const sentRows = rows.filter((row) => row.outcome?.ok === true);
    const sent = sentRows.length;
    const pending = sentRows.filter((row) => row.known?.verified !== true).length;
    let notice: string | undefined;
    if (sent > 0 && pending === 0) {
      notice = `Sent ${sent}, all Verified with your SharePoint session.`;
    } else if (pending > 0) {
      // The rest are verified with Microsoft Graph in BreadCrumb's own pages (decision D3):
      // a background tab verifies the new entries and closes itself.
      const confirmedCount = sent - pending;
      const lead = confirmedCount > 0 ? `Sent ${sent}; ${confirmedCount} Verified with your SharePoint session.` : `Sent ${sent}.`;
      try {
        await chrome.tabs.create({ url: verificationUrl(baseUrl), active: false });
        notice = `${lead} BreadCrumb is verifying the other ${pending} in a background tab, which closes itself when done. If it stays open, switch to it: you may need to sign in to Microsoft there.`;
      } catch (error) {
        notice = `${lead} Open BreadCrumb's history to verify the other ${pending} (${error instanceof Error ? error.message : String(error)}).`;
      }
    }
    renderRows(rows, baseUrl, tabId, surfaceNote, notice);
    if (pending > 0) {
      const outcome = await followUntilVerified(rows, baseUrl, () => renderRows(rows, baseUrl, tabId, surfaceNote, notice));
      if (outcome === 'verified') {
        renderRows(rows, baseUrl, tabId, surfaceNote, `Sent ${sent} and all are Verified.`);
      }
    }
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
  const surfaceNote = surface === 'consumer' ? 'Links found in the response text on the consumer surface.' : undefined;
  renderRows(rows, baseUrl, tab.id, surfaceNote);
  let lookupNotice: string | undefined;
  // Show what BreadCrumb already knows (a Verified folder, the entry number); unticks documents it already has.
  if (baseUrl !== undefined) {
    const answers = await lookupRows(rows, baseUrl);
    if (answers !== undefined && answers.some((answer) => answer.found)) {
      applyLookup(rows, answers, { untickKnown: true });
      const kept = rows.filter((row) => row.known !== undefined).length;
      lookupNotice = `${kept} of ${rows.length} already in BreadCrumb (unticked).`;
      renderRows(rows, baseUrl, tab.id, surfaceNote, lookupNotice);
    }
  }
  // BC-049: confirm the rest with the browser's SharePoint session, where the user granted access.
  await confirmWithSession(rows, {
    fetchImpl: (url, init) => fetch(url, init),
    hasPermission: (host) => chrome.permissions.contains({ origins: [`https://${host}/*`] }),
  });
  const confirmed = rows.filter((row) => row.session?.ok === true).length;
  const noAccess = rows.some((row) => row.session?.ok === false && row.session.reason === 'no-access');
  void reportToServer(baseUrl, 'extension-session', {
    rows: rows.map((row) => ({ form: row.result.ok ? row.result.form : 'failed', session: row.session === undefined ? null : row.session.ok ? 'confirmed' : `${row.session.reason}: ${row.session.message}` })),
  });
  if (confirmed > 0 || noAccess) {
    const parts = lookupNotice === undefined ? [] : [lookupNotice];
    if (confirmed > 0) parts.push(`${confirmed} confirmed with your SharePoint session.`);
    if (noAccess) parts.push('Allow your tenant on the options page to confirm the others instantly.');
    renderRows(rows, baseUrl, tab.id, surfaceNote, parts.join(' '));
  }
}

void start();
