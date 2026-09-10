/**
 * Service worker. Nothing runs in the background in v1: the popup asks the
 * content script for citations and talks to the API itself. The worker
 * exists so the extension has the three Manifest V3 parts BC-042 names and
 * so a future version can move API calls here if spike S6 finds that the
 * popup context is blocked.
 */
chrome.runtime.onInstalled.addListener((details) => {
  console.info(`BreadCrumb extension ${details.reason}`);
});
