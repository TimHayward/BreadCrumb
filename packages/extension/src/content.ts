/**
 * Content script: answers the popup's requests with citations from the
 * current page, a redacted markup sample, or a diagnostic probe. Never throws
 * into the page's console (BC-043): every failure becomes an empty answer.
 */
import { extractCitations, redactedSample } from './extract.js';
import { surfaceOf } from './hosts.js';
import type { ContentToPopup, PopupToContent } from './messages.js';
import { probePage } from './probe.js';

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

chrome.runtime.onMessage.addListener((message: PopupToContent, _sender, sendResponse: (response: ContentToPopup) => void) => {
  const host = window.location.hostname;
  const surface = surfaceOf(host);
  try {
    if (message.type === 'breadcrumb:extract') {
      const { citations, strategy } = extractCitations(document, surface);
      sendResponse({ type: 'breadcrumb:extracted', surface, host, citations, strategy });
    } else if (message.type === 'breadcrumb:sample') {
      sendResponse({ type: 'breadcrumb:sample', sample: redactedSample(document, surface) });
    } else if (message.type === 'breadcrumb:probe') {
      sendResponse({ type: 'breadcrumb:probe', report: probePage(document) });
    }
  } catch (error) {
    if (message.type === 'breadcrumb:sample') {
      sendResponse({ type: 'breadcrumb:sample', sample: `<!-- sampling failed: ${errorText(error)} -->` });
    } else if (message.type === 'breadcrumb:probe') {
      sendResponse({ type: 'breadcrumb:probe', report: null, error: errorText(error) });
    } else {
      sendResponse({ type: 'breadcrumb:extracted', surface, host, citations: [], strategy: `extraction failed: ${errorText(error)}` });
    }
  }
  return false;
});
