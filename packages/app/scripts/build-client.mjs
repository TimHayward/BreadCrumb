// Bundles the browser side of authenticated validation (MSAL plus the pure
// Graph validator) into public/validate.js. Runs as part of `pnpm build`
// and before `pnpm dev`; the output is generated, not committed.
import { build } from 'esbuild';

await build({
  entryPoints: { validate: 'src/client/dom/validate.ts' },
  bundle: true,
  format: 'esm',
  target: ['chrome120', 'edge120', 'firefox120', 'safari17'],
  outdir: 'public',
  sourcemap: true,
  minify: true,
  logLevel: 'info',
});
