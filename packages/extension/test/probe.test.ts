// @vitest-environment jsdom
/**
 * The spike S1 page probe (synthetic markup standing in for Copilot pages).
 */
import { describe, expect, it } from 'vitest';
import { probePage } from '../src/probe.js';

function page(bodyHtml: string): Document {
  document.title = 'Copilot';
  document.body.innerHTML = bodyHtml;
  return document;
}

describe('probePage', () => {
  it('reports each Microsoft 365 URL with its attribute, element, ancestors and parse', () => {
    const doc = page(`
      <main data-testid="chat">
        <div role="article" class="turn assistant" data-message-id="m1">
          <p>See <a class="cite" href="https://contoso.sharepoint.com/:w:/r/sites/SiteA/Lib/Plan.docx?d=w1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6&csf=1&web=1" aria-label="Plan.docx">Plan</a></p>
          <span data-source-url="https://contoso-my.sharepoint.com/personal/user_contoso_onmicrosoft_com/Documents/Budget.xlsx">Budget</span>
          <a href="https://learn.microsoft.com/graph">docs</a>
        </div>
      </main>`);
    const report = probePage(doc);
    expect(report.totals.microsoftUrls).toBe(2);
    expect(report.totals.anchors).toBe(2);
    expect(report.hits).toHaveLength(2);

    const [link, data] = report.hits;
    expect(link).toMatchObject({ source: 'href', parse: { ok: true, form: 'sharing-path', state: 'Inferred' }, element: { tag: 'a', classes: 'cite', attributes: { 'aria-label': 'Plan.docx' } } });
    expect(link?.ancestors.slice(0, 3).map((a) => a.tag)).toEqual(['p', 'div', 'main']);
    expect(link?.ancestors[1]).toMatchObject({ role: 'article', classes: 'turn assistant', attributes: { 'data-message-id': 'm1' } });
    expect(data).toMatchObject({ source: 'data-source-url', parse: { ok: true, form: 'direct-path' }, element: { tag: 'span' } });
  });

  it('walks open shadow roots and records their depth, crossing back to the host in the ancestor chain', () => {
    const doc = page('<main><chat-turn id="outer"></chat-turn></main>');
    const outer = doc.getElementById('outer')!;
    const shadow = outer.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<citation-list id="inner"></citation-list>';
    const inner = shadow.getElementById('inner')!;
    inner.attachShadow({ mode: 'open' }).innerHTML = '<a role="link" href="https://contoso.sharepoint.com/sites/SiteA/Lib/Report.pdf">1</a>';
    const report = probePage(doc);
    expect(report.totals.openShadowRoots).toBe(2);
    expect(report.hits).toHaveLength(1);
    expect(report.hits[0]?.element.shadowDepth).toBe(2);
    expect(report.hits[0]?.ancestors.map((a) => `${a.tag}@${a.shadowDepth}`).slice(0, 3)).toEqual(['citation-list@1', 'chat-turn@0', 'main@0']);
  });

  it('lists citation chips that carry no URL and the iframes on the page', () => {
    const doc = page(`
      <main>
        <button aria-label="Citation 1, Plan.docx">1</button>
        <span role="button" title="Reference">[2]</span>
        <button>Send</button>
        <iframe src="https://contoso.sharepoint.com/_layouts/15/embed.aspx"></iframe>
        <custom-closed></custom-closed>
      </main>`);
    const report = probePage(doc);
    // The embedded SharePoint page is itself a Microsoft 365 URL and is reported; the chips are not.
    expect(report.hits.map((h) => `${h.element.tag}.${h.source}`)).toEqual(['iframe.src']);
    expect(report.citationLike.map((c) => c.text)).toEqual(['1', '[2]']);
    expect(report.iframes).toEqual([{ src: 'https://contoso.sharepoint.com/_layouts/15/embed.aspx', host: 'contoso.sharepoint.com', sameOrigin: false, shadowDepth: 0 }]);
    expect(report.totals.customElementsWithoutOpenShadow).toBe(1);
  });

  it('finds URLs in an element\'s own text and stays under the size cap', () => {
    const many = Array.from({ length: 200 }, (_, i) => `<div class="c${i}"><a href="https://contoso.sharepoint.com/sites/SiteA/Lib/F${i}.pdf">${'x'.repeat(50)}</a></div>`).join('');
    const doc = page(`<main><p>Plain text https://contoso.sharepoint.com/sites/SiteA/Lib/Text.pdf here.</p>${many}</main>`);
    const report = probePage(doc);
    expect(report.hits[0]).toMatchObject({ source: 'text', url: 'https://contoso.sharepoint.com/sites/SiteA/Lib/Text.pdf' });
    expect(report.truncated).toBe(true);
    expect(JSON.stringify(report).length).toBeLessThanOrEqual(60000);
  });
});
