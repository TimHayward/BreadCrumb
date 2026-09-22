/**
 * Popup (BC-043 to BC-046, BC-049, BC-052): asks the content script for
 * citations, lists each one with its document location and state, confirms
 * what it can with the browser's SharePoint session, and copies links to the
 * clipboard. There is no BreadCrumb server to send anything to.
 */
import { surfaceOf } from './hosts.js';
import type { ContentToPopup, ExtractResponse, PopupToContent, ProbeResponse, SampleResponse } from './messages.js';
import { appendRows, rowsForClipboard } from './noteWriter.js';
import {
  buildRows,
  clipboardText,
  copySummary,
  describeRow,
  noteRowsFor,
  pathSegments,
  recordNoteOutcomes,
  selectedFileLinks,
  selectedFolderLinks,
  sendSummary,
  type PopupRow,
} from './popupModel.js';
import { confirmWithSession } from './session.js';
import { getObsidianSettings } from './settings.js';
import { loadVaultHandle, obsidianUri, readNote, vaultPermission, writeNote } from './vault.js';

const main = document.getElementById('main') as HTMLElement;

/** Where a send would write, read once when the popup opens so the bar can name it (BC-069). */
let obsidianTarget: { notePath: string; vaultName?: string } | undefined;

/** Reads the configured vault and note, and says whether there is one to name. */
async function resolveObsidianTarget(): Promise<boolean> {
  try {
    const [settings, vault] = await Promise.all([getObsidianSettings(), loadVaultHandle()]);
    if (vault === undefined) {
      return false;
    }
    obsidianTarget = { notePath: settings.notePath, vaultName: settings.vaultName ?? vault.name };
    return true;
  } catch {
    return false;
  }
}

function targetLine(): HTMLElement {
  if (obsidianTarget === undefined) {
    return el('p', { class: 'note actions-target' }, 'Choose your Obsidian vault folder in Options before sending.');
  }
  const where = obsidianTarget.vaultName === undefined ? obsidianTarget.notePath : `${obsidianTarget.notePath} in ${obsidianTarget.vaultName}`;
  return el('p', { class: 'note actions-target' }, `Rows go to ${where}.`);
}
/** Visually hidden live region: tells screen reader users what a copy did. */
const announcer = document.getElementById('announcer') as HTMLElement;

function announce(text: string): void {
  announcer.textContent = '';
  // A fresh text node after clearing makes repeated identical messages announce again.
  setTimeout(() => {
    announcer.textContent = text;
  }, 50);
}

