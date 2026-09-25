// Bundles the extension with esbuild. The parser is pulled in from the
// workspace package, never copied (invariant 1).
import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';

// Start from nothing. A file left behind by an earlier build is a file the
// manifest no longer names, and the store package would carry it anyway.
rmSync('dist', { recursive: true, force: true });
mkdirSync('dist', { recursive: true });

await build({
  entryPoints: {
    popup: 'src/popup.ts',
    options: 'src/options.ts',
    content: 'src/content.ts',
    historyPage: 'src/historyPage.ts',
  },
  bundle: true,
  format: 'esm',
  target: 'chrome120',
  outdir: 'dist',
  sourcemap: true,
  logLevel: 'info',
});

for (const file of ['manifest.json', 'src/popup.html', 'src/popup.css', 'src/options.html', 'src/history.html', 'src/history.css']) {
  cpSync(file, `dist/${file.replace(/^src\//, '')}`);
}
cpSync('icons', 'dist/icons', { recursive: true });
