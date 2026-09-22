// Bundles the extension with esbuild. The parser is pulled in from the
// workspace package, never copied (invariant 1).
import { build } from 'esbuild';
import { cpSync, mkdirSync } from 'node:fs';

mkdirSync('dist', { recursive: true });

await build({
  entryPoints: {
    popup: 'src/popup.ts',
    options: 'src/options.ts',
    content: 'src/content.ts',
    background: 'src/background.ts',
  },
  bundle: true,
  format: 'esm',
  target: 'chrome120',
  outdir: 'dist',
  sourcemap: true,
  logLevel: 'info',
});

for (const file of ['manifest.json', 'src/popup.html', 'src/popup.css', 'src/options.html']) {
  cpSync(file, `dist/${file.replace(/^src\//, '')}`);
}
cpSync('icons', 'dist/icons', { recursive: true });
