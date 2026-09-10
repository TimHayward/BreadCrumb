// @vitest-environment jsdom
/**
 * Extraction against synthetic page fragments (BC-043, BC-046). These stand
 * in for the annotated DOM captures spike S1 will add under test/captures/;
 * once those exist, each capture becomes a case here.
 */
import { describe, expect, it } from 'vitest';
import { extractCitations, isMicrosoftLink, redactedSample } from '../src/extract.js';

function page(bodyHtml: string): Document {
  document.body.innerHTML = bodyHtml;
  return document;
}

describe('extractCitations', () => {
  it('collects each SharePoint or OneDrive link once, in order, ignoring other links', () => {
    const doc = page(`
      <main>
        <div role="article">Earlier turn <a href="https://contoso.sharepoint.com/sites/SiteA/Lib/Old.docx">Old</a></div>
        <div role="article">
          The plan is in <a href="https://contoso.sharepoint.com/:w:/r/sites/SiteA/Lib/Folder/Plan.docx?d=w1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6&csf=1&web=1&e=Ab12Cd">Plan.docx</a>
          and again <a href="https://contoso.sharepoint.com/:w:/r/sites/SiteA/Lib/Folder/Plan.docx?d=w1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6&csf=1&web=1&e=Ab12Cd">Plan.docx</a>.
          See <a href="https://learn.microsoft.com/graph">docs</a> and the budget <span data-href="https://contoso-my.sharepoint.com/personal/user_contoso_onmicrosoft_com/Documents/Budget.xlsx">Budget</span>.
        </div>
      </main>`);
    const { citations, strategy } = extractCitations(doc, 'work');
    expect(strategy).toContain('[role="article"]');
    expect(citations).toEqual([
      { url: 'https://contoso.sharepoint.com/:w:/r/sites/SiteA/Lib/Folder/Plan.docx?d=w1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6&csf=1&web=1&e=Ab12Cd', text: 'Plan.docx' },
      { url: 'https://contoso-my.sharepoint.com/personal/user_contoso_onmicrosoft_com/Documents/Budget.xlsx', text: 'Budget' },
    ]);
  });

  it('finds links inside open shadow roots', () => {
    const doc = page('<main><div id="host"></div></main>');
    const host = doc.getElementById('host')!;
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<a href="https://contoso.sharepoint.com/sites/SiteA/Lib/Report.pdf">Report</a>';
    expect(extractCitations(doc, 'work').citations.map((c) => c.url)).toEqual(['https://contoso.sharepoint.com/sites/SiteA/Lib/Report.pdf']);
  });

  it('offers a bare SharePoint URL in the text of a consumer response, trailing punctuation removed', () => {
    const doc = page('<main><div role="article">Try https://contoso.sharepoint.com/sites/SiteA/Lib/Report.pdf. Also https://www.example.com/x.</div></main>');
    expect(extractCitations(doc, 'consumer').citations).toEqual([{ url: 'https://contoso.sharepoint.com/sites/SiteA/Lib/Report.pdf' }]);
  });

  it('returns no citations, and does not throw, when the markup has no known shape', () => {
    const doc = page('<div><p>Nothing here</p></div>');
    const { citations, strategy } = extractCitations(doc, 'work');
    expect(citations).toEqual([]);
    expect(strategy).toContain('document body');
  });

  it('isMicrosoftLink recognises parser hosts only', () => {
    expect(isMicrosoftLink('https://1drv.ms/x/s!AaBb')).toBe(true);
    expect(isMicrosoftLink('https://teams.microsoft.com/l/file/x')).toBe(true);
    expect(isMicrosoftLink('https://learn.microsoft.com/')).toBe(false);
    expect(isMicrosoftLink('not a url')).toBe(false);
  });
});

describe('redactedSample (report markup)', () => {
  it('keeps structure and attribute names but replaces text and URLs', () => {
    const doc = page('<main><div role="article" data-testid="msg" title="Secret title"><p>Client Alpha budget</p><a href="https://contoso.sharepoint.com/sites/Finance/Lib/Secret.xlsx">Secret.xlsx</a></div></main>');
    const sample = redactedSample(doc, 'work');
    expect(sample).toContain('role="article"');
    expect(sample).toContain('data-testid="msg"');
    expect(sample).not.toContain('Client Alpha');
    expect(sample).not.toContain('Secret');
    expect(sample).not.toContain('Finance');
    expect(sample).toContain('https://contoso.sharepoint.com/…');
    expect(sample).toMatch(/<p>x+ x+ x+<\/p>/);
  });

  it('truncates long samples', () => {
    const doc = page(`<main><div role="article">${'<p>word</p>'.repeat(2000)}</div></main>`);
    const sample = redactedSample(doc, 'work', 500);
    expect(sample.length).toBeLessThan(600);
    expect(sample).toContain('truncated at 500');
  });
});
