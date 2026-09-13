/**
 * Service worker. The popup asks the content script for citations and talks
 * to the API itself; the worker hosts spike S9, the SharePoint session test,
 * because it is the context that may send the user's SharePoint cookies to
 * hosts they granted on the options page.
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
