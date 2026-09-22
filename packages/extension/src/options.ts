/**
 * Options page: grant the extension access to a tenant's SharePoint hosts
 * (BC-049, invariant 17), point it at an Obsidian vault and note (BC-057,
 * BC-067), and test what the browser session can confirm.
 *
 * The vault folder is picked here rather than in the popup: the picker needs
 * a top level page, which is why the options page opens in a tab.
 */
import { PARSER_VERSION } from '@breadcrumb/parser';
import { DEFAULT_NOTE_PATH, getObsidianSettings, setNotePath, setVaultName } from './settings.js';
import type { LinkReport } from './spTest.js';
import { tenantOrigins } from './spTest.js';
import { forgetVaultHandle, loadVaultHandle, requestVaultPermission, saveVaultHandle, splitNotePath, vaultPermission, type DirectoryHandleLike } from './vault.js';

// Which version is installed, for anyone reporting what they saw (BC-064).
const versionLine = document.getElementById('version') as HTMLElement;
versionLine.textContent = `BreadCrumb ${chrome.runtime.getManifest().version}, link parser ${PARSER_VERSION}.`;

const pickVault = document.getElementById('pick-vault') as HTMLButtonElement;
const forgetVault = document.getElementById('forget-vault') as HTMLButtonElement;
const vaultStatus = document.getElementById('vault-status') as HTMLElement;
const notePathInput = document.getElementById('note-path') as HTMLInputElement;
const saveNotePath = document.getElementById('save-note-path') as HTMLButtonElement;
const notePathStatus = document.getElementById('note-path-status') as HTMLElement;

async function showVault(): Promise<void> {
  const handle = await loadVaultHandle();
  if (handle === undefined) {
    vaultStatus.textContent = 'No vault folder chosen yet. Nothing can be sent to Obsidian until you choose one.';
    return;
  }
  const permission = await vaultPermission(handle);
  vaultStatus.textContent =
    permission === 'granted'
      ? `Writing to the folder "${handle.name}".`
      : `The folder "${handle.name}" is remembered, but the browser needs you to allow access again. Choose it again, or press Choose vault folder and pick the same folder.`;
}

void showVault();

void getObsidianSettings().then((settings) => {
  notePathInput.value = settings.notePath;
});

pickVault.addEventListener('click', async () => {
  const picker = (window as unknown as { showDirectoryPicker?: (options?: { mode?: 'read' | 'readwrite'; id?: string }) => Promise<DirectoryHandleLike> }).showDirectoryPicker;
  if (picker === undefined) {
    vaultStatus.textContent = 'This browser cannot open a folder picker, so the Obsidian output is not available here. Microsoft Edge and Chrome can.';
    return;
  }
  let handle: DirectoryHandleLike;
  try {
    handle = await picker({ mode: 'readwrite', id: 'breadcrumb-vault' });
  } catch (error) {
    vaultStatus.textContent = error instanceof DOMException && error.name === 'AbortError' ? 'No folder chosen; nothing changed.' : `The folder was not chosen: ${String(error)}`;
    return;
  }
  const permission = await requestVaultPermission(handle);
  if (permission !== 'granted') {
    vaultStatus.textContent = 'Access to that folder was not granted, so nothing was saved.';
    return;
  }
  try {
    await saveVaultHandle(handle);
    await setVaultName(handle.name);
  } catch (error) {
    vaultStatus.textContent = `The folder could not be remembered: ${error instanceof Error ? error.message : String(error)}`;
    return;
  }
  vaultStatus.textContent = `Writing to the folder "${handle.name}".`;
});

forgetVault.addEventListener('click', async () => {
  try {
    await forgetVaultHandle();
    await setVaultName(undefined);
  } catch (error) {
    vaultStatus.textContent = `The vault folder could not be forgotten: ${error instanceof Error ? error.message : String(error)}`;
    return;
  }
  vaultStatus.textContent = 'The vault folder is forgotten. BreadCrumb now holds no file access at all.';
});

