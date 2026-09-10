// Copies non-TypeScript assets (SQL migrations, static files) into dist so the
// built package is self contained for `pnpm deploy` and the container image.
import { cpSync, existsSync } from 'node:fs';

const copies = [
  ['src/db/migrations', 'dist/db/migrations'],
  ['public', 'dist/public'],
];

for (const [from, to] of copies) {
  if (existsSync(from)) {
    cpSync(from, to, { recursive: true });
  }
}
