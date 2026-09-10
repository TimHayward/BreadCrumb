/**
 * Citation extraction from a Copilot page (BC-043, BC-046).
 *
 * Until spike S1 delivers annotated DOM captures, the per host selector lists
 * below are a best effort: they look for the response region by common roles
 * and attributes, then collect every link or bare URL inside it that the
 * shared parser recognises as a Microsoft 365 host. S1 replaces the selector
 * lists per host; the collection, deduplication and redaction stay.
 */
import { classifyHost } from '@breadcrumb/parser';
import { surfaceOf, type SurfaceKind } from './hosts.js';
import type { Citation } from './messages.js';

/** Candidate response containers per surface, most specific first. Placeholders pending S1. */
export const RESPONSE_SELECTORS: Record<SurfaceKind, string[]> = {
  work: ['[data-testid*="assistant"]', '[data-testid*="response"]', '[role="article"]', '[aria-label*="Copilot"]', 'main'],
  consumer: ['[data-testid*="response"]', '[role="article"]', 'main'],
  other: ['main'],
};

const URL_IN_TEXT = /https?:\/\/[^\s<>"'`)\]]+/g;

/** Whether a URL is worth offering: on a host the parser knows. */
export function isMicrosoftLink(url: string): boolean {
  try {
    return classifyHost(new URL(url).hostname).kind !== 'unknown';
  } catch {
    return false;
  }
}

/** Walks open shadow roots as well as the light DOM. */
function* allElements(root: ParentNode): Generator<Element> {
  const walker = root.querySelectorAll('*');
  for (const element of walker) {
    yield element;
    if (element.shadowRoot !== null) {
      yield* allElements(element.shadowRoot);
    }
  }
}

function findContainer(doc: Document, surface: SurfaceKind): { container: ParentNode; strategy: string } {
  for (const selector of RESPONSE_SELECTORS[surface]) {
    const matches = doc.querySelectorAll(selector);
    const last = matches[matches.length - 1];
    if (last !== undefined) {
      return { container: last, strategy: `container ${selector} (last of ${matches.length})` };
    }
  }
  return { container: doc.body, strategy: 'document body (no known container)' };
}

function trimUrl(raw: string): string {
  return raw.replace(/[.,;:!?)]+$/, '');
}

/**
 * Collects candidate citations from links (href, and data attributes that
 * hold a URL) and from bare URLs in text, deduplicated by URL, in document
 * order.
 */
export function extractCitations(doc: Document, surface: SurfaceKind = surfaceOf(doc.location.hostname)): { citations: Citation[]; strategy: string } {
  const { container, strategy } = findContainer(doc, surface);
  const seen = new Map<string, Citation>();
  const add = (url: string, text?: string): void => {
    const cleaned = trimUrl(url.trim());
    if (cleaned === '' || !isMicrosoftLink(cleaned) || seen.has(cleaned)) {
      return;
    }
    const citation: Citation = { url: cleaned };
    const label = text?.trim();
    if (label !== undefined && label !== '' && label !== cleaned) {
      citation.text = label;
    }
    seen.set(cleaned, citation);
  };

  for (const element of allElements(container)) {
    if (element instanceof HTMLAnchorElement || element.tagName === 'A') {
      const href = element.getAttribute('href');
      if (href !== null) {
        add(href, element.textContent ?? undefined);
      }
    }
    for (const attribute of Array.from(element.attributes)) {
      if (attribute.name.startsWith('data-') && /^https?:\/\//i.test(attribute.value)) {
        add(attribute.value, element.textContent ?? undefined);
      }
    }
  }
  const text = container instanceof Element ? container.textContent ?? '' : doc.body.textContent ?? '';
  for (const match of text.matchAll(URL_IN_TEXT)) {
    add(match[0]);
  }
  return { citations: [...seen.values()], strategy };
}

/**
 * A redacted copy of the likely response container for the "report markup"
 * action: tags and attribute names survive, text becomes x's of the same
 * length, and URLs keep only their host.
 */
export function redactedSample(doc: Document, surface: SurfaceKind = surfaceOf(doc.location.hostname), limit = 6000): string {
  const { container } = findContainer(doc, surface);
  const clone = (container instanceof Element ? container : doc.body).cloneNode(true) as Element;
  const walker = doc.createTreeWalker(clone, 0x4 | 0x1);
  // The walker never returns its root, so the container's own attributes are handled too.
  const nodes: Node[] = [clone];
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    nodes.push(node);
  }
  for (const node of nodes) {
    if (node.nodeType === 3) {
      node.textContent = (node.textContent ?? '').replace(/\S/g, 'x');
    } else if (node instanceof Element) {
      for (const attribute of Array.from(node.attributes)) {
        if (/^https?:\/\//i.test(attribute.value)) {
          try {
            node.setAttribute(attribute.name, `https://${new URL(attribute.value).hostname}/…`);
          } catch {
            node.setAttribute(attribute.name, '…');
          }
        } else if (attribute.name !== 'class' && attribute.name !== 'role' && !attribute.name.startsWith('data-') && !attribute.name.startsWith('aria-')) {
          node.setAttribute(attribute.name, attribute.value.replace(/\S/g, 'x'));
        }
      }
    }
  }
  const html = clone.outerHTML;
  return html.length > limit ? `${html.slice(0, limit)}\n<!-- truncated at ${limit} characters -->` : html;
}
