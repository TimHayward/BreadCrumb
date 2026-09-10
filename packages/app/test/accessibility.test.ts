/**
 * Automated accessibility check (BC-028) with axe-core running inside jsdom.
 * jsdom has no layout engine, so colour contrast is checked by hand against
 * the palette in public/app.css and the rule is disabled here.
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TOKEN_LINK, WORKED_EXAMPLE, createTestServer, postForm, type TestContext } from './helpers.js';

const require = createRequire(import.meta.url);
const axeSource = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

interface AxeViolation {
  id: string;
  impact: string;
  help: string;
  nodes: Array<{ target: string[] }>;
}

async function seriousViolations(html: string): Promise<string[]> {
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
  const window = dom.window as unknown as { eval(code: string): void; axe: { run(ctx: unknown, opts: unknown): Promise<{ violations: AxeViolation[] }> }; document: unknown };
  window.eval(axeSource);
  const results = await window.axe.run(window.document, { rules: { 'color-contrast': { enabled: false } } });
  dom.window.close();
  return results.violations
    .filter((v) => v.impact === 'critical' || v.impact === 'serious')
    .map((v) => `${v.id} (${v.impact}): ${v.help} at ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

describe('accessibility (BC-028)', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestServer();
  });

  afterEach(async () => {
    await ctx.app.close();
    ctx.db.close();
  });

  it('conversion page, results and failures have no critical or serious axe issues', async () => {
    expect(await seriousViolations((await ctx.app.inject({ method: 'GET', url: '/' })).body)).toEqual([]);
    expect(await seriousViolations((await postForm(ctx.app, '/convert', { link: WORKED_EXAMPLE })).body)).toEqual([]);
    expect(await seriousViolations((await postForm(ctx.app, '/convert', { link: TOKEN_LINK })).body)).toEqual([]);
    expect(await seriousViolations((await postForm(ctx.app, '/convert', { link: 'nope' })).body)).toEqual([]);
  });

  it('history list, detail and delete confirmation have no critical or serious axe issues', async () => {
    await postForm(ctx.app, '/convert', { link: WORKED_EXAMPLE });
    await postForm(ctx.app, '/convert', { link: TOKEN_LINK });
    expect(await seriousViolations((await ctx.app.inject({ method: 'GET', url: '/history' })).body)).toEqual([]);
    expect(await seriousViolations((await ctx.app.inject({ method: 'GET', url: '/history?q=zzz' })).body)).toEqual([]);
    expect(await seriousViolations((await ctx.app.inject({ method: 'GET', url: '/history/1' })).body)).toEqual([]);
    expect(await seriousViolations((await postForm(ctx.app, '/history/delete', { ids: ['1', '2'] })).body)).toEqual([]);
  });

  it('state badges carry a symbol as well as text, so state is never colour alone', async () => {
    const body = (await postForm(ctx.app, '/convert', { link: WORKED_EXAMPLE })).body;
    expect(body).toMatch(/<span class="badge badge-derived"[^>]*><span aria-hidden="true">◆<\/span> Derived<\/span>/);
  });
});
