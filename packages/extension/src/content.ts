/**
 * Content script: answers the popup's requests with citations from the
 * current page, or a redacted markup sample. Never throws into the page's
 * console (BC-043): every failure becomes an empty answer.
 */
import { extractCitations, redactedSample } from './extract.js';
import { surfaceOf } from './hosts.js';
import type { ContentToPopup, PopupToContent } from './messages.js';

chrome.runtime.onMessage.addListener((message: PopupToContent, _sender, sendResponse: (response: ContentToPopup) => void) => {
  const host = window.location.hostname;
  const surface = surfaceOf(host);
  try {
    if (message.type === 'breadcrumb:extract') {
      const { citations, strategy } = extractCitations(document, surface);
      sendResponse({ type: 'breadcrumb:extracted', surface, host, citations, strategy });
      return false;
    }
    if (message.type === 'breadcrumb:sample') {
      sendResponse({ type: 'breadcrumb:sample', sample: redactedSample(document, surface) });
      return false;
    }
  } catch (error) {
    if (message.type === 'breadcrumb:sample') {
      sendResponse({ type: 'breadcrumb:sample', sample: `<!-- sampling failed: ${error instanceof Error ? error.message : String(error)} -->` });
    } else {
      sendResponse({ type: 'breadcrumb:extracted', surface, host, citations: [], strategy: `extraction failed: ${error instanceof Error ? error.message : String(error)}` });
    }
  }
  return false;
});