saveNotePath.addEventListener('click', async () => {
  const value = notePathInput.value.trim() === '' ? DEFAULT_NOTE_PATH : notePathInput.value;
  const split = splitNotePath(value);
  if (split === undefined) {
    notePathStatus.textContent = 'That is not a usable note path. Use folders and a file name, for example BreadCrumb/Document locations.md.';
    return;
  }
  const normalised = [...split.folders, split.fileName].join('/');
  await setNotePath(normalised);
  notePathInput.value = normalised;
  notePathStatus.textContent = `Rows go to ${normalised} in your vault.`;
});

const tenantInput = document.getElementById('tenant') as HTMLInputElement;
const grant = document.getElementById('grant') as HTMLButtonElement;
const revoke = document.getElementById('revoke') as HTMLButtonElement;
const grantStatus = document.getElementById('grant-status') as HTMLElement;
const linksInput = document.getElementById('links') as HTMLTextAreaElement;
const test = document.getElementById('test') as HTMLButtonElement;
const testStatus = document.getElementById('test-status') as HTMLElement;
const output = document.getElementById('test-output') as HTMLPreElement;

const TENANT_KEY = 'spTenant';

async function showGrant(): Promise<void> {
  const origins = tenantOrigins(tenantInput.value);
  if (origins === undefined) {
    grantStatus.textContent = 'Enter the tenant name, for example contoso for contoso.sharepoint.com.';
    return;
  }
  const granted = await chrome.permissions.contains({ origins });
  grantStatus.textContent = granted ? `Access granted to ${origins.join(' and ')}.` : `No access yet to ${origins.join(' and ')}.`;
}

void chrome.storage.sync.get(TENANT_KEY).then((stored) => {
  tenantInput.value = typeof stored[TENANT_KEY] === 'string' ? (stored[TENANT_KEY] as string) : '';
  if (tenantInput.value !== '') void showGrant();
});
tenantInput.addEventListener('change', () => void showGrant());

grant.addEventListener('click', async () => {
  const origins = tenantOrigins(tenantInput.value);
  if (origins === undefined) {
    grantStatus.textContent = 'Enter the tenant name, for example contoso for contoso.sharepoint.com.';
    return;
  }
  await chrome.storage.sync.set({ [TENANT_KEY]: tenantInput.value.trim() });
  try {
    const granted = await chrome.permissions.request({ origins });
    grantStatus.textContent = granted ? `Access granted to ${origins.join(' and ')}.` : 'Access was not granted.';
  } catch (error) {
    grantStatus.textContent = `The browser refused the request: ${error instanceof Error ? error.message : String(error)}`;
  }
});

revoke.addEventListener('click', async () => {
  const origins = tenantOrigins(tenantInput.value);
  if (origins === undefined) return;
  const removed = await chrome.permissions.remove({ origins });
  grantStatus.textContent = removed ? 'Access removed.' : 'Nothing to remove.';
});

test.addEventListener('click', async () => {
  const links = linksInput.value.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== '');
  if (links.length === 0) {
    testStatus.textContent = 'Paste one or more links first.';
    return;
  }
  test.disabled = true;
  testStatus.textContent = 'Asking SharePoint…';
  const response = (await chrome.runtime.sendMessage({ type: 'breadcrumb:sp-test', links })) as { ok: boolean; reports?: LinkReport[]; error?: string };
  test.disabled = false;
  if (!response.ok || response.reports === undefined) {
    testStatus.textContent = `The test failed: ${response.error ?? 'no answer from the service worker'}`;
    return;
  }
  const reports = response.reports;
  const calls = reports.flatMap((r) => r.calls);
  const worked = calls.filter((c) => c.ok).length;
  testStatus.textContent = `${worked} of ${calls.length} SharePoint calls answered 2xx. The detail is below.`;
  output.hidden = false;
  output.textContent = reports
    .map((r) =>
      [
        `${r.link}`,
        `  form ${r.form ?? '?'} on ${r.host ?? '?'}${r.permission !== undefined ? `, access ${r.permission}` : ''}${r.note !== undefined ? ` (${r.note})` : ''}`,
        ...r.calls.map((c) => `  ${c.label}: ${c.status ?? 'no response'} ${c.error ?? ''}${c.finalUrl !== undefined ? ` → ended at ${c.finalUrl}` : ''}`),
      ].join('\n'),
    )
    .join('\n\n');
});
