/**
 * Page probe for spike S1: where do Microsoft 365 links sit in a Copilot
 * response? Walks the light DOM and every open shadow root and reports, for
 * each element carrying a SharePoint or OneDrive URL, the attribute that held
 * it, the element's identifying attributes and its ancestor chain, plus the
 * page's iframes and numbered citation chips that carry no URL at all (a sign
 * that the links live outside the DOM).
 *
 * The report goes to the BreadCrumb server log (CLIENT_LOG=true) and the
 * clipboard, so selectors can be fitted to the real markup. It is capped in
 * size to fit the server's 64 KB limit for client events.
 */
import { classifyHost, parseLink } from '@breadcrumb/parser';

export interface ProbeNode {
  tag: string;
  id?: string;
  classes?: string;
  role?: string;
  /** aria-* and data-* attributes (values truncated). */
  attributes: Record<string, string>;
  shadowDepth: number;
}

export interface ProbeHit {
  url: string;
  /** Attribute name that held the URL, or `text` for a URL in the element's own text. */
  source: string;
  parse: { ok: boolean; form?: string; state?: string; reason?: string };
  element: ProbeNode;
  ancestors: ProbeNode[];
}

export interface ProbeReport {
  host: string;
  path: string;
  title: string;
  totals: {
    elements: number;
    openShadowRoots: number;
    /** Custom elements with children in neither light DOM nor an open shadow root: possibly closed shadow roots. */
    customElementsWithoutOpenShadow: number;
    anchors: number;
    microsoftUrls: number;
  };
  hits: ProbeHit[];
  /** Numbered or labelled citation chips that carry no Microsoft 365 URL. */
  citationLike: Array<{ element: ProbeNode; text: string; ancestors: ProbeNode[] }>;
  iframes: Array<{ src: string; host: string; sameOrigin: boolean; shadowDepth: number }>;
  truncated: boolean;
}

