# BreadCrumb product backlog

Repository: github.com/TimHayward/BreadCrumb
Document date: 10 September 2026
Status: draft for review. Planning artefact only. No application code, schema, compose or configuration content appears in this document.

**How to use this file.** Each story is self contained and written to be executed cold by an AI coding model or a developer with no other context. Pick a story, read its dependencies, implement, and satisfy every acceptance criterion. Where a story names a spike, the spike closes first and its evidence is linked from the story before implementation starts.

**When a story is done.** Once its acceptance criteria genuinely pass, move the whole story verbatim out of this file into `BACKLOG-completed.md` under a `## Completed` heading, appending a `**Completed:** <YYYY-MM-DD> · <commit SHA>` line. Keep the ID. IDs are never reused. Spikes are moved the same way once their closing evidence exists, with a one line summary of the finding. A story or spike that is dropped moves under a `## Withdrawn` heading with the date and the reason. This file only ever contains open work, so the milestone lists in section 6 shrink as stories complete.

**Design rules.** Section 13 lists the architectural invariants that every story must respect. A story that would break an invariant is re-planned, not implemented.

Conventions used throughout:

- Confidence states, used identically everywhere: **Verified** (confirmed by an authenticated Microsoft 365 lookup: Microsoft Graph, or SharePoint using the user's browser session; the method text names the call), **Derived** (decoded deterministically from the link with no guesswork), **Inferred** (best effort where at least one component is a guess, such as the document library boundary), **Unresolved** (the form is recognised but cannot be decoded without authentication).
- **[unverified]** marks a claim I am not certain of. Every such marker names the spike that closes it.
- Priorities: **Must**, **Should**, and **Could** (a want: done only when time allows, low priority).
- Sizes: XS under half a day, S one to two days, M three to five days, L one to two weeks, XL longer than two weeks, for one developer.

---

## 1. Product summary

BreadCrumb is a self hosted tool that turns any Microsoft 365 SharePoint or OneDrive for Business link into the folder location it points at. A user pastes a link into the web application and receives the decoded server relative path, the containing folder URL, the direct file URL and a breakdown of tenant, site, document library, folder chain and file name. Every conversion is stored in a searchable history held in SQLite on a dedicated Docker named volume. A Microsoft Edge extension extracts file citations from Microsoft Copilot responses, resolves them with the same shared parser, confirms them with the user's SharePoint session where the user allows it, and submits selected items to the web application. Every result states how it was obtained using four states: Verified, Derived, Inferred and Unresolved.

---

## 2. Assumptions

Each line is a gap in the brief that I filled. Correct any that are wrong before M1 starts.

- A single small team uses the tool from the same private network as the host. Write load is a few requests per minute at most.
- Microsoft Edge (current stable) is the primary browser, for both the web application and the extension. Chrome and other Chromium browsers are a low priority want (BC-050) and untested. Firefox and Safari are best effort for the web pages and out of scope for the extension.
- The extension is loaded unpacked in developer mode or pushed by enterprise policy. Store publication is not needed for v1.
- The personal test tenant is an Entra work tenant with SharePoint and OneDrive for Business, not a consumer Microsoft account.
- The web application is served over plain HTTP on the private network in v1 unless the TLS open decision (D6) says otherwise.
- The extension learns the API base URL from a value the user types into the extension options page. There is no discovery mechanism.
- Node LTS at the time M1 starts is the target runtime, and the exact version is pinned during M1.
- The tenant name is the first label of the host, so `848` in the worked example. The site path is `/sites/{name}` or `/teams/{name}`. Links on the root site have an empty site path and the library is the first path segment.
- Corrections made by authenticated validation are recorded alongside the original best effort result rather than overwriting it, so the upgrade is visible.
- Personal (consumer) OneDrive is not supported (decided 2026-09-14). Links on `onedrive.live.com` and `1drv.ms` are recognised only to tell the user they are not supported (BC-051). The server makes no outbound requests.
- Export is a download of the currently filtered history. Import is not required.
- The user interface is English only.
- Authenticated validation targets the global Microsoft cloud only. Sovereign cloud links parse in best effort mode only.
- The compose file defines one application service and the named volume. No reverse proxy, TLS terminator or database service is included.
- "Copilot response" means the assistant turns rendered in the chat pane of the three named hosts. Copilot panes inside Word, Teams or Outlook are separate surfaces and out of scope.
- The API accepts one link per request. The extension submits selected items one at a time and reports per item outcomes. No batch endpoint is needed in v1.

---

## 3. Epics

| Epic | Goal | Value delivered |
|---|---|---|
| E1 Foundation and deployment | A TypeScript monorepo that builds one container image and deploys from Git through Portainer with durable storage. | The team can ship, redeploy and trust that history survives rebuilds. |
| E2 Shared link parser | One package that decodes every Microsoft 365 link form in best effort mode and labels its output honestly. Consumed by the web application (E3) and the extension (E6). | Coverage and correctness live in one place and are tested once. |
| E3 Web conversion experience | A page and an API that accept a link and return the path, folder URL, file URL and components with a clear confidence state. | The core value: paste a link, get the folder. |
| E4 Conversion history | Every conversion persisted, browsable, searchable, filterable, deletable and exportable. | Past lookups are never lost and can be found again. |
| E5 Authenticated validation | Optional Microsoft sign in that confirms or corrects best effort results through Microsoft Graph and records the upgrade. | Inferred and Unresolved results become Verified without changing the default no sign in path. |
| E6 Copilot extension | A Manifest V3 extension for Microsoft Edge that lifts file citations from Copilot responses on the three hosts, resolves them with the shared parser, confirms them with the user's SharePoint session where the user allows it, and submits chosen items to the API. | Citations become folder locations without copying links by hand. |
| E7 Operability | Health, logging, backup and restore for a single container with a SQLite file on a named volume. | The person running the stack can see it is healthy and can recover data. |

---

## 4. Link form matrix

Example shapes are anonymised. `contoso` stands for the tenant, `SiteA` for a site, `Lib` for a document library, `{guid}` for any GUID, `{token}` for an opaque sharing token and `{enc}` for a percent encoded server relative path.

Graph calls named here are the documented Microsoft Graph v1.0 calls I am confident exist. Where the exact call or permission is uncertain the row carries [unverified] and a spike reference. "Offline" means no network access and no sign in.

| # | Form | Example shape | Offline result | Graph call that resolves it | Confidence without Graph | Confidence with Graph | Story |
|---|---|---|---|---|---|---|---|
| 1 | Library view link with `id` and `parent` | `https://contoso.sharepoint.com/sites/SiteA/Lib/Forms/AllItems.aspx?id={enc}&parent={enc}` | Full | Site by path `GET /sites/{host}:/sites/SiteA`, then `GET /sites/{site-id}/drives` to confirm the library, then `GET /drives/{drive-id}/root:/{path}` | Path, folder and file: Derived. Library: Derived when the `id` path starts with the segment before `/Forms/`, otherwise Inferred | Verified | BC-007 |
| 1b | Classic view link with `RootFolder` and optional `viewid` | `.../Lib/Forms/AllItems.aspx?RootFolder={enc}&viewid={guid}` | Full | As row 1 | Folder: Derived. Library: as row 1. Whether modern tenants still emit this form is [unverified], see S3 | Verified | BC-007 |
| 2 | Direct server relative file or folder URL | `https://contoso.sharepoint.com/sites/SiteA/Lib/Folder/File.pdf` | Full | As row 1 | Path, folder and file: Derived. Library: Inferred | Verified | BC-008, BC-018 |
| 3a | Modern sharing link, `/r/` path bearing variant | `https://contoso.sharepoint.com/:w:/r/sites/SiteA/Lib/Folder/File.docx?d=w{guid}&csf=1&web=1&e={short}` | Full | As row 1. The `d` value is the item's unique id and can be cross checked against `sharepointIds.listItemUniqueId` on the returned driveItem | Path, folder and file: Derived. Library: Inferred | Verified | BC-010 |
| 3b | Modern sharing link, `/s/` token variant | `https://contoso.sharepoint.com/:b:/s/SiteA/{token}?e={short}` | Type code and site hint only | `GET /shares/{encoded}/driveItem` where `{encoded}` is `u!` followed by base64url of the full link. Minimum delegated permission [unverified], see S2 | Unresolved. Type of item (from the `:b:` style prefix) and site name are reported as Derived hints | Verified | BC-011 |
| 3c | Modern sharing link, `/g/` variant | `https://contoso.sharepoint.com/:x:/g/personal/user_contoso_onmicrosoft_com/{token}?e={short}` | Type code and site or personal site hint | As row 3b. Whether `/g/` always means an organisation scoped link is [unverified], see S3 | Unresolved | Verified | BC-011 |
| 3d | Modern sharing link, `/t/` variant | `https://contoso.sharepoint.com/:f:/t/SiteA/{token}?e={short}` | Type code and site hint | As row 3b. Meaning of `/t/` scope is [unverified], see S3 | Unresolved | Verified | BC-011 |
| 4 | `Doc.aspx` with `sourcedoc` GUID | `https://contoso.sharepoint.com/sites/SiteA/_layouts/15/Doc.aspx?sourcedoc=%7B{guid}%7D&file=File.docx&action=default` | Partial: site Derived, file name Derived when `file` is present, path Unresolved | Method to look up a driveItem by list item unique id is [unverified], see S5. `WopiFrame.aspx?sourcedoc=` is treated the same way | Unresolved (site and file name are Derived hints) | Verified, subject to S5 | BC-012 |
| 5 | `download.aspx` and similar layouts pages with `SourceUrl` | `https://contoso.sharepoint.com/sites/SiteA/_layouts/15/download.aspx?SourceUrl={enc}` | Full | As row 1 | Path, folder and file: Derived. Library: Inferred | Verified | BC-013 |
| 5b | `download.aspx` with `UniqueId` | `.../_layouts/15/download.aspx?UniqueId={guid}` | Partial: site Derived, item Unresolved | As row 4 | Unresolved | Verified, subject to S5 | BC-013 |
| 6 | OneDrive for Business personal site | `https://contoso-my.sharepoint.com/personal/user_contoso_onmicrosoft_com/_layouts/15/onedrive.aspx?id={enc}` and direct `https://contoso-my.sharepoint.com/personal/user_contoso_onmicrosoft_com/Documents/Folder/File.xlsx` | Full | `GET /sites/{host}:/personal/{alias}` to resolve the personal site [unverified that personal sites resolve by path, see S2], then as row 1 | Path, folder and file: Derived. Library: Inferred, defaulting to `Documents` | Verified | BC-014 |
| 7a | OneDrive consumer, `onedrive.live.com` with `cid` and `resid` | `https://onedrive.live.com/?cid={hex}&resid={hex}%21{n}&authkey={key}` | Fails cleanly: consumer OneDrive is not supported | Not applicable | No result state. Reason code `consumer_onedrive` with a message saying this is a consumer OneDrive link and not supported | Not applicable | BC-051 |
| 7b | OneDrive consumer short link | `https://1drv.ms/x/s!{token}` and `https://1drv.ms/b/s/{token}` | Fails cleanly as row 7a. The link is never fetched or expanded | Not applicable | As row 7a | Not applicable | BC-051 |
| 8 | Guest access links | Modern: identical in shape to rows 3b to 3d; nothing in the URL distinguishes a guest recipient [unverified], see S3. Legacy: `https://contoso.sharepoint.com/sites/SiteA/_layouts/15/guestaccess.aspx?docid={id}&authkey={key}` [unverified whether still emitted], see S3 | Type and site hints only | As row 3b for modern. Legacy form: `/shares` with the full URL [unverified], see S2 | Unresolved | Verified where `/shares` accepts it | BC-011 |
| 9 | Teams deep link wrapping a file URL | `https://teams.microsoft.com/l/file/{guid}?tenantId={guid}&fileType=docx&objectUrl={enc-full-url}&baseUrl={enc}&serviceName=teams&threadId={id}&groupId={guid}` | Full unwrap, then as the inner form | As the inner form | As the inner form. The wrapper is recorded in the result | As the inner form | BC-016 |
| 10 | Outlook Safe Links wrapper | `https://{region}.safelinks.protection.outlook.com/?url={enc-full-url}&data={blob}&sdata={blob}&reserved=0` and the `/ap/{code}/?url=` variant [unverified, see S3] | Full unwrap, then as the inner form | As the inner form | As the inner form. The wrapper is recorded in the result | As the inner form | BC-017 |
| 11 | Copy link output carrying `csf`, `web` and `e`, with or without `d` | Any of rows 1, 2 or 3a with `?csf=1&web=1&e={short}` appended | Full | As the underlying row | As the underlying row. The parameters are stripped from output URLs and `d` is retained as an identifier | As the underlying row | BC-010 |
| 12 | Sovereign and government cloud hosts | Rows 1 to 6 on `sharepoint.us`, `sharepoint-mil.us` or `sharepoint.cn` hosts, and on `-my` variants of each | As the matching row | Graph endpoints differ by cloud and are not configured in v1 | As the matching row | Not in v1 | BC-020 |
| 13 | Folder rather than file, in any of the above | Row 1 with `id` equal to `parent`, row 2 ending in a folder, row 3 with a `:f:` prefix | As the matching row | As the matching row | As the matching row, with no file component and the folder URL equal to the path | As the matching row | BC-019 |
| 14 | Malformed, truncated or non Microsoft links | Any input that is not a URL, is missing its host, has a cut off query string, or points at an unrelated host | Fails cleanly | Not applicable | No result state. A reason code and message are returned instead | Not applicable | BC-021 |

Notes on the matrix:

- A modern sharing link in the `/s/`, `/g/` or `/t/` variants cannot be expanded by an unauthenticated HTTP request. Fetching it without a session redirects to sign in, so the web application must not attempt it. The server fetches no link of any form.
- The library boundary is only deterministic in row 1, where the page path places `/Forms/AllItems.aspx` at the library root. In every other form the split between site, library and folders is Inferred until Graph confirms it by listing the site's drives.

---

## 5. User stories

Story format: ID and title, user story sentence, acceptance criteria as Given, When, Then, then priority, size and dependencies. Every criterion is written to be tested on its own.

### E1 Foundation and deployment

#### BC-003 Portainer stack deploys the same compose file from Git

**On hold (2026-09-14):** the rollout is paused until the planned user interface enhancements are resolved. HTTPS from a private CA is ready for it (`docs/https-private-ca.md`).

As the person running BreadCrumb, I want to deploy the stack in Portainer straight from the Git repository, so that the repository is the single source of truth.

- Given a Portainer instance with access to the repository, When a stack is created from the Git repository pointing at the root compose file with no edits, Then the stack deploys and the application answers on the configured port.
- Given the same compose file, When it is used both by the Portainer Git stack and by `docker compose up` locally (BC-002), Then both start the application with identical service and volume names and no file differs between the two uses.
- Given a new commit on the tracked branch, When the stack is redeployed from Portainer, Then the new image is built and the previous container is replaced.
- Given the Portainer stack is redeployed, When history is inspected afterwards, Then all entries from before the redeploy are present (this is the Portainer path of BC-004).

Priority: Must. Size: S. Depends on: BC-002.

### E2 Shared link parser

#### BC-051 Consumer OneDrive links say they are not supported

As a user, I want a personal (consumer) OneDrive link to be named as such and refused, so that I know straight away BreadCrumb cannot help with it rather than seeing an Unresolved result that never resolves.

- Given a `onedrive.live.com` link or a `1drv.ms` short link, When it is converted in the web application or the API, Then the result is a failure with reason code `consumer_onedrive` and a message saying it is a personal (consumer) OneDrive link, which is not supported, and naming the host.
- Given such a link on the conversion page, When the failure is shown, Then the heading says consumer OneDrive links are not supported and no "keep in history" action is offered.
- Given such a link cited in a Copilot response, When the extension popup lists it, Then it shows the same message and the row is not selected for submission.
- Given any consumer OneDrive link, When it is converted, Then the server makes no outbound request, and the short link expansion feature and its `SHORTLINK_EXPANSION_ENABLED` and `SHORTLINK_TIMEOUT_MS` variables no longer exist.

Priority: Must. Size: S. Depends on: BC-015, BC-021. Supersedes the Unresolved criteria of BC-015 and withdraws BC-027.

### E3 Web conversion experience

### E4 Conversion history

### E5 Authenticated validation

### E6 Copilot extension

#### BC-050 Chrome and other Chromium browsers

As a user of Chrome or another Chromium browser, I want the extension and the web application to work there too, so that I am not tied to Edge.

- Given the extension loaded unpacked in current stable Chrome, When the acceptance criteria of BC-042 to BC-049 are run, Then they pass or each difference from Edge is recorded.
- Given the web application in Chrome, When sign in and validation (BC-036 to BC-041) are run, Then they pass or each difference from Edge is recorded.

Priority: Could (a want, low priority). Size: S. Depends on: BC-042, BC-049.

### E7 Operability

## 6. Release plan

Progress is reported only at the boundaries below. Each milestone is done when its demonstrable outcome has been shown from a deployed stack, not from a developer machine.

### M1 Walking skeleton

Stories: BC-003.

Demonstrable outcome: the repository is a TypeScript monorepo with the compose file at its root. The same compose file is deployed as a Portainer Git stack and runs under `docker compose up` locally (BC-003). The worked example link converts end to end on the deployed stack with a Derived state and appears in the history list. A conversion written before the image is rebuilt and the stack redeployed is still present afterwards, on a named volume separate from the container filesystem (BC-004).

Deliberately excluded: every link form other than the library view form, confidence labelling beyond the single state badge, search, filters, delete, export, sign in, the extension, backup documentation. The health endpoint (BC-047) is included only because the compose health check needs it. No story depends on Graph, sign in or tenant consent.

Progress evidence at the boundary: a screen recording or screenshots of the Portainer stack, the conversion, the rebuild and the surviving history row.

### M2 Breadth and history

Stories: none remaining.

Demonstrable outcome: every row of the link form matrix converts in best effort mode with the confidence state and per component inferred markers the matrix predicts, or fails with the message it predicts. The fixture corpus covers every row. History is searchable and filterable at five thousand rows, entries can be deleted singly and in bulk, and the filtered set exports as CSV and JSON. Backup and restore have been rehearsed once.

Deliberately excluded: anything Verified. Sign in, Graph calls and tenant consent are absent. The extension is absent. Spikes S1, S2 and S5 may run during M2 but nothing in M2 depends on them.

Progress evidence at the boundary: the fixture corpus report showing one pass per matrix row, and an export file from the deployed stack.

### M3 Authenticated validation

Stories: none remaining.

Demonstrable outcome: a user signs in against the personal test tenant, validates an Inferred result whose library boundary was guessed wrongly, sees it corrected and upgraded to Verified, and sees the "was inferred as" record beneath it. An Unresolved sharing token resolves to a Verified path. The history list shows which rows were upgraded. Signing out removes the token and the default no sign in path is unchanged.

Deliberately excluded: production tenant consent, server side token storage, consumer OneDrive (not supported, BC-051), sovereign cloud Graph endpoints, automatic re-validation of old rows. BC-039 ships only if spike S5 closes with a working method.

Progress evidence at the boundary: a recorded validation of three fixtures against the test tenant, one each from the Inferred and Unresolved states plus one Derived, with before and after states.

### M4 Extension

Stories: none remaining.

Demonstrable outcome: in Microsoft Edge, on `m365.cloud.microsoft` and `copilot.cloud.microsoft`, a Copilot response citing SharePoint and OneDrive files is opened, the popup lists the files with their folders and states (confirmed folders straight away where the user has granted SharePoint access), selected items are submitted and appear in history with source `extension`. On `copilot.microsoft.com` the popup shows the defined empty state.

Deliberately excluded: store publication, Chrome and other Chromium browsers (BC-050, Could), Firefox and Safari, Copilot panes inside Office and Teams, Microsoft Graph validation from inside the popup (the extension confirms with the SharePoint session, BC-049; Graph stays in the web application), automatic submission without selection.

Progress evidence at the boundary: a recording on each of the three hosts, and the history rows produced.

---

## 7. Spikes

Each spike is timeboxed. If the timebox ends without the closing evidence, the dependent stories are re-planned rather than the spike extended.

| ID | Question | Timebox | Closing evidence | Blocks |
|---|---|---|---|---|
| S2 | Does the Graph shares endpoint with a `u!` base64url encoded link return a driveItem for `/s/`, `/g/` and `/t/` tokens and for `-my` host tokens, what is the minimum delegated permission, does it work for a token created by another user, does the legacy `guestaccess.aspx` form resolve, and does a personal site resolve by path? | 1 day | A table of link variant against result and HTTP status from the test tenant, with the exact permission set that succeeded and the smallest set that failed. Removes the [unverified] markers in matrix rows 3b, 3c, 3d, 6 and 8. | BC-038, BC-037 (personal site case) |
| S3 | Which link forms does a modern tenant actually emit from its own copy link and share controls today: the SharePoint library "Copy link" for each audience option, OneDrive web, the Office desktop share dialogue, the Teams files tab, an Outlook attachment link, and a Copilot citation? Do `RootFolder`, `guestaccess.aspx` and the Safe Links `/ap/` variant still appear? What do `/g/` and `/t/` mean? | 1 day | One anonymised fixture per control and audience option added to the corpus (BC-022), and a note against each matrix row saying "emitted today", "legacy but seen" or "not observed". Removes the [unverified] markers in rows 1b, 3c, 3d, 8 and 10. | BC-022 completeness. Nothing in M1 or M2 is blocked. |
| S6 | Can a Manifest V3 extension on an `https` Copilot page submit to an `http` API on a private network address from another machine? Which of the popup, service worker and content script may make the call, does the browser's private network access restriction or mixed content blocking interfere, and what CORS headers does the API need? | 1 day | A test extension reaching a stub API from a second machine on the private network, in Microsoft Edge (Chrome only under BC-050), with a record of what was blocked and which context succeeded. Feeds decision D6. | BC-045, D6 |
| S7 | How does a Portainer Git stack behave in practice: how are environment variables supplied, does "pull and redeploy" preserve named volumes, does removing the stack remove volumes, and does a private repository need stored credentials? Some of this is [unverified] from documentation alone. | Half a day | A runbook of the exact clicks, and a redeploy and a removal each followed by a check of the volume. | BC-003, BC-004 |

---

## 8. Test strategy

**Fixture corpus.** The parser package holds a corpus of link fixtures, one file per case, grouped by link form matrix row. Each fixture records the input link, the expected state, the expected path, folder URL and file URL, the expected components with their Derived or Inferred flag, the expected wrappers removed, the expected method text and, for failures, the expected reason code. Negative fixtures for BC-021 sit alongside. The corpus is data, not code, so a new case needs no test code.

**Anonymisation before entry to the repository.** No real link enters the repository. A contributor takes the real link, applies the anonymisation checklist and commits only the result. The checklist: replace the tenant with `contoso`, sites with `SiteA` and `SiteB`, personal site aliases with `user_contoso_onmicrosoft_com`, folder and file names with neutral names that keep the same encoding characteristics (spaces, hyphens, full stops, ampersands, non ASCII characters), regenerate every GUID, replace sharing tokens with random strings of the same length and character class, truncate Safe Links `data` and `sdata` blobs to a fixed placeholder, and replace Teams thread and group identifiers. A check run in continuous integration fails the build if a fixture contains a host other than the documented placeholders, a string that looks like a real tenant, or a token longer than the placeholder length. Client names and file titles from the 848 tenant never appear in fixtures; the worked example from the brief is the single exception and is retained verbatim because the brief already publishes it.

**Adding a new link form as a regression case.** The order is fixed: anonymise the link, add a fixture with the expected result written by hand, watch it fail, add or change the parser rule, watch the whole corpus pass, add a matrix row to this document. A parser change that alters an existing fixture's expected output must update that fixture in the same change and bump the parser version (BC-006).

**Testing the parser independently of both consumers.** The parser's tests run in Node with no browser, no server and no network, and they run the whole corpus. A second run executes the same corpus inside a headless Chromium context to prove the package has no Node only dependency. Each consumer then has a thin contract test: the web application posts every corpus input to its API and compares the response with the fixture; the extension's test harness feeds every corpus input through its popup model and compares. If a consumer test fails while the parser test passes, the fault is in the consumer's adapter, not the parser.

**Encoding round trip.** A property style test takes every decoded path from the corpus, rebuilds the URL, decodes it again and asserts equality, catching double encoding (BC-009).

**Persistence and deployment tests.** BC-004 is tested by a script that records a conversion, rebuilds the image, restarts and checks the row. It runs in continuous integration with plain Docker Compose and is rehearsed by hand in Portainer at each milestone boundary.

**History performance.** A seed script inserts five thousand synthetic rows on a fresh volume, and BC-032's timing criterion is measured against it on the reference host.

**Graph tests.** M3 stories are tested against the personal test tenant using a small set of files created for the purpose. Recorded responses, anonymised the same way as links, back a replay mode so the suite runs without the tenant.

**Extension tests.** DOM captures from S1 are the fixtures for BC-043. Extraction tests run against the captures, not the live sites, so a markup change shows up as a capture that needs refreshing rather than a flaky test.

---

## 9. Non functional requirements

| Area | Requirement |
|---|---|
| Container image | Multi stage build producing one runtime image with no compiler or source in the final layer. Target under 250 MB, measured in S4 and revisited if the SQLite decision needs native tooling. Build under five minutes on the Portainer host. |
| Persistence | Database on a named volume declared in the compose file, never a bind mount or the container filesystem. Rebuild, redeploy and stack removal without volume removal must leave history intact (BC-004). |
| Compose file | One file at the repository root used unchanged by Portainer from Git and by `docker compose up` locally (BC-003). No overrides needed for the basic case. |
| Configuration and secrets | Environment variables only, documented with defaults and validated at start (BC-005). No secrets in the repository, in the image or in logs. The Graph client registration is a public client so no client secret exists. |
| Backup and restore | Documented, rehearsed at M2, safe while the application runs, including write ahead log companion files (BC-048). |
| Error handling | No unhandled exception reaches a user or crashes the process. Every failure carries a reason code and plain language message. Failures are logged with enough context to reproduce, without full links when redacted logging is set. |
| Performance | Conversion under 100 ms on the server for any offline form. History search under one second at five thousand rows and acceptable at twenty thousand (BC-032). Page loads under two seconds on the private network. |
| Browser support | Microsoft Edge (current stable) is the primary and only required browser, for the web application and the extension. Chrome and other Chromium browsers are a low priority want (BC-050). Firefox and Safari are best effort for the web pages only. |
| Accessibility | WCAG 2.2 AA for contrast and keyboard operation, state never conveyed by colour alone (BC-028). |
| Network posture | The application listens on one port and makes no outbound requests. Graph calls are made from the browser and SharePoint session calls from the extension, never from the server. |
| Logging | Structured, one line per request, with a redaction switch (BC-047). |
| Data sensitivity | History holds client names and file titles. There is no access control in v1, so the host must be reachable only on the private network, and the README says so in its first section. |

---

## 10. Risk register

Likelihood and impact are High, Medium or Low. Owner is a placeholder role until names are assigned.

| ID | Risk | Likelihood | Impact | Mitigation | Owner |
|---|---|---|---|---|---|
| R1 | Copilot citation markup changes without notice on any of the three hosts, breaking extraction. | High | Medium | Select on the most stable roles and attributes found in S1, keep DOM captures as fixtures, fail to a "no citations found" state with a report action (BC-043), and treat each host's selectors as separately replaceable. | Extension owner |
| R2 | Delegated permission consent is refused or delayed in the production tenant. | Medium | Medium | Best effort mode is the default and never depends on consent. Test on the personal tenant first. Ask for the smallest permission S2 proves sufficient, and document the request for the tenant administrator early in M3. | Product owner |
| R3 | Some link forms cannot be resolved at all, even with Graph. | Medium | Low | They remain Unresolved with an honest message. Spikes S2 and S5 find out early. The matrix records the ceiling per form. | Parser owner |
| R4 | Stored client names and file titles are sensitive and the application has no access control. | High | High | Private network only, stated in the README and in the compose file comments. Redacted logging. Delete and export exist so data can be pruned. Access control timing is decision D4. | Product owner |
| R5 | The application becomes reachable beyond the private network, for example by a port forward or a host with a public interface. | Medium | High | The compose file binds to the host's private interface by default. The health page shows the bound address. D4 revisits access control before any wider hosting. | Operations owner |
| R6 | The extension cannot reach the API from a different machine or network because of mixed content, private network access restrictions or CORS. | Medium | High | Spike S6 before M4. Decision D6 on serving the API over TLS. The popup reports reachability failures by base URL (BC-045). | Extension owner |
| R7 | Extension installation is blocked by browser policy on managed devices. | Medium | Medium | Confirm with the device administrator whether unpacked or policy pushed extensions are allowed before M4 starts, and whether the optional SharePoint host permission (BC-049) may be granted. The web application works without the extension. | Product owner |
| R8 | SQLite limits bite if the tool spreads to a team: concurrent writes, a single file, no network access to the database. | Low | Medium | The data access layer (BC-029) isolates the engine. Write ahead logging for concurrency. Watch row counts and error rates. Moving engine is a planned later change, not a v1 requirement. | Developer |
| R9 | The library boundary heuristic is wrong often enough that Inferred results mislead. | Medium | Medium | Always label Inferred. Measure the hit rate against Graph during M3 and refine the rules in BC-018 from real data. | Parser owner |
| R10 | Short link expansion needs outbound access the host does not have, or Microsoft changes redirect behaviour. **Closed 2026-09-14:** short link expansion was withdrawn with consumer OneDrive support (BC-051). | None | None | Not applicable. | Developer |
| R11 | A native SQLite module fails to build in the container image or breaks on a Node upgrade. | Medium | Medium | Spike S4 and decision D2. Pin the Node version. | Developer |
| R12 | The Verified state is asserted by the browser, since Graph calls happen there, so a modified client could store a false Verified row. | Low | Low | Acceptable on a private network without access control. Record the Graph item id with every Verified row so it can be re-checked. Revisit with D3 and D4. | Product owner |

---

## 11. Open decisions

| ID | Decision needed | Options | What it blocks | Who decides |
|---|---|---|---|---|
| D1 | Web framework and whether to use an ORM or a query builder for the data access layer. | A minimal HTTP framework with hand written queries; a fuller framework with an ORM; a query builder with migrations but no ORM. The choice must not leak past the data access layer. | BC-002, BC-024, BC-029 | Repository owner |
| D2 | SQLite driver approach. **Decided 2026-09-10: the Node built in `node:sqlite` module on Node 24.** Evidence in `docs/spikes/S4-sqlite.md`: WAL and online backup work, no compiler stage, 56 MB base image. | Native module with prebuilt binaries; native module built in a compiler stage; the Node built in SQLite module; a WebAssembly build. | Nothing. Closed. | Repository owner, after S4 |
| D3 | Where Graph tokens live. | Default for v1: held in the browser session only, Graph called from the browser, server receives results (BC-036). Alternative, not chosen: token sent per request to the server, which calls Graph and does not persist the token. Second alternative: server side persistence, which needs access control first. | BC-036, BC-037, BC-038 | Product owner. Default stands unless changed before M3. |
| D4 | When application level access control is introduced. | Not in v1 (locked); before the first deployment outside the private network; when a second team starts using it; when tokens move server side. | Any hosting change, D3 alternatives, R4 and R5 | Product owner |
| D5 | History search implementation. **Decided 2026-09-10: substring matching (`LIKE` over the denormalised columns) in the data access layer.** Measured with `scripts/seed-history.mjs`: first page of a search in 16 to 35 ms at 5,000 rows and 83 to 171 ms at 20,000 rows, far inside the one second criterion. Full text search is not needed for v1. | Substring matching in the data access layer; SQLite full text search. | Nothing. Closed. | Developer |
| D6 | Whether the API is served over TLS on the private network and, if so, how certificates are issued. | Plain HTTP; TLS with a private certificate authority trusted on client devices; TLS terminated by a reverse proxy outside this stack. Decided from S6. | BC-045 | Operations owner, after S6 |
| D7 | How the extension is distributed. | Unpacked developer mode; enterprise policy from a private update URL; browser store. | BC-042 rollout, R7 | Product owner |
| D8 | Whether failed conversions are kept in history by default. | Never kept; kept only when the user opts in (assumed in BC-026); always kept. | BC-026, BC-033 | Product owner |
| D9 | How a result confirmed through the browser's SharePoint session (BC-049) is labelled. **Decided 2026-09-14: it counts as Verified.** The definition of Verified widens to "confirmed by an authenticated Microsoft 365 lookup (Microsoft Graph, or SharePoint using the user's browser session)", and the method text names the call that confirmed it. | Count it as Verified with the definition widened; keep Verified for Graph only and add a fifth state; show it only in the extension and do not record it. | Nothing. Closed. | Product owner |

