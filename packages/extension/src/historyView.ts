/**
 * BC-056: choosing what to show from what is kept, and getting it out
 * again. Pure text and array work, so the rules are tested without a page.
 */
import type { HistoryEntry } from './history.js';

export interface HistoryFilter {
  /** Matched against file name, path and the original link, case insensitively. */
  search?: string;
  /** A confidence state, or 'any'. */
  state?: string;
  /** 'extracted', 'pasted', or 'any'. */
  source?: string;
  /** Only entries already written to the Obsidian note. */
  sentOnly?: boolean;
}

/** Newest first, which is the order someone looking for what they just did wants. */
export function newestFirst(entries: readonly HistoryEntry[]): HistoryEntry[] {
  return [...entries].sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
}

export function filterEntries(entries: readonly HistoryEntry[], filter: HistoryFilter = {}): HistoryEntry[] {
  const needle = (filter.search ?? '').trim().toLowerCase();
  return newestFirst(entries).filter((entry) => {
    if (filter.state !== undefined && filter.state !== 'any' && entry.state !== filter.state) {
      return false;
    }
    if (filter.source !== undefined && filter.source !== 'any' && (entry.source ?? 'extracted') !== filter.source) {
      return false;
    }
    if (filter.sentOnly === true && entry.sentToNoteAt === undefined) {
      return false;
    }
    if (needle === '') {
      return true;
    }
    // The three things someone searches by: what it is called, where it is, and the link itself.
    return [entry.label, entry.path, entry.folder, entry.url].some((field) => field !== undefined && field.toLowerCase().includes(needle));
  });
}

/** The states present in what is kept, so the filter offers only what is there. */
export function statesIn(entries: readonly HistoryEntry[]): string[] {
  return [...new Set(entries.map((entry) => entry.state))].sort();
}

/** A local, readable moment: the same shape the note uses. */
export function formatSeen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const COLUMNS: Array<[string, (entry: HistoryEntry) => string]> = [
  ['Document name', (e) => e.label],
  ['File path', (e) => e.path ?? ''],
  ['Folder', (e) => e.folder ?? ''],
  ['Folder URL', (e) => e.folderUrl ?? ''],
  ['Source URL', (e) => e.url],
  ['State', (e) => e.state],
  ['How it was worked out', (e) => e.methodText ?? ''],
  ['Found in', (e) => e.source ?? 'extracted'],
  ['Page', (e) => e.pageUrl ?? ''],
  ['First seen', (e) => formatSeen(e.firstSeenAt)],
  ['Last seen', (e) => formatSeen(e.lastSeenAt)],
  ['Written to note', (e) => (e.sentToNoteAt === undefined ? '' : formatSeen(e.sentToNoteAt))],
  ['Was', (e) => (e.upgradedFrom === undefined ? '' : `${e.upgradedFrom.state}${e.upgradedFrom.path === undefined ? '' : ` at ${e.upgradedFrom.path}`}`)],
  ['Document key', (e) => e.documentKey],
];

function csvCell(value: string): string {
  // A field with a comma, a quote or a newline has to be quoted, and quotes doubled.
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

export function toCsv(entries: readonly HistoryEntry[]): string {
  const header = COLUMNS.map(([name]) => csvCell(name)).join(',');
  const rows = entries.map((entry) => COLUMNS.map(([, read]) => csvCell(read(entry))).join(','));
  // Excel opens a UTF-8 file correctly when it starts with a byte order mark.
  return `﻿${[header, ...rows].join('\r\n')}\r\n`;
}

export function toJson(entries: readonly HistoryEntry[]): string {
  return `${JSON.stringify({ exportedAt: new Date().toISOString(), entries }, null, 2)}\n`;
}

/** `breadcrumb-history-2026-09-25.csv`, so several exports sit together in order. */
export function exportName(extension: 'csv' | 'json', now = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `breadcrumb-history-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.${extension}`;
}
