// Bundles the extension with esbuild. The parser is pulled in from the
// workspace package, never copied (invariant 1).
import { build } from 'esbuild';
import { cpSync, mkdirSync } from 'node:fs';

mkdirSync('dist', { recursive: true });

await build({
  entryPoints: { popup: 'src/popup.ts' },
  bundle: true,
  format: 'esm',
  target: 'chrome120',
  outdir: 'dist',
  sourcemap: true,
  logLevel: 'info',
});

cpSync('manifest.json', 'dist/manifest.json');
cpSync('src/popup.html', 'dist/popup.html');