---

## 12. Explicitly out of scope for v1

- Any application level authentication, authorisation or user accounts. Locked decision, revisited under D4.
- Server side storage of Graph tokens or any background Graph access without a user present.
- Personal (consumer) OneDrive in any form: such links fail with a not supported message (BC-051).
- Authenticated validation for sovereign and government clouds. Those links parse in best effort mode only.
- Extension support for Firefox, Safari or any non Chromium browser, and browser store publication.
- Copilot surfaces other than the three named hosts, including Copilot panes inside Word, Excel, PowerPoint, Outlook and Teams.
- Any write operation against SharePoint or OneDrive, such as moving, renaming or sharing files.
- Bulk import of link lists, scheduled re-validation of stored history, or automatic submission from the extension without a user selecting items.
- A database engine other than SQLite, a reverse proxy, TLS termination or any additional service in the compose file.
- SharePoint Server on premises links.
- Mobile layouts beyond what a responsive page gives for free.
- Multi language user interface.

---

## 13. Architectural invariants

The following are design rules for all future development. They restate the locked decisions from the brief so that they survive the stories that first implement them.

1. The link parser is implemented once, in a shared package, and consumed by the web application and the extension. No consumer may carry its own parsing rules.
2. The parser is pure. It takes a string and returns a result, and it never performs network access, reads the DOM or depends on Node built in modules.
3. Every result carries exactly one confidence state: Verified, Derived, Inferred or Unresolved. The states have the meanings fixed in the conventions at the top of this file and nowhere else.
4. A result always states how it was obtained and which components are inferred. Nothing inferred is ever presented as fact.
5. Best effort parsing with no sign in is the default path and must keep working unchanged when authenticated validation is unavailable, unconfigured or refused.
6. Authenticated validation may upgrade a result but never overwrites the original. The earlier state and values remain visible.
7. Output URLs are encoded exactly once. Characters legal in a path segment are never double encoded.
8. Malformed, truncated and non Microsoft input fails with a reason code and a plain language message, never with an exception reaching the user.
9. SQLite is the authoritative persistence store for v1 and lives on a named Docker volume separate from the container filesystem.
10. All database access goes through one data access layer. No route, page or parser code references the database driver.
11. Database schema changes use migrations.
12. Persistence failures are never silent.
13. The compose file at the repository root is the single deployment definition, used unchanged by Portainer from Git and by Docker Compose locally.
14. Configuration comes from environment variables only. No secret is committed to the repository, baked into the image or written to logs.
15. Graph tokens are held in the browser session and are not persisted server side unless decision D3 changes and access control exists.
16. There is no application level access control in v1, so the application is hosted only on a private network. Any hosting change reopens decision D4 first.
17. The extension declares host permissions for the three named Copilot hosts. It may also hold the optional host permission `https://*.sharepoint.com/*`, which covers SharePoint and OneDrive for Business, requested at runtime for one tenant's hosts only when the user asks. Nothing broader. Consumer OneDrive and sovereign cloud hosts are not included.
18. The consumer Copilot host shows a defined empty state, never an error.
19. History is a log of lookups. Rows are appended and deleted, never silently edited.
20. New stories should improve one or more stages of: paste a link, get the folder path, keep the result.
