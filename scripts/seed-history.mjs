#!/usr/bin/env node
// Seeds a history database with synthetic, anonymised rows and times a
// search over them (BC-032 performance criterion).
//
//   pnpm build && node scripts/seed-history.mjs <database-path> [count]
//
// Uses the built app package so the rows go through the real store.
import { performance } from 'node:perf_hooks';
import { parseLink } from '../packages/parser/dist/index.js';
import { openDatabase } from '../packages/app/dist/db/connection.js';
import { SqliteHistoryStore } from '../packages/app/dist/db/historyStore.js';
import { migrate } from '../packages/app/dist/db/migrate.js';

const path = process.argv[2];
const count = Number(process.argv[3] ?? 5000);
if (!path) {
  console.error('usage: node scripts/seed-history.mjs <database-path> [count]');
  process.exit(2);
}

const sites = ['SiteA', 'SiteB'];
const libraries = ['Shared Documents', 'Lib', 'Projects'];
const folders = ['General', 'Archive 2024', 'Client Alpha', 'Client Beta', 'R&D'];
const files = ['Report', 'Minutes', 'Budget', 'Plan', 'Proposal'];
const extensions = ['pdf', 'docx', 'xlsx', 'pptx'];

function link(i) {
  const site = sites[i % sites.length];
  const lib = libraries[i % libraries.length];
  const folder = folders[i % folders.length];
  const name = `${files[i % files.length]} ${i}.${extensions[i % extensions.length]}`;
  const enc = (s) => encodeURIComponent(s);
  const id = `/sites/${site}/${lib}/${folder}/${name}`;
  switch (i % 4) {
    case 0:
      return `https://contoso.sharepoint.com/sites/${site}/${enc(lib)}/Forms/AllItems.aspx?id=${enc(id)}&parent=${enc(`/sites/${site}/${lib}/${folder}`)}`;
    case 1:
      return `https://contoso.sharepoint.com/sites/${site}/${enc(lib)}/${enc(folder)}/${enc(name)}`;
    case 2:
      return `https://contoso.sharepoint.com/:w:/r/sites/${site}/${enc(lib)}/${enc(folder)}/${enc(name)}?csf=1&web=1&e=Ab12Cd`;
    default:
      return `https://contoso.sharepoint.com/:b:/s/${site}/EaBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789abc?e=Ab12Cd`;
  }
}

const db = openDatabase(path);
migrate(db);
const store = new SqliteHistoryStore(db);
const before = store.count();
const start = performance.now();
db.exec('BEGIN');
const base = Date.UTC(2026, 0, 1);
for (let i = 0; i < count; i++) {
  const input = link(i);
  store.insert({ source: i % 5 === 0 ? 'extension' : 'web', input, result: parseLink(input), createdAt: new Date(base + i * 60000).toISOString() });
}
db.exec('COMMIT');
console.log(`inserted ${count} rows in ${Math.round(performance.now() - start)} ms (total now ${store.count()}, was ${before})`);

for (const q of ['Client Beta', 'minutes 42', 'zzz-no-match', 'Report']) {
  const t = performance.now();
  const page = store.list({ page: 1, pageSize: 50, filters: { q } });
  console.log(`search "${q}": ${page.total} matches, first page in ${(performance.now() - t).toFixed(1)} ms`);
}
const t = performance.now();
store.list({ page: 1, pageSize: 50, filters: { q: 'Report', state: 'Inferred', source: 'web' } });
console.log(`combined search and filters in ${(performance.now() - t).toFixed(1)} ms`);
db.close();
