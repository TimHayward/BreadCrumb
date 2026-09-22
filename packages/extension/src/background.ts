/**
 * Service worker. The popup asks the content script for citations and does
 * the rest itself; the worker hosts only the SharePoint session test from the
 * options page (spike S9), because it is a context that may send the user's
 * SharePoint cookies to hosts they granted.
 */
import { runSessionTest } from './spTest.js';

chrome.runtime.onInstalled.addListener((details) => {
  console.info(`BreadCrumb extension ${details.reason}`);
});

chrome.runtime.onMessage.addListener((message: { type?: string; links?: unknown }, _sender, sendResponse: (response: unknown) => void) => {
  if (message.type !== 'breadcrumb:sp-test' || !Array.isArray(message.links)) {
    return false;
  }
  const links = message.links.filter((l): l is string => typeof l === 'string');
  void runSessionTest(links, {
    hasPermission: (host) => chrome.permissions.contains({ origins: [`https://${host}/*`] }),
  })
    .then((reports) => sendResponse({ ok: true, reports }))
    .catch((error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  return true; // answer asynchronously
});
