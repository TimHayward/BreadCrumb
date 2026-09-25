/**
 * Popup (BC-043 to BC-046, BC-049, BC-052): asks the content script for
 * citations, lists each one with its document location and state, confirms
 * what it can with the browser's SharePoint session, and copies links to the
 * clipboard. There is no BreadCrumb server to send anything to.
 */
import { documentKey } from '@breadcrumb/parser';
import { markSentToNote, recordRows } from './history.js';
import { surfaceOf } from './hosts.js';
import type { ContentToPopup, ExtractResponse, ExtractScope, PopupToContent, ProbeResponse, SampleResponse } from './messages.js';
import { appendRows, rowsForClipboard } from './noteWriter.js';
import {
  addPastedRow,
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

/**
 * A long chat can cite dozens of files. The popup reads the latest answer
 * unless the user asks for the whole conversation, and lists the first
 * handful of rows with the rest one press away.
 */
const FIRST_ROWS = 25;
let scope: ExtractScope = 'latest';
/** The page the popup was opened on, kept with each history entry (BC-055). */
let pageUrl: string | undefined;
/** False on a page with no Copilot answers to read, where only pasting makes sense. */
let canReadPage = true;
let shownRows = FIRST_ROWS;

/** Writes to the status line under the buttons, when one is on screen. */
function setStatus(text: string): void {
  const status = document.querySelector('.actions-status');
  if (status !== null) {
    status.textContent = text;
  }
}

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

const historyLink = document.getElementById('history-link') as HTMLAnchorElement;
historyLink.addEventListener('click', (event) => {
  event.preventDefault();
  // A full page, because two thousand remembered results want the room.
  void chrome.tabs.create({ url: chrome.runtime.getURL('history.html') });
});

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
    // Mark those documents as written, so history says what reached the note (D21).
    void markSentToNote(
      selection.entries.map(({ row }) => documentKey(row.result, row.url)),
      new Date(),
    );
    return { ok: true, message: sendSummary(outcome, selection.skipped, settings.notePath), openUri: obsidianUri(settings.vaultName ?? vault.name, settings.notePath) };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    recordNoteOutcomes(selection, { ok: false, reason });
    return { ok: false, message: `Could not write ${settings.notePath}: ${reason}. The note was not changed.` };
  }
}

/**
 * Confirmation needs a signed in SharePoint session on the file's own host,
 * and the browser only has one after the site has been opened once. When
 * that is what went wrong, say so and offer the door rather than leaving
 * rows Inferred with no explanation.
 */
function signInHelper(rows: PopupRow[], tabId: number, surfaceNote?: string): HTMLElement | undefined {
  const hosts = [...new Set(rows.flatMap((row) => (row.session?.ok === false && row.session.reason === 'signed-out' && row.session.host !== undefined ? [row.session.host] : [])))];
  if (hosts.length === 0) {
    return undefined;
  }
  const box = el('div', { class: 'helper', role: 'status' });
  const count = rows.filter((row) => row.session?.ok === false && row.session.reason === 'signed-out').length;
  box.append(
    el(
      'p',
      { class: 'helper-line' },
      `${count === 1 ? 'One file could not be confirmed' : `${count} files could not be confirmed`} because this browser has no signed in session on ${hosts.length === 1 ? hosts[0] : 'those sites'} yet. Open ${hosts.length === 1 ? 'it' : 'them'} once, sign in, then check again.`,
    ),
  );
  const actions = el('div', { class: 'helper-actions' });
  for (const host of hosts) {
    const open = el('a', { class: 'row-link', href: `https://${host}/`, 'aria-label': `Open ${host} in a new tab and sign in` }, icon('link'), el('span', {}, `Open ${host}`));
    open.addEventListener('click', (event) => {
      event.preventDefault();
      void chrome.tabs.create({ url: `https://${host}/`, active: true });
    });
    actions.append(open);
  }
  box.append(actions);

  const again = el('button', { type: 'button', class: 'secondary helper-retry' }, 'Check again');
  again.addEventListener('click', async () => {
    again.disabled = true;
    again.textContent = 'Checking…';
    for (const row of rows) {
      if (row.session?.ok === false && row.session.reason !== 'no-access') {
        delete row.session;
      }
    }
    await confirmRows(rows, tabId, surfaceNote);
  });
  box.append(again);
  return box;
}