async function copyToClipboard(text: string): Promise<string | undefined> {
  try {
    await navigator.clipboard.writeText(text);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

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
  check: ['M20 6 9 17l-5-5'],
  link: ['M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71', 'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71'],
  folder: ['M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z'],
  note: ['M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z', 'M14 3v5h5'],
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

/**
 * A row action that copies a link: same look and place as a link, but a
 * button, because it acts rather than navigates. The label reads "Copied"
 * for a moment and the live region says what was copied.
 */
function copyButton(url: string, text: string, iconName: keyof typeof ICONS, context: string): HTMLButtonElement {
  // Both labels share one grid cell, so the button keeps its width and the links beside it never move.
  const label = el('span', { class: 'swap' }, el('span', { class: 'swap-idle' }, text), el('span', { class: 'swap-done' }, 'Copied'));
  const button = el('button', { type: 'button', class: 'row-link', 'aria-label': `Copy ${text.toLowerCase()}: ${context}`, title: url }, icon(iconName), label);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const show = (copied: boolean): void => {
    button.classList.toggle('copied', copied);
    button.querySelector('svg')?.replaceWith(icon(copied ? 'check' : iconName));
  };
  button.addEventListener('click', async () => {
    const failure = await copyToClipboard(url);
    if (failure !== undefined) {
      announce(`Could not copy the ${text.toLowerCase()}: ${failure}`);
      return;
    }
    announce(`${text} copied for ${context}.`);
    clearTimeout(timer);
    show(true);
    timer = setTimeout(() => show(false), 1500);
  });
  return button;
}

/** A path that wraps between segments, never inside a folder or file name unless it must. */
function pathText(path: string): HTMLElement {
  const node = el('span', { class: 'path' });
  for (const segment of pathSegments(path)) {
    node.append(segment, el('wbr'));
  }
  return node;
}

function renderRow(row: PopupRow): HTMLLIElement {
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
    links.append(copyButton(view.originalUrl, 'Original link', 'link', row.label));
  }
  if (view.folderUrl !== undefined) {
    links.append(copyButton(view.folderUrl, 'Folder link', 'folder', row.label));
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

/**
 * BC-067: appends the ticked rows to the configured note. The note is read
 * and written back in one step; nothing outside its table changes, and a
 * failure leaves the note untouched.
 */
interface SendResult {
  ok: boolean;
  message: string;
  /** Set when rows were written: an `obsidian://` link that opens the note. */
  openUri?: string;
}

async function sendToObsidian(rows: PopupRow[]): Promise<SendResult> {
  const settings = await getObsidianSettings();
  const vault = await loadVaultHandle();
  if (vault === undefined) {
    return { ok: false, message: 'No vault folder is set. Open Options and choose your Obsidian vault folder first.' };
  }
  if ((await vaultPermission(vault)) !== 'granted') {
    // Asking for the grant needs a top level page: the popup would close under the prompt.
    return { ok: false, message: `The browser needs you to allow access to "${vault.name}" again. Open Options and choose the folder once more.` };
  }
  const selection = noteRowsFor(rows, new Date());
  if (selection.rows.length === 0) {
    const why =
      selection.skipped.length === 0 ? 'Tick at least one file first.' : `Nothing could be written: every ticked file was left out because ${[...new Set(selection.skipped.map((s) => s.reason))].join('; ')}.`;
    // Only the skipped rows are marked here, each with its own reason; there are no written rows to mark.
    recordNoteOutcomes(selection, { ok: false, reason: 'nothing was written' });
    return { ok: false, message: why };
  }
  try {
    const current = await readNote(vault, settings.notePath);
    const outcome = appendRows({ rows: selection.rows, now: new Date(), ...(current === undefined ? {} : { current }) });
    if (!outcome.ok) {
      recordNoteOutcomes(selection, { ok: false, reason: 'the table in that note has different columns' });
      return { ok: false, message: outcome.message };
    }
    await writeNote(vault, settings.notePath, outcome.text);
    recordNoteOutcomes(selection, { ok: true, notePath: settings.notePath });
    return { ok: true, message: sendSummary(outcome, selection.skipped, settings.notePath), openUri: obsidianUri(settings.vaultName ?? vault.name, settings.notePath) };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    recordNoteOutcomes(selection, { ok: false, reason });
    return { ok: false, message: `Could not write ${settings.notePath}: ${reason}. The note was not changed.` };
  }
}

function renderRows(rows: PopupRow[], tabId: number, surfaceNote?: string, notice?: string): void {
  main.replaceChildren();
  if (notice !== undefined) {
    main.append(el('p', { class: 'notice', role: 'status' }, notice));
  }
  if (surfaceNote !== undefined) {
    main.append(el('p', { class: 'note' }, surfaceNote));
  }
  const list = el('ul', { class: 'rows', 'aria-label': 'Cited files' });
  for (const row of rows) {
    list.append(renderRow(row));
  }
  main.append(list);

  const actions = el('div', { class: 'actions sticky' });
  const send = el('button', { type: 'button', class: 'send-action' }, 'Send selected to Obsidian');
  const copyFiles = el('button', { type: 'button', class: 'secondary' }, 'Copy selected file links');
  const copyFolders = el('button', { type: 'button', class: 'secondary' }, 'Copy selected folder links');
  const status = el('p', { class: 'note actions-status', role: 'status' });
  send.addEventListener('click', async () => {
    send.disabled = true;
    status.textContent = 'Writing to your note…';
    const outcome = await sendToObsidian(rows);
    send.disabled = false;
    // Re-render so every row shows its own outcome, and keep the summary above the list.
    renderRows(rows, tabId, surfaceNote, outcome.message);
    if (outcome.openUri !== undefined) {
      const open = el('a', { class: 'row-link', href: outcome.openUri }, icon('note'), el('span', {}, 'Open the note in Obsidian'));
      document.querySelector('.actions-status')?.replaceChildren(open);
    }
    // The list was rebuilt under the keyboard: put focus back where it was.
    (document.querySelector('.send-action') as HTMLButtonElement | null)?.focus();
  });
  const copySelected = async (kind: 'file' | 'folder'): Promise<void> => {
    const selection = kind === 'file' ? selectedFileLinks(rows) : selectedFolderLinks(rows);
    if (selection.links.length > 0) {
      const failure = await copyToClipboard(clipboardText(selection));
      if (failure !== undefined) {
        status.textContent = `Could not copy to the clipboard: ${failure}`;
        return;
      }
    }
    status.textContent = copySummary(kind, selection);
  };
  copyFiles.addEventListener('click', () => void copySelected('file'));
  copyFolders.addEventListener('click', () => void copySelected('folder'));
  const copyRows = el('button', { type: 'button', class: 'row-link text-action' }, 'Copy as table rows');
  copyRows.addEventListener('click', async () => {
    const selection = noteRowsFor(rows, new Date());
    if (selection.rows.length === 0) {
      status.textContent = 'Nothing to copy: tick a file whose location is known.';
      return;
    }
    const failure = await copyToClipboard(rowsForClipboard(selection.rows, { withHeader: true }));
    status.textContent = failure === undefined ? `Copied ${selection.rows.length} table rows with their header.` : `Could not copy to the clipboard: ${failure}`;
  });
  actions.append(targetLine(), send, copyFiles, copyFolders, copyRows, status);
  main.append(actions);
}

function renderEmpty(kind: 'work' | 'consumer', tabId: number, strategy: string): void {
  main.replaceChildren();
  const box = el('div', { class: 'empty' });
  if (kind === 'consumer') {
    box.append(
      el('h2', {}, 'No SharePoint or OneDrive citations here'),
      el('p', {}, 'Copilot on this site cites web pages. SharePoint and OneDrive file citations appear only on the work surfaces (m365.cloud.microsoft and copilot.cloud.microsoft).'),
    );
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

/** "Diagnose this page" (spike S1): probe the page's markup and copy the report (decision D22). */
function setupDiagnostics(tabId: number): void {
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
    const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;
    const found = `Found ${plural(report.hits.length, 'Microsoft 365 link')}, ${plural(report.citationLike.length, 'citation chip')} without a link and ${plural(report.iframes.length, 'iframe')}.`;
    status.textContent = `${found}${copied ? ' The report is on the clipboard: paste it into an issue.' : ' The report could not be copied to the clipboard.'}`;
    button.disabled = false;
  });
  footer.replaceChildren(button, status);
}

async function start(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined || tab.url === undefined) {
    main.replaceChildren(el('p', {}, 'Open a Copilot page and try again.'));
    return;
  }
  const surface = surfaceOf(new URL(tab.url).hostname);
  if (surface === 'other') {
    main.replaceChildren(el('p', {}, 'BreadCrumb works on m365.cloud.microsoft, copilot.cloud.microsoft and copilot.microsoft.com. Open a Copilot response there.'));
    return;
  }
  setupDiagnostics(tab.id);
  let extracted: ExtractResponse;
  try {
    extracted = await askContent<ExtractResponse>(tab.id, { type: 'breadcrumb:extract' });
  } catch (error) {
    main.replaceChildren(el('p', {}, `The page did not answer (${error instanceof Error ? error.message : String(error)}). Reload the Copilot page and open the popup again.`));
    return;
  }
  const rows = buildRows(extracted.citations);
  if (rows.length === 0) {
    renderEmpty(surface, tab.id, extracted.strategy);
    return;
  }
  const surfaceNote = surface === 'consumer' ? 'Links found in the response text on the consumer surface.' : undefined;
  const tabId = tab.id;
  renderRows(rows, tabId, surfaceNote);
  // Where a send would go, resolved in the background: the citation list never waits on the vault.
  void resolveObsidianTarget().then((found) => {
    if (found) {
      renderRows(rows, tabId, surfaceNote);
    }
  });
  // BC-049: confirm what we can with the browser's SharePoint session, where the user granted access.
  await confirmWithSession(rows, {
    fetchImpl: (url, init) => fetch(url, init),
    hasPermission: (host) => chrome.permissions.contains({ origins: [`https://${host}/*`] }),
  });
  const confirmed = rows.filter((row) => row.session?.ok === true).length;
  const noAccess = rows.some((row) => row.session?.ok === false && row.session.reason === 'no-access');
  if (confirmed > 0 || noAccess) {
    const parts: string[] = [];
    if (confirmed > 0) parts.push(`${confirmed} confirmed with your SharePoint session.`);
    if (noAccess) parts.push('Allow your tenant on the options page to confirm the others instantly.');
    renderRows(rows, tab.id, surfaceNote, parts.join(' '));
  }
}

void start();
