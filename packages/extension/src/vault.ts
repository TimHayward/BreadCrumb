/**
 * BC-067: the vault folder and the note file.
 *
 * The user picks their vault folder once on the options page (decision D10:
 * the File System Access route). The handle is kept in IndexedDB, which is
 * the only store that can hold one, and is shared by the options page and
 * the popup because both run on the extension's own origin.
 *
 * BreadCrumb holds access to that one folder and writes one note inside it
 * (invariant 16). It never reads anything else in the vault.
 */

const DB_NAME = 'breadcrumb';
const DB_VERSION = 1;
const STORE = 'handles';
const VAULT_KEY = 'vaultDirectory';

/** The slice of the File System Access API we use, so tests can supply a fake. */
export interface DirectoryHandleLike {
  readonly name: string;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<DirectoryHandleLike>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileHandleLike>;
  queryPermission?(descriptor: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
  requestPermission?(descriptor: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
}

export interface FileHandleLike {
  getFile(): Promise<{ text(): Promise<string> }>;
  createWritable(options?: { keepExistingData?: boolean }): Promise<WritableLike>;
}

export interface WritableLike {
  write(data: string): Promise<void>;
  close(): Promise<void>;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB could not be opened'));
  });
}

function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDatabase().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE, mode);
        const request = run(transaction.objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
        transaction.oncomplete = () => db.close();
      }),
  );
}

/**
 * Gives up after a while: where IndexedDB is unavailable the open request can
 * sit unanswered, and a popup that waits for it would never say anything.
 */
async function withTimeout<T>(work: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export async function saveVaultHandle(handle: DirectoryHandleLike): Promise<void> {
  await withStore('readwrite', (store) => store.put(handle, VAULT_KEY) as IDBRequest<unknown>);
}

export async function loadVaultHandle(): Promise<DirectoryHandleLike | undefined> {
  try {
    const handle = await withTimeout(withStore<DirectoryHandleLike | undefined>('readonly', (store) => store.get(VAULT_KEY) as IDBRequest<DirectoryHandleLike | undefined>), 3000, undefined);
    return handle ?? undefined;
  } catch {
    return undefined;
  }
}

export async function forgetVaultHandle(): Promise<void> {
  await withStore('readwrite', (store) => store.delete(VAULT_KEY) as IDBRequest<undefined>);
}

/**
 * Whether the browser will let us write to the folder right now. After a
 * browser restart this is often 'prompt': the grant has to be asked for
 * again, and only a page with a user gesture may ask (the options page).
 */
export async function vaultPermission(handle: DirectoryHandleLike): Promise<PermissionState> {
  if (handle.queryPermission === undefined) {
    return 'granted';
  }
  try {
    return await handle.queryPermission({ mode: 'readwrite' });
  } catch {
    return 'denied';
  }
}

export async function requestVaultPermission(handle: DirectoryHandleLike): Promise<PermissionState> {
  if (handle.requestPermission === undefined) {
    return 'granted';
  }
  try {
    return await handle.requestPermission({ mode: 'readwrite' });
  } catch {
    return 'denied';
  }
}

/** Splits a note path into its folder segments and file name, and checks it. */
export function splitNotePath(path: string): { folders: string[]; fileName: string } | undefined {
  const segments = path
    .split(/[\\/]+/)
    .map((segment) => segment.trim())
    .filter((segment) => segment !== '');
  if (segments.length === 0) {
    return undefined;
  }
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    return undefined;
  }
  const last = segments.pop() as string;
  const fileName = /\.md$/i.test(last) ? last : `${last}.md`;
  if (/[<>:"|?*]/.test(fileName) || segments.some((segment) => /[<>:"|?*]/.test(segment))) {
    return undefined;
  }
  return { folders: segments, fileName };
}

/** The note's text, or undefined when the note does not exist yet. */
export async function readNote(vault: DirectoryHandleLike, path: string): Promise<string | undefined> {
  const split = splitNotePath(path);
  if (split === undefined) {
    throw new Error(`"${path}" is not a usable note path.`);
  }
  let directory = vault;
  for (const folder of split.folders) {
    try {
      directory = await directory.getDirectoryHandle(folder);
    } catch {
      return undefined;
    }
  }
  try {
    const file = await directory.getFileHandle(split.fileName);
    return await (await file.getFile()).text();
  } catch {
    return undefined;
  }
}

/** Writes the note, creating the folders and the file when they are not there. */
export async function writeNote(vault: DirectoryHandleLike, path: string, text: string): Promise<void> {
  const split = splitNotePath(path);
  if (split === undefined) {
    throw new Error(`"${path}" is not a usable note path.`);
  }
  let directory = vault;
  for (const folder of split.folders) {
    directory = await directory.getDirectoryHandle(folder, { create: true });
  }
  const file = await directory.getFileHandle(split.fileName, { create: true });
  const writable = await file.createWritable();
  try {
    await writable.write(text);
  } finally {
    await writable.close();
  }
}

/** An `obsidian://` link that opens the note, for "Open in Obsidian". */
export function obsidianUri(vaultName: string, path: string): string {
  const split = splitNotePath(path);
  const file = split === undefined ? path : [...split.folders, split.fileName].join('/');
  return `obsidian://open?vault=${encodeURIComponent(vaultName)}&file=${encodeURIComponent(file.replace(/\.md$/i, ''))}`;
}