/**
 * BC-054: paste a link that never appeared in a Copilot answer, for example
 * one sent in Teams or by email. Pressing the button reveals the field, so
 * it costs nothing when it is not wanted, and the result joins the top of
 * whatever list is already there.
 */
function pasteControl(rows: PopupRow[], tabId: number, surfaceNote?: string): HTMLElement {
  const box = el('div', { class: 'paste' });
  const reveal = el('button', { type: 'button', class: 'row-link text-action', 'aria-expanded': 'false' }, icon('link'), el('span', {}, 'Paste a link'));
  const form = el('form', { class: 'paste-form', hidden: 'hidden' });
  const input = el('input', {
    type: 'text',
    class: 'paste-input',
    id: 'paste-link',
    placeholder: 'https://contoso.sharepoint.com/…',
    autocomplete: 'off',
    spellcheck: 'false',
    'aria-label': 'A SharePoint or OneDrive link to convert',
  });
  const submit = el('button', { type: 'submit' }, 'Convert');
  const status = el('p', { class: 'note paste-status', role: 'status' });

  reveal.addEventListener('click', () => {
    const showing = form.hidden;
    form.hidden = !showing;
    reveal.setAttribute('aria-expanded', String(showing));
    if (showing) {
      input.focus();
    }
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const link = input.value.trim();
    if (link === '') {
      status.textContent = 'Paste a link first.';
      input.focus();
      return;
    }
    submit.disabled = true;
    const { row, alreadyListed } = addPastedRow(rows, link);
    input.value = '';
    // Keep the field open and focused, so several links can go in one after another.
    renderRows(rows, tabId, surfaceNote, alreadyListed ? 'That document was already listed, so it moved to the top.' : undefined);
    revealPasteField();
    await confirmRows([row], tabId, surfaceNote, rows);
    revealPasteField();
  });

  form.append(input, submit);
  box.append(reveal, form, status);
  return box;
}

/** Re-opens the paste field after a re-render, so the flow is not interrupted. */
function revealPasteField(): void {
  const form = document.querySelector('.paste-form') as HTMLFormElement | null;
  const reveal = document.querySelector('.paste [aria-expanded]');
  if (form === null) {
    return;
  }
  form.hidden = false;
  reveal?.setAttribute('aria-expanded', 'true');
  (form.querySelector('.paste-input') as HTMLInputElement | null)?.focus();
}

/** What to read, how many were found, and ticking them all at once. */
function scopeBar(rows: PopupRow[], tabId: number, surfaceNote?: string): HTMLElement {
  const bar = el('div', { class: 'scope-bar' });
  const group = el('div', { class: 'scope', role: 'group', 'aria-label': 'What to read' });
  // Nothing to re-read on a page that is not a Copilot answer.
  if (!canReadPage) {
    bar.append(el('span', { class: 'note scope-count' }, `${rows.length} ${rows.length === 1 ? 'file' : 'files'}`), pasteControl(rows, tabId, surfaceNote));
    return bar;
  }
  for (const [value, label] of [
    ['latest', 'Latest answer'],
    ['chat', 'Whole chat'],
  ] as const) {
    const chosen = scope === value;
    const option = el('button', { type: 'button', class: `scope-option${chosen ? ' chosen' : ''}`, 'aria-pressed': String(chosen) }, label);
    option.addEventListener('click', () => {
      if (scope !== value) {
        scope = value;
        void loadCitations(tabId, surfaceNote);
      }
    });
    group.append(option);
  }
  bar.append(group, el('span', { class: 'note scope-count' }, `${rows.length} ${rows.length === 1 ? 'file' : 'files'}`));
  bar.append(pasteControl(rows, tabId, surfaceNote));

  const selectable = rows.filter((row) => row.result.ok);
  if (selectable.length > 1) {
    const setAll = (selected: boolean) => () => {
      for (const row of selectable) {
        row.selected = selected;
      }
      renderRows(rows, tabId, surfaceNote);
    };
    const all = el('button', { type: 'button', class: 'row-link text-action' }, 'Select all');
    const none = el('button', { type: 'button', class: 'row-link text-action' }, 'Select none');
    all.addEventListener('click', setAll(true));
    none.addEventListener('click', setAll(false));
    bar.append(el('span', { class: 'scope-select' }, all, none));
  }
  return bar;
}

