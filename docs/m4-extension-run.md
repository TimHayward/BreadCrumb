# M4 extension run checklist

The extension scaffold (BC-042) and the popup and submission logic (BC-044, BC-045) are complete and unit tested. Citation extraction (BC-043) uses placeholder selectors until spike S1 delivers real DOM captures, and the network path from the popup to the API (spike S6, decision D6) has not been tried from another machine. This checklist covers what needs a real browser and real Copilot pages.

## BC-042 load unpacked

1. `pnpm build`, then in Chrome and in Edge: Extensions → Developer mode → Load unpacked → `packages/extension/dist`.
2. Open each of the three hosts. Press F12: no console errors from `content.js`. Open the popup: it renders (a list, "No citations found", or the consumer empty state).
3. Options → enter the API base URL → Save.

## Spike S1: capture the markup

On `m365.cloud.microsoft` and `copilot.cloud.microsoft`, ask Copilot something that cites a SharePoint file, a OneDrive file and a web page. Then:

- [ ] If the popup lists the citations, copy the shape of the citation URLs into the table below and note the container strategy (right click the popup → Inspect, and log `extracted.strategy` in `popup.ts`).
- [ ] If it says "No citations found": press **Report markup** and paste the clipboard into `packages/extension/test/captures/<host>-<kind>.html`. The sample is redacted (text becomes x's, URLs keep only the host), so it is safe to commit. Then use the Elements panel to find the citation element and note: the element and attribute that hold the file URL, whether it sits in the light DOM or a shadow root (and how deep), and the most stable role, `data-*` attribute or aria label near it.
- [ ] Repeat on `copilot.microsoft.com` for a web citation.

| Host | Citation kind | Element and attribute holding the URL | Light DOM or shadow root (depth) | Stable selector to use |
|---|---|---|---|---|
| m365.cloud.microsoft | SharePoint file | | | |
| m365.cloud.microsoft | OneDrive file | | | |
| copilot.cloud.microsoft (2026-09-12) | SharePoint file (Doc.aspx) | Inline entity link `a.sef-entity-link[data-testid="fl-link"]` → `href`; numbered citation `button.fai-BebopCitation` → `data-grouped-citations`, a JSON array of `{ index, occurrence, url }` | Light DOM; no shadow roots; only iframe is `login.microsoftonline.com` | Answer: `[data-testid="lastChatMessage"] [data-testid="markdown-reply"]`; links: `[data-testid="fl-link"]`, `[data-grouped-citations]`. A "Sources" button (`data-testid="sources-button-testid"`) opens a panel not yet probed. Links are `_layouts/15/Doc.aspx?sourcedoc=…&file=…&action=edit` or `action=default` for the same file. |
| copilot.cloud.microsoft | OneDrive file | | | |
| copilot.microsoft.com | web page | | | |

Put the selectors into `RESPONSE_SELECTORS` in `packages/extension/src/extract.ts` (and the attribute name into the collection loop if it is not `href` or `data-*`), add each capture as a case in `test/extract.test.ts`, and run `pnpm test`.

## Spike S6: reach the API from another machine

From a second machine on the private network, with the API base URL pointing at the host's LAN address:

- [ ] Chrome: select a citation and Send. Record whether the request succeeded, and if not, the exact console error (mixed content, private network access, CORS).
- [ ] Edge: same.
- [ ] If Chrome blocks it: check whether the preflight carried `Access-Control-Request-Private-Network` (the API answers `Access-Control-Allow-Private-Network: true`) and whether moving the call into the service worker (`src/background.ts`) changes the outcome. Record which context succeeded.
- [ ] Decide D6 (plain HTTP, private CA TLS, or a reverse proxy) from what you saw.

## BC-043 to BC-046 acceptance

- [ ] Work host, response citing two files with one cited twice: popup lists two rows, each with file name, folder, state badge and the inferred marker where applicable.
- [ ] Unresolved citation (a `/:x:/s/` sharing token): row says it needs validation in the web application and can still be selected.
- [ ] Select and Send: each row shows "Sent: entry N (state)"; the history page shows them with source `extension`.
- [ ] Stop the BreadCrumb stack and Send: every row shows the reachability error naming the base URL.
- [ ] Clear the API base URL and Send: the popup explains where to set it and sends nothing.
- [ ] Consumer host with only web citations: the defined empty state with a link to the web application, no error.
- [ ] Consumer host with a SharePoint URL in the response text: that URL is offered like a work citation.

## Closing

Move S1 and S6 with their findings, decide D6 and D7 in `BACKLOG.md`, then `node scripts/complete-story.mjs --sha <commit> BC-042 BC-043 BC-044 BC-045 BC-046` and add recordings from each host under `docs/evidence/m4/`.

## Spike S9: resolving with the browser's SharePoint session

Run from the extension options page ("Test SharePoint session"); results are posted to the BreadCrumb log.

| Date, browser | Link | GetFileById | Library root | v2.0 shares | Notes |
|---|---|---|---|---|---|
| 2026-09-13, Edge | `Doc.aspx?sourcedoc=` on the tenant host (two files) | 200, exact `ServerRelativeUrl` | 200, library root (`/sites/…/Shared Documents`) | 200, Graph-shaped driveItem with `parentReference` | Same paths Graph returned for these files. No sign in, consent or app registration. |
| 2026-09-13, Edge | `/:w:/r/personal/…/_layouts/15/doc2.aspx?sourcedoc=` on the `-my` host | 401 | 401 | 401 `unauthenticated` (`UnauthenticatedVroomException`) | Likely no session cookie yet for the `-my` host: SharePoint's cookie is per host and is set when OneDrive is first opened in the browser. To re-test after opening OneDrive once. |
| Chrome | | | | | To run. |
| Sharing link `/:x:/s/…` | | | | | To run. |
| Permission prompt wording (Edge, Chrome) | | | | | To record. |
