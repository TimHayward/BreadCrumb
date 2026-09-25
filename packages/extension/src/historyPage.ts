/**
 * BC-056: the page for what BreadCrumb remembers. Search it, filter it,
 * delete from it, and get it out as CSV or JSON.
 *
 * A full page rather than the popup, because two thousand results want the
 * room. Rows are rendered a screenful at a time: filtering two thousand
 * entries is nothing, building two thousand rows is not.
 */
import { deleteEntries, readHistory, type HistoryEntry } from './history.js';
import { exportName, filterEntries, formatSeen, statesIn, toCsv, toJson, type HistoryFilter } from './historyView.js';

const FIRST_ROWS = 100;

const search = document.getElementById('search') as HTMLInputElement;
const stateFilter = document.getElementById('state') as HTMLSelectElement;
const sourceFilter = document.getElementById('source') as HTMLSelectElement;
const sentOnly = document.getElementById('sent-only') as HTMLInputElement;
const countLine = document.getElementById('count') as HTMLElement;
const list = document.getElementById('entries') as HTMLElement;
const moreLine = document.getElementById('more-line') as HTMLElement;
const confirmLine = document.getElementById('confirm') as HTMLElement;
const announcer = document.getElementById('announcer') as HTMLElement;

let all: HistoryEntry[] = [];
let shown = FIRST_ROWS;
const selected = new Set<string>();

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...children: Array<Node | string>): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    node.setAttribute(key, value);
  }
  node.append(...children);
  return node;
}

function announce(text: string): void {
  announcer.textContent = '';
  setTimeout(() => {
    announcer.textContent = text;
  }, 50);
}

function badge(state: string): HTMLElement {
  const symbols: Record<string, string> = { Verified: '●', Derived: '◆', Inferred: '◈', Unresolved: '○', failed: '✕' };
  const label = state === 'failed' ? 'Failed' : state;
  // The symbol repeats the state for colour-blind readers; the word carries it for everyone.
  return el('span', { class: `badge badge-${state.toLowerCase()}` }, el('span', { 'aria-hidden': 'true' }, symbols[state] ?? '•'), ` ${label}`);
}

function currentFilter(): HistoryFilter {
  return { search: search.value, state: stateFilter.value, source: sourceFilter.value, sentOnly: sentOnly.checked };
}