const MAX_HITS = 60;
const MAX_CHIPS = 25;
const MAX_ANCESTORS = 8;
const MAX_VALUE = 160;
const MAX_REPORT_CHARS = 60000;
const URL_PATTERN = /https?:\/\/[^\s"'<>`)\]]+/g;
const CITATION_LABEL = /citation|reference|source|footnote|\bref\b/i;
const CHIP_TEXT = /^\[?\s*\d{1,2}\s*\]?$/;

function* walk(root: ParentNode, depth: number, counter: { roots: number }): Generator<[Element, number]> {
  for (const element of Array.from(root.querySelectorAll('*'))) {
    yield [element, depth];
    if (element.shadowRoot !== null) {
      counter.roots += 1;
      yield* walk(element.shadowRoot, depth + 1, counter);
    }
  }
}

function clip(value: string, max = MAX_VALUE): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function describe(element: Element, shadowDepth: number): ProbeNode {
  const node: ProbeNode = { tag: element.tagName.toLowerCase(), attributes: {}, shadowDepth };
  const id = element.getAttribute('id');
  if (id !== null && id !== '') node.id = clip(id, 80);
  const classes = element.getAttribute('class');
  if (classes !== null && classes.trim() !== '') node.classes = clip(classes.trim(), 120);
  const role = element.getAttribute('role');
  if (role !== null) node.role = role;
  for (const attribute of Array.from(element.attributes)) {
    if (attribute.name.startsWith('aria-') || attribute.name.startsWith('data-')) {
      node.attributes[attribute.name] = clip(attribute.value);
    }
  }
  return node;
}

/** Ancestors up to MAX_ANCESTORS, crossing shadow boundaries to the host element. */
function ancestry(element: Element, shadowDepth: number): ProbeNode[] {
  const chain: ProbeNode[] = [];
  let current: Node | null = element;
  let depth = shadowDepth;
  while (chain.length < MAX_ANCESTORS && current !== null) {
    let parent: Node | null = current.parentNode;
    if (parent !== null && parent.nodeType === 11 && (parent as ShadowRoot).host !== undefined) {
      parent = (parent as ShadowRoot).host;
      depth -= 1;
    }
    if (parent === null || parent.nodeType !== 1) {
      break;
    }
    chain.push(describe(parent as Element, Math.max(depth, 0)));
    current = parent;
  }
  return chain;
}

function microsoftUrls(value: string): string[] {
  const found: string[] = [];
  for (const match of value.matchAll(URL_PATTERN)) {
    const url = match[0].replace(/[.,;:!?]+$/, '');
    try {
      if (classifyHost(new URL(url).hostname).kind !== 'unknown') {
        found.push(url);
      }
    } catch {
      // not a URL
    }
  }
  return found;
}

function ownText(element: Element): string {
  let text = '';
  for (const child of Array.from(element.childNodes)) {
    if (child.nodeType === 3) text += child.textContent ?? '';
  }
  return text;
}

function parseSummary(url: string): ProbeHit['parse'] {
  const result = parseLink(url);
  return result.ok ? { ok: true, form: result.form, state: result.state } : { ok: false, reason: result.reason };
}

export function probePage(doc: Document): ProbeReport {
  const counter = { roots: 0 };
  const report: ProbeReport = {
    host: doc.location?.hostname ?? '',
    path: doc.location?.pathname ?? '',
    title: clip(doc.title ?? '', 120),
    totals: { elements: 0, openShadowRoots: 0, customElementsWithoutOpenShadow: 0, anchors: 0, microsoftUrls: 0 },
    hits: [],
    citationLike: [],
    iframes: [],
    truncated: false,
  };
  const seen = new Set<string>();

  for (const [element, depth] of walk(doc, 0, counter)) {
    report.totals.elements += 1;
    const tag = element.tagName.toLowerCase();
    if (tag === 'a') report.totals.anchors += 1;
    if (tag.includes('-') && element.shadowRoot === null && element.children.length === 0 && (element.textContent ?? '').trim() === '') {
      report.totals.customElementsWithoutOpenShadow += 1;
    }
    if (tag === 'iframe') {
      const src = element.getAttribute('src') ?? '';
      let host = '';
      try {
        host = src === '' ? '' : new URL(src, doc.location?.href).hostname;
      } catch {
        host = '';
      }
      let sameOrigin = false;
      try {
        sameOrigin = (element as HTMLIFrameElement).contentDocument !== null;
      } catch {
        sameOrigin = false;
      }
      report.iframes.push({ src: clip(src, 200), host, sameOrigin, shadowDepth: depth });
    }

    let carried = false;
    const sources: Array<[string, string]> = Array.from(element.attributes).map((a) => [a.name, a.value]);
    sources.push(['text', ownText(element)]);
    for (const [source, value] of sources) {
      if (!value.includes('http')) continue;
      for (const url of microsoftUrls(value)) {
        carried = true;
        report.totals.microsoftUrls += 1;
        const key = `${source}|${url}|${tag}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (report.hits.length >= MAX_HITS) {
          report.truncated = true;
          continue;
        }
        report.hits.push({ url, source, parse: parseSummary(url), element: describe(element, depth), ancestors: ancestry(element, depth) });
      }
    }

    if (!carried && report.citationLike.length < MAX_CHIPS) {
      const text = (element.textContent ?? '').trim();
      const label = `${element.getAttribute('aria-label') ?? ''} ${element.getAttribute('title') ?? ''}`;
      const clickable = tag === 'a' || tag === 'button' || element.getAttribute('role') === 'button' || element.getAttribute('role') === 'link';
      if (clickable && (CHIP_TEXT.test(text) || CITATION_LABEL.test(label))) {
        report.citationLike.push({ element: describe(element, depth), text: clip(text, 60), ancestors: ancestry(element, depth).slice(0, 4) });
      }
    }
  }
  report.totals.openShadowRoots = counter.roots;

  // Keep the report under the server's limit: drop ancestor chains from the tail first.
  let json = JSON.stringify(report);
  for (let i = report.hits.length - 1; json.length > MAX_REPORT_CHARS && i >= 0; i--) {
    const hit = report.hits[i];
    if (hit !== undefined && hit.ancestors.length > 0) {
      hit.ancestors = [];
      report.truncated = true;
      json = JSON.stringify(report);
    }
  }
  while (json.length > MAX_REPORT_CHARS && report.hits.length > 0) {
    report.hits.pop();
    report.truncated = true;
    json = JSON.stringify(report);
  }
  return report;
}
