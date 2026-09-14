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
| 2026-09-13, Edge | `/:w:/r/personal/…/_layouts/15/doc2.aspx?sourcedoc=` on the `-my` host | 401 | 401 | 401 `unauthenticated` (`UnauthenticatedVroomException`) | Before OneDrive had been opened in this browser: no session cookie for the `-my` host (SharePoint's cookie is per host). |
| 2026-09-13, Edge, after opening OneDrive once | same `-my` link | 200, `/personal/…/Documents/Documents/Work/CV - V2.2.docx` | 200, `/personal/…/Documents` | 200, `parentReference.path` `root:/Documents/Work` | Confirms the per-host cookie: OneDrive links resolve only once OneDrive has been visited in the browser session. Same path Graph returned. |
| 2026-09-13, Edge | `/:w:/r/personal/…/Report.docx?d=…&csf=1&web=1&e=…` (file) and `/:f:/r/personal/…/Attachments?d=…` (folder), from Share → Copy link on the `-my` host | not tried (no sourcedoc) | not tried | 200 for both; name and `parentReference.path` match the link's path, and `sharepointIds.listItemUniqueId` equals the link's `d` | Copy link produced `/r/` links here, not `/s/` tokens. |
| 2026-09-14, Edge | fresh `/:t:/s/Site/{token}?e=…` ("People in the organisation" link) | not tried | not tried | 200; `name` and `parentReference.path` give the file and its folders, `sharepointIds.siteUrl` the site; SharePoint routed the call to the item's site on its own | Sharing tokens resolve by session too. The library name needs the drive (`/_api/v2.0/drives/{id}`), the same second call the Graph validator makes. |
| Chrome | | | | | To run. |
| 2026-09-13, Edge | `/:t:/s/Site/{token}?email=…&e=…` (a specific-people link) | not tried | not tried | 404 `itemNotFound` "Requested sharing link could not be found" | Inconclusive: Graph gives the same 404 for this link since 2026-09-12, although it resolved it on 2026-09-11, so the link was removed or expired. Re-test with a fresh `/s/` link. |
| Permission prompt wording (Edge, Chrome) | | | | | To record. |

## BC-049 acceptance (Edge, 2026-09-14)

- Access granted per tenant from the options page; the popup confirmed every citation on the granted hosts through SharePoint's `/_api/v2.0/shares` endpoint with the browser's session: 3 of 3, 3 of 3 and 7 of 7 citations across three popup openings on `copilot.cloud.microsoft`.
- Sending recorded each confirmation as the entry's validation: 10 entries Verified in BreadCrumb with "Confirmed by SharePoint, using your browser session", and no background tab opened.
- Reopening the popup on the same answer skipped the session for documents BreadCrumb already had Verified.
- Also confirmed by the user on a second tenant (not logged on this server).
- Fallback (no access, or OneDrive before it is opened) covered by tests; seen live in spike S9 as a 401 on the `-my` host.
- Edge's permission prompt wording: to record.