async function copy(text: string, what: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    announce(`${what} copied.`);
  } catch (error) {
    announce(`Could not copy the ${what.toLowerCase()}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function copyAction(text: string, label: string): HTMLButtonElement {
  const button = el('button', { type: 'button', class: 'row-link', 'aria-label': `${label}` }, label);
  button.addEventListener('click', () => void copy(text, label));
  return button;
}

function renderEntry(entry: HistoryEntry): HTMLLIElement {
  const id = `entry-${entry.documentKey}`;
  const tick = el('input', { type: 'checkbox', id, 'aria-label': `Select ${entry.label}` });
  tick.checked = selected.has(entry.documentKey);
  tick.addEventListener('change', () => {
    if (tick.checked) {
      selected.add(entry.documentKey);
    } else {
      selected.delete(entry.documentKey);
    }
    showCount(filterEntries(all, currentFilter()));
  });

  const item = el('li', { class: 'entry' }, tick, el('label', { for: id, class: 'entry-name' }, entry.label), badge(entry.state));
  item.append(el('p', { class: 'entry-path' }, entry.folder ?? entry.path ?? 'Location unknown'));

  const meta = el(
    'div',
    { class: 'entry-meta' },
    el('span', {}, formatSeen(entry.lastSeenAt)),
    el('span', {}, entry.source === 'pasted' ? 'Pasted by hand' : 'From a Copilot citation'),
  );
  if (entry.sentToNoteAt !== undefined) {
    meta.append(el('span', { class: 'sent' }, `Written to your note ${formatSeen(entry.sentToNoteAt)}`));
  }
  item.append(meta);

  if (entry.upgradedFrom !== undefined) {
    item.append(el('p', { class: 'entry-was' }, `Was ${entry.upgradedFrom.state}${entry.upgradedFrom.path === undefined ? '' : ` at ${entry.upgradedFrom.path}`}.`));
  }

  const actions = el('div', { class: 'entry-actions' }, copyAction(entry.url, 'Copy original link'));
  if (entry.folderUrl !== undefined) {
    actions.append(copyAction(entry.folderUrl, 'Copy folder link'));
    const open = el('a', { class: 'row-link', href: entry.folderUrl, target: '_blank', rel: 'noopener' }, 'Open the folder');
    actions.append(open);
  }
  const remove = el('button', { type: 'button', class: 'row-link', 'aria-label': `Delete ${entry.label} from history` }, 'Delete');
  remove.addEventListener('click', () => askToDelete([entry.documentKey], entry.label));
  actions.append(remove);
  item.append(actions);
  return item;
}

function showCount(matching: readonly HistoryEntry[]): void {
  const chosen = selected.size;
  const base = all.length === 0 ? 'Nothing remembered yet.' : `${matching.length.toLocaleString()} of ${all.length.toLocaleString()} kept`;
  countLine.textContent = chosen === 0 ? `${base}.` : `${base}, ${chosen.toLocaleString()} selected.`;
}

function render(): void {
  const matching = filterEntries(all, currentFilter());
  showCount(matching);
  list.replaceChildren();

  if (all.length === 0) {
    list.append(el('li', { class: 'empty' }, 'BreadCrumb will remember every link you resolve. Open a Copilot answer, or paste a link in the popup, and it will appear here.'));
    moreLine.hidden = true;
    return;
  }
  if (matching.length === 0) {
    list.append(el('li', { class: 'empty' }, 'Nothing matches that. Clear the search or the filters to see everything again.'));
    moreLine.hidden = true;
    return;
  }

  for (const entry of matching.slice(0, shown)) {
    list.append(renderEntry(entry));
  }
  if (matching.length > shown) {
    const more = el('button', { type: 'button', class: 'row-link' }, `Show the next ${Math.min(FIRST_ROWS, matching.length - shown)}`);
    more.addEventListener('click', () => {
      shown += FIRST_ROWS;
      render();
    });
    moreLine.replaceChildren(`Showing ${shown.toLocaleString()} of ${matching.length.toLocaleString()}. `, more);
    moreLine.hidden = false;
  } else {
    moreLine.hidden = true;
  }
}

/** Deleting is not undoable, so it is always confirmed and always says how many. */
function askToDelete(keys: string[], what: string): void {
  confirmLine.replaceChildren(`Delete ${what}? This cannot be undone.`);
  const yes = el('button', { type: 'button' }, 'Delete');
  const no = el('button', { type: 'button', class: 'secondary' }, 'Keep');
  yes.addEventListener('click', async () => {
    const outcome = await deleteEntries(keys);
    if (!outcome.ok) {
      confirmLine.replaceChildren(`Nothing was deleted: ${outcome.message ?? 'the browser refused'}.`);
      return;
    }
    for (const key of keys) {
      selected.delete(key);
    }
    all = (await readHistory()).entries;
    confirmLine.hidden = true;
    announce(`${outcome.dropped} deleted.`);
    render();
    search.focus();
  });
  no.addEventListener('click', () => {
    confirmLine.hidden = true;
    search.focus();
  });
  confirmLine.append(yes, no);
  confirmLine.hidden = false;
  yes.focus();
}

function download(text: string, fileName: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = el('a', { href: url, download: fileName });
  document.body.append(link);
  link.click();
  link.remove();
  // Revoked on the next turn of the event loop, once the download has started.
  setTimeout(() => URL.revokeObjectURL(url), 0);
  announce(`${fileName} downloaded.`);
}

function wire(): void {
  for (const control of [search, stateFilter, sourceFilter, sentOnly]) {
    control.addEventListener('input', () => {
      shown = FIRST_ROWS;
      render();
    });
  }

  (document.getElementById('select-all') as HTMLButtonElement).addEventListener('click', () => {
    for (const entry of filterEntries(all, currentFilter())) {
      selected.add(entry.documentKey);
    }
    render();
  });
  (document.getElementById('select-none') as HTMLButtonElement).addEventListener('click', () => {
    selected.clear();
    render();
  });
  (document.getElementById('delete-selected') as HTMLButtonElement).addEventListener('click', () => {
    if (selected.size === 0) {
      announce('Nothing is selected.');
      countLine.textContent = 'Nothing is selected, so there is nothing to delete.';
      return;
    }
    askToDelete([...selected], `${selected.size.toLocaleString()} ${selected.size === 1 ? 'result' : 'results'}`);
  });
  (document.getElementById('export-csv') as HTMLButtonElement).addEventListener('click', () => {
    download(toCsv(filterEntries(all, currentFilter())), exportName('csv'), 'text/csv;charset=utf-8');
  });
  (document.getElementById('export-json') as HTMLButtonElement).addEventListener('click', () => {
    download(toJson(filterEntries(all, currentFilter())), exportName('json'), 'application/json');
  });
  (document.getElementById('options-link') as HTMLAnchorElement).addEventListener('click', (event) => {
    event.preventDefault();
    void chrome.runtime.openOptionsPage();
  });
}

async function start(): Promise<void> {
  all = (await readHistory()).entries;
  for (const state of statesIn(all)) {
    stateFilter.append(el('option', { value: state }, state === 'failed' ? 'Failed' : state));
  }
  wire();
  render();
}

void start();
