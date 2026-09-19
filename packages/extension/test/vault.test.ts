import { describe, expect, it } from 'vitest';
import { obsidianUri, readNote, splitNotePath, writeNote, type DirectoryHandleLike, type FileHandleLike } from '../src/vault.js';

/** A fake vault folder: a map of path to text, with the same shape the browser gives us. */
function fakeVault(files: Record<string, string> = {}, options: { readOnly?: boolean } = {}): { handle: DirectoryHandleLike; files: Record<string, string> } {
  const make = (prefix: string, name: string): DirectoryHandleLike => ({
    name,
    async getDirectoryHandle(child, opts) {
      const path = `${prefix}${child}/`;
      const exists = Object.keys(files).some((key) => key.startsWith(path));
      if (!exists && opts?.create !== true) {
        throw new DOMException('not found', 'NotFoundError');
      }
      return make(path, child);
    },
    async getFileHandle(child, opts): Promise<FileHandleLike> {
      const path = `${prefix}${child}`;
      if (files[path] === undefined && opts?.create !== true) {
        throw new DOMException('not found', 'NotFoundError');
      }
      return {
        async getFile() {
          return { text: async () => files[path] ?? '' };
        },
        async createWritable() {
          if (options.readOnly === true) {
            throw new DOMException('not allowed', 'NotAllowedError');
          }
          let buffer = '';
          return {
            async write(data: string) {
              buffer += data;
            },
            async close() {
              files[path] = buffer;
            },
          };
        },
      };
    },
    async queryPermission() {
      return 'granted' as PermissionState;
    },
    async requestPermission() {
      return 'granted' as PermissionState;
    },
  });
  return { handle: make('', 'MyVault'), files };
}

describe('note paths', () => {
  it('splits folders from the file name and adds the extension', () => {
    expect(splitNotePath('BreadCrumb/Document locations.md')).toEqual({ folders: ['BreadCrumb'], fileName: 'Document locations.md' });
    expect(splitNotePath('Notes/Work/locations')).toEqual({ folders: ['Notes', 'Work'], fileName: 'locations.md' });
    expect(splitNotePath('locations.md')).toEqual({ folders: [], fileName: 'locations.md' });
    expect(splitNotePath('Notes\\Work\\locations.md')).toEqual({ folders: ['Notes', 'Work'], fileName: 'locations.md' });
  });

  it('refuses a path that escapes the vault or cannot be a file name', () => {
    expect(splitNotePath('')).toBeUndefined();
    expect(splitNotePath('   ')).toBeUndefined();
    expect(splitNotePath('../outside.md')).toBeUndefined();
    expect(splitNotePath('Notes/../../outside.md')).toBeUndefined();
    expect(splitNotePath('Notes/what?.md')).toBeUndefined();
  });
});

describe('reading and writing the note', () => {
  it('returns undefined when the note or its folder is not there', async () => {
    const { handle } = fakeVault();
    expect(await readNote(handle, 'BreadCrumb/Document locations.md')).toBeUndefined();
  });

  it('creates the folders and the file, then reads back what it wrote', async () => {
    const { handle, files } = fakeVault();
    await writeNote(handle, 'BreadCrumb/Document locations.md', '# Hello\n');
    expect(files).toEqual({ 'BreadCrumb/Document locations.md': '# Hello\n' });
    expect(await readNote(handle, 'BreadCrumb/Document locations.md')).toBe('# Hello\n');
  });

  it('replaces the whole file rather than appending to the old bytes', async () => {
    const { handle, files } = fakeVault({ 'notes.md': 'old content that is longer\n' });
    await writeNote(handle, 'notes.md', 'new\n');
    expect(files['notes.md']).toBe('new\n');
  });

  it('reports a write that the browser refuses', async () => {
    const { handle } = fakeVault({ 'notes.md': 'x' }, { readOnly: true });
    await expect(writeNote(handle, 'notes.md', 'y')).rejects.toThrow();
  });

  it('refuses a bad path before touching the vault', async () => {
    const { handle } = fakeVault();
    await expect(writeNote(handle, '../escape.md', 'text')).rejects.toThrow();
  });
});

describe('opening the note in Obsidian', () => {
  it('builds an obsidian:// link without the extension', () => {
    expect(obsidianUri('My Vault', 'BreadCrumb/Document locations.md')).toBe('obsidian://open?vault=My%20Vault&file=BreadCrumb%2FDocument%20locations');
  });
});
