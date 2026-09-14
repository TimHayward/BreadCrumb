#!/usr/bin/env node
// Moves finished stories or spikes from BACKLOG.md to BACKLOG-completed.md.
//
//   node scripts/complete-story.mjs --sha <commit> [--date YYYY-MM-DD] [--note "..."] BC-001 BC-002 ...
//
// Each story block (from its "#### BC-nnn" heading to the next heading or
// rule) is removed verbatim from BACKLOG.md, appended under "## Completed"
// in BACKLOG-completed.md with a "**Completed:** <date> · <sha>" line, and
// its ID is removed from the milestone story lists in section 6.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  if (i === -1) return fallback;
  const value = args[i + 1];
  args.splice(i, 2);
  return value;
};
const sha = opt('--sha');
const date = opt('--date', new Date().toISOString().slice(0, 10));
const note = opt('--note', '');
const ids = args;

if (!sha || ids.length === 0) {
  console.error('usage: node scripts/complete-story.mjs --sha <commit> [--date YYYY-MM-DD] [--note "..."] BC-001 ...');
  process.exit(2);
}

const root = resolve(import.meta.dirname, '..');
const backlogPath = resolve(root, 'BACKLOG.md');
const completedPath = resolve(root, 'BACKLOG-completed.md');
let backlog = readFileSync(backlogPath, 'utf8');
let completed = readFileSync(completedPath, 'utf8');

const moved = [];
for (const id of ids) {
  const headingIndex = backlog.search(new RegExp(`^#### ${id}\\b.*$`, 'm'));
  if (headingIndex === -1) {
    console.error(`${id}: no "#### ${id}" heading found in BACKLOG.md`);
    process.exit(1);
  }
  const rest = backlog.slice(headingIndex);
  const endMatch = /\n(?=#{1,4} |---\n)/.exec(rest.slice(1));
  const end = endMatch === null ? rest.length : endMatch.index + 1;
  const block = rest.slice(0, end).trimEnd();
  backlog = backlog.slice(0, headingIndex) + backlog.slice(headingIndex + end).replace(/^\n+/, '');

  // Shrink the milestone lists in section 6.
  backlog = backlog.replace(/^(Stories: )(.*)$/gm, (line, prefix, list) => {
    const remaining = list
      .replace(/\.$/, '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s !== '' && s !== id);
    return `${prefix}${remaining.length === 0 ? 'none remaining' : remaining.join(', ')}.`;
  });

  moved.push(`${block}\n\n${note ? `${note}\n\n` : ''}**Completed:** ${date} · ${sha}\n`);
}

completed = completed.replace(/\n*None yet\.\n*/, '\n');
// Completed entries go at the end of "## Completed", before any "## Withdrawn" section.
const withdrawnAt = completed.search(/^## Withdrawn\b/m);
completed =
  withdrawnAt === -1
    ? `${completed.trimEnd()}\n\n${moved.join('\n')}`
    : `${completed.slice(0, withdrawnAt).trimEnd()}\n\n${moved.join('\n')}\n${completed.slice(withdrawnAt)}`;

writeFileSync(backlogPath, backlog);
writeFileSync(completedPath, completed);
console.log(`moved ${ids.join(', ')} to BACKLOG-completed.md (${date} · ${sha})`);
