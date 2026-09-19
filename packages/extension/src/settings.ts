/**
 * The extension's settings (BC-057). Only the Obsidian target lives here:
 * the vault folder itself is a handle in IndexedDB (see vault.ts), and the
 * tenant host grants are browser permissions, not settings.
 */

const NOTE_PATH_KEY = 'obsidianNotePath';
const VAULT_NAME_KEY = 'obsidianVaultName';

/** Where rows are written, relative to the vault folder. */
export const DEFAULT_NOTE_PATH = 'BreadCrumb/Document locations.md';

export interface ObsidianSettings {
  /** Note path relative to the vault folder, always ending in `.md`. */
  notePath: string;
  /** The vault folder's name, remembered so the options page and the popup can name it. */
  vaultName?: string;
}

export async function getObsidianSettings(): Promise<ObsidianSettings> {
  const stored = await chrome.storage.sync.get([NOTE_PATH_KEY, VAULT_NAME_KEY]);
  const notePath = typeof stored[NOTE_PATH_KEY] === 'string' && (stored[NOTE_PATH_KEY] as string).trim() !== '' ? (stored[NOTE_PATH_KEY] as string) : DEFAULT_NOTE_PATH;
  const vaultName = typeof stored[VAULT_NAME_KEY] === 'string' && (stored[VAULT_NAME_KEY] as string) !== '' ? (stored[VAULT_NAME_KEY] as string) : undefined;
  return vaultName === undefined ? { notePath } : { notePath, vaultName };
}

export async function setNotePath(value: string): Promise<void> {
  await chrome.storage.sync.set({ [NOTE_PATH_KEY]: value.trim() });
}

export async function setVaultName(value: string | undefined): Promise<void> {
  await chrome.storage.sync.set({ [VAULT_NAME_KEY]: value ?? '' });
}