function renderRows(rows: PopupRow[], tabId: number, surfaceNote?: string, notice?: string): void {
  main.replaceChildren();
  if (notice !== undefined) {
    main.append(el('p', { class: 'notice', role: 'status' }, notice));
  }
  if (surfaceNote !== undefined) {
    main.append(el('p', { class: 'note' }, surfaceNote));
  }
  main.append(scopeBar(rows, tabId, surfaceNote));
  const helper = signInHelper(rows, tabId, surfaceNote);
  if (helper !== undefined) {
    main.append(helper);
  }

  const list = el('ul', { class: 'rows', 'aria-label': 'Cited files' });
  const shown = rows.slice(0, shownRows);
  for (const row of shown) {
    list.append(renderRow(row));
  }
  main.append(list);

  if (rows.length > shown.length) {
    const more = el('button', { type: 'button', class: 'row-link text-action' }, `Show the other ${rows.length - shown.length}`);
    more.addEventListener('click', () => {
      shownRows = rows.length;
      renderRows(rows, tabId, surfaceNote, notice);
    });
    main.append(el('p', { class: 'note more-line' }, `Showing ${shown.length} of ${rows.length}. `, more));
  }

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

/**
 * Nothing to show. Most of the time this is not a fault at all: the answer
 * simply cited no files. So it reads as an ordinary outcome, offers the one
 * thing worth trying next, and keeps the markup detail folded away for the
 * rarer case where extraction really has broken.
 */
function renderEmpty(kind: 'work' | 'consumer', tabId: number, strategy: string, surfaceNote?: string): void {
  main.replaceChildren();
  const box = el('div', { class: 'empty' });

  if (kind === 'consumer') {
    box.append(
      el('h2', {}, 'No work files here'),
      el('p', {}, 'Copilot on this site cites web pages. It is the work surfaces, m365.cloud.microsoft and copilot.cloud.microsoft, that cite SharePoint and OneDrive for Business files.'),
    );
    main.append(box);
    return;
  }

  const wholeChat = scope === 'chat';
  box.append(
    el('h2', {}, wholeChat ? 'No files cited in this chat' : 'No files cited in this answer'),
    el(
      'p',
      {},
      wholeChat
        ? 'BreadCrumb lists the SharePoint and OneDrive for Business files a Copilot answer cites, so you can find the folder each one lives in. Nothing in this conversation cites a file.'
        : 'BreadCrumb lists the SharePoint and OneDrive for Business files a Copilot answer cites, so you can find the folder each one lives in. This answer does not cite any.',
    ),
  );

  const actions = el('div', { class: 'actions' });
  if (!wholeChat) {
    const wider = el('button', { type: 'button' }, 'Look in the whole chat');
    wider.addEventListener('click', () => {
      scope = 'chat';
      void loadCitations(tabId, surfaceNote);
    });
    actions.append(wider);
  }
  box.append(actions);
  // A link from Teams or an email has no chat to come from: paste it here.
  box.append(pasteControl([], tabId, surfaceNote));

  // Folded away: only useful when the answer did cite files and extraction missed them.
  const note = el('p', { class: 'note', role: 'status' });
  const report = el('button', { type: 'button', class: 'row-link text-action' }, 'Copy a redacted sample of the page');
  report.addEventListener('click', async () => {
    const response = await askContent<SampleResponse>(tabId, { type: 'breadcrumb:sample' });
    const failure = await copyToClipboard(response.sample);
    note.textContent = failure === undefined ? 'The sample is on your clipboard. Paste it into an issue so the markup can be followed.' : `Could not copy the sample: ${failure}`;
  });
  const details = el('details', { class: 'empty-details' });
  details.append(
    el('summary', {}, 'The answer did cite files?'),
    el('p', { class: 'note' }, 'Then the page markup has probably changed, and BreadCrumb is looking in the wrong place. A redacted sample helps put that right: it keeps the shape of the page and replaces the words.'),
    el('p', { class: 'note' }, `Looked in ${strategy}.`),
    report,
    note,
  );
  box.append(details);
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

/**
 * Reads the page at the current scope, lists what it found, then confirms as
 * many rows as the session can, a few at a time so a long chat does not fire
 * dozens of lookups at once.
 */
async function loadCitations(tabId: number, surfaceNote?: string): Promise<void> {
  main.replaceChildren(el('p', {}, scope === 'chat' ? 'Reading the whole chat…' : 'Looking for citations…'));
  let extracted: ExtractResponse;
  try {
    extracted = await askContent<ExtractResponse>(tabId, { type: 'breadcrumb:extract', scope });
  } catch (error) {
    main.replaceChildren(el('p', {}, `The page did not answer (${error instanceof Error ? error.message : String(error)}). Reload the Copilot page and open the popup again.`));
    return;
  }
  const rows = buildRows(extracted.citations);
  shownRows = FIRST_ROWS;
  if (rows.length === 0) {
    renderEmpty(extracted.surface === 'consumer' ? 'consumer' : 'work', tabId, extracted.strategy, surfaceNote);
    return;
  }
  renderRows(rows, tabId, surfaceNote);
  // Where a send would go, resolved in the background: the list never waits on the vault.
  void resolveObsidianTarget().then((found) => {
    if (found) {
      renderRows(rows, tabId, surfaceNote);
    }
  });
  await confirmRows(rows, tabId, surfaceNote);
}

/**
 * BC-049: confirms what the browser's SharePoint session can, where the user
 * granted access, then re-renders. Also used by "Check again" after the user
 * has opened the site and signed in.
 */
async function confirmRows(rows: PopupRow[], tabId: number, surfaceNote?: string, renderList: PopupRow[] = rows): Promise<void> {
  await confirmWithSession(rows, {
    fetchImpl: (url, init) => fetch(url, init),
    hasPermission: (host) => chrome.permissions.contains({ origins: [`https://${host}/*`] }),
    onProgress: (done, total) => {
      if (done < total) {
        setStatus(`Confirming ${done} of ${total} with your SharePoint session…`);
      }
    },
  });
  const confirmed = rows.filter((row) => row.session?.ok === true).length;
  const count = (reason: string): number => rows.filter((row) => row.session?.ok === false && row.session.reason === reason).length;
  const parts: string[] = [];
  if (confirmed > 0) parts.push(`${confirmed} confirmed with your SharePoint session.`);
  // Say what each group of refusals actually was, rather than one number for all of them.
  const refused = count('no-permission');
  const missing = count('not-found');
  if (refused > 0) parts.push(`${refused} ${refused === 1 ? 'is' : 'are'} in sites or OneDrive folders you do not have access to.`);
  if (missing > 0) parts.push(`${missing} ${missing === 1 ? 'is' : 'are'} no longer there.`);
  const notFiles = count('unsupported');
  if (notFiles > 0) parts.push(`${notFiles} ${notFiles === 1 ? 'is not a link to a file' : 'are not links to files'}, so there is nothing to look up.`);
  if (count('no-access') > 0) parts.push('Allow your tenant on the options page to confirm the others instantly.');
  // BC-055: keep what was worked out, so the same folder is never worked out twice.
  const kept = await recordRows(renderList, pageUrl === undefined ? {} : { pageUrl });
  if (!kept.ok) {
    parts.push(`Nothing could be kept on this device: ${kept.message ?? 'the browser refused to store it'}.`);
  } else if (kept.dropped > 0) {
    parts.push(`${kept.dropped} of the oldest kept results made way for these.`);
  }
  renderRows(renderList, tabId, surfaceNote, parts.length > 0 ? parts.join(' ') : undefined);
}

async function start(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) {
    main.replaceChildren(el('p', {}, 'Open a Copilot page and try again.'));
    return;
  }
  // Without activeTab the URL is only visible for hosts BreadCrumb has
  // permission for, which are exactly the Copilot ones. Anywhere else it is
  // undefined, and anywhere else is the paste-only view.
  const surface = tab.url === undefined ? 'other' : surfaceOf(new URL(tab.url).hostname);
  if (surface === 'other') {
    // Not a Copilot page, so there are no citations to read. A link from
    // Teams, an email or anywhere else can still be pasted here (BC-054).
    canReadPage = false;
    const box = el('div', { class: 'empty' });
    box.append(
      el('h2', {}, 'Paste a link to find its folder'),
      el('p', {}, 'BreadCrumb reads file citations on the Copilot pages at m365.cloud.microsoft and copilot.cloud.microsoft. Anywhere else, paste a SharePoint or OneDrive for Business link and it will work out where the file lives.'),
      pasteControl([], tab.id, undefined),
    );
    main.replaceChildren(box);
    return;
  }
  pageUrl = tab.url;
  setupDiagnostics(tab.id);
  await loadCitations(tab.id, surface === 'consumer' ? 'Links found in the response text on the consumer surface.' : undefined);
}

void start();
