# BreadCrumb product backlog

Repository: github.com/TimHayward/BreadCrumb
Document date: 10 September 2026
Revised: 17 September 2026. **Architecture change: BreadCrumb is a browser extension only.** The self hosted web application, its API, its SQLite database and the whole container and Portainer deployment are withdrawn. The extension is the product, and an optional enterprise mode writes results to a SharePoint list. Work delivered under the previous architecture stays in `BACKLOG-completed.md`, with the superseded stories listed there under `## Superseded`.
Status: planning artefact only. No application code, schema or configuration content appears in this document.

**How to use this file.** Each story is self contained and written to be executed cold by an AI coding model or a developer with no other context. Pick a story, read its dependencies, implement, and satisfy every acceptance criterion. Where a story names a spike, the spike closes first and its evidence is linked from the story before implementation starts.

**When a story is done.** Once its acceptance criteria genuinely pass, move the whole story verbatim out of this file into `BACKLOG-completed.md` under a `## Completed` heading, appending a `**Completed:** <YYYY-MM-DD> · <commit SHA>` line. Keep the ID. IDs are never reused. Spikes are moved the same way once their closing evidence exists, with a one line summary of the finding. A story or spike that is dropped moves under a `## Withdrawn` heading with the date and the reason. A story that was delivered but no longer describes the product is listed under `## Superseded` with what replaced it. This file only ever contains open work, so the milestone lists in section 6 shrink as stories complete.

**Design rules.** Section 13 lists the architectural invariants that every story must respect. A story that would break an invariant is re-planned, not implemented.

Conventions used throughout:

- Confidence states, used identically everywhere: **Verified** (confirmed by an authenticated Microsoft 365 lookup: Microsoft Graph, or SharePoint using the user's browser session; the method text names the call), **Derived** (decoded deterministically from the link with no guesswork), **Inferred** (best effort where at least one component is a guess, such as the document library boundary), **Unresolved** (the form is recognised but cannot be decoded without authentication).
- **[unverified]** marks a claim I am not certain of. Every such marker names the spike that closes it.
- Priorities: **Must**, **Should**, and **Could** (a want: done only when time allows, low priority).
- Sizes: XS under half a day, S one to two days, M three to five days, L one to two weeks, XL longer than two weeks, for one developer.

---

## 1. Product summary

BreadCrumb is a Microsoft Edge extension that turns any Microsoft 365 SharePoint or OneDrive for Business link into the folder location it points at. It lifts file citations from Microsoft Copilot responses, decodes each one with a shared parser, and confirms it with the user's own SharePoint session where the user has allowed that tenant. The popup lists each cited file with its document location, its confidence state and copy actions for the original link and the folder link. A link that did not come from Copilot can be pasted into the extension by hand. Results are kept in the extension's own storage on the user's device, and in enterprise mode selected results are written as items to a SharePoint list the organisation controls. Every result states how it was obtained using four states: Verified, Derived, Inferred and Unresolved. There is no server, no database and no deployment: installing the extension is the whole installation.

---

## 2. Assumptions

Each line is a gap in the brief that I filled. Correct any that are wrong before the milestone that depends on it.

- Microsoft Edge (current stable) is the primary and only required browser. Chrome and other Chromium browsers are a low priority want (BC-050) and untested. Firefox and Safari are out of scope.
- The extension is loaded unpacked in developer mode or pushed by enterprise policy. Store publication is not needed.
- The test tenant is an Entra work tenant with SharePoint and OneDrive for Business, not a consumer Microsoft account.
- Personal (consumer) OneDrive is not supported (decided 2026-09-14). Links on `onedrive.live.com` and `1drv.ms` are recognised only to tell the user they are not supported (BC-051).
- The tenant name is the first label of the host, so `848` in the worked example. The site path is `/sites/{name}` or `/teams/{name}`. Links on the root site have an empty site path and the library is the first path segment.
- Corrections made by authenticated confirmation are recorded alongside the original best effort result rather than overwriting it, so the upgrade is visible.
- Confirmation uses the user's existing SharePoint session first, because it needs no application registration and no tenant consent (BC-049, decision D9). Microsoft Graph is a fallback for what the session cannot confirm, and only when a signed in route exists (BC-061, decision D10).
- Authenticated confirmation targets the global Microsoft cloud only. Sovereign cloud links parse in best effort mode only.
- "Copilot response" means the assistant turns rendered in the chat pane of the three named hosts. Copilot panes inside Word, Teams or Outlook are separate surfaces and out of scope.
- The extension's own history lives in browser extension storage on the device. It is the user's working copy, not a system of record: removing the extension removes it. Anything that must outlive the device goes to the SharePoint list.
- Enterprise mode is optional and off until an administrator or the user configures a target list. Everything else in the extension works without it.
- The SharePoint list already exists, or is created from the documented column set by an administrator (BC-059). The extension does not create site columns or content types.
- One list serves a team. Per user lists, per site routing and multi list fan out are not needed.
- The user interface is English only.

---

## 3. Epics

| Epic | Goal | Value delivered |
|---|---|---|
| E2 Shared link parser | One package that decodes every Microsoft 365 link form in best effort mode and labels its output honestly. Consumed by the extension and by the confirmation package (the existing validation package, which holds the Graph and SharePoint lookup logic). | Coverage and correctness live in one place and are tested once. |
| E6 Copilot extension | A Manifest V3 extension for Microsoft Edge that lifts file citations from Copilot responses, resolves them with the shared parser, confirms them with the user's SharePoint session, and presents each one with its folder, its state and copy actions. | Citations become folder locations without copying links by hand. |
| E8 Standalone extension | Everything the withdrawn web application used to provide, now inside the extension: paste a link by hand, keep a history, search it, export it. | The tool needs no host, no container and no network of its own. |
| E9 Enterprise SharePoint list | An optional mode that writes selected results as items in a SharePoint list the organisation owns, configured on the options page or by enterprise policy. | Results outlive the device and are shared with the team, in the organisation's own tenant. |

Epics E1 (foundation and deployment), E3 (web conversion experience), E4 (conversion history in the server) and E7 (operability of the container) are withdrawn with the web application. Their delivered stories are listed under `## Superseded` in `BACKLOG-completed.md`.

---

## 4. Link form matrix

Example shapes are anonymised. `contoso` stands for the tenant, `SiteA` for a site, `Lib` for a document library, `{guid}` for any GUID, `{token}` for an opaque sharing token and `{enc}` for a percent encoded server relative path.

The calls named here are the documented Microsoft Graph v1.0 calls I am confident exist. SharePoint exposes the same shapes at `https://{host}/_api/v2.0/...`, which the extension calls with the user's browser session (BC-049, spike S9), so the "Graph call that resolves it" column names the shape whichever route is used. Where the exact call or permission is uncertain the row carries [unverified] and a spike reference. "Offline" means no network access and no sign in.

| # | Form | Example shape | Offline result | Graph call that resolves it | Confidence without a lookup | Confidence with a lookup | Story |
|---|---|---|---|---|---|---|---|
| 1 | Library view link with `id` and `parent` | `https://contoso.sharepoint.com/sites/SiteA/Lib/Forms/AllItems.aspx?id={enc}&parent={enc}` | Full | Site by path `GET /sites/{host}:/sites/SiteA`, then `GET /sites/{site-id}/drives` to confirm the library, then `GET /drives/{drive-id}/root:/{path}` | Path, folder and file: Derived. Library: Derived when the `id` path starts with the segment before `/Forms/`, otherwise Inferred | Verified | BC-007 |
| 1b | Classic view link with `RootFolder` and optional `viewid` | `.../Lib/Forms/AllItems.aspx?RootFolder={enc}&viewid={guid}` | Full | As row 1 | Folder: Derived. Library: as row 1. Whether modern tenants still emit this form is [unverified], see S3 | Verified | BC-007 |
| 2 | Direct server relative file or folder URL | `https://contoso.sharepoint.com/sites/SiteA/Lib/Folder/File.pdf` | Full | As row 1 | Path, folder and file: Derived. Library: Inferred | Verified | BC-008, BC-018 |
| 3a | Modern sharing link, `/r/` path bearing variant | `https://contoso.sharepoint.com/:w:/r/sites/SiteA/Lib/Folder/File.docx?d=w{guid}&csf=1&web=1&e={short}` | Full | As row 1. The `d` value is the item's unique id and can be cross checked against `sharepointIds.listItemUniqueId` on the returned driveItem | Path, folder and file: Derived. Library: Inferred | Verified | BC-010 |
| 3b | Modern sharing link, `/s/` token variant | `https://contoso.sharepoint.com/:b:/s/SiteA/{token}?e={short}` | Type code and site hint only | `GET /shares/{encoded}/driveItem` where `{encoded}` is `u!` followed by base64url of the full link. Minimum delegated permission [unverified], see S2 | Unresolved. Type of item (from the `:b:` style prefix) and site name are reported as Derived hints | Verified | BC-011 |
| 3c | Modern sharing link, `/g/` variant | `https://contoso.sharepoint.com/:x:/g/personal/user_contoso_onmicrosoft_com/{token}?e={short}` | Type code and site or personal site hint | As row 3b. Whether `/g/` always means an organisation scoped link is [unverified], see S3 | Unresolved | Verified | BC-011 |
| 3d | Modern sharing link, `/t/` variant | `https://contoso.sharepoint.com/:f:/t/SiteA/{token}?e={short}` | Type code and site hint | As row 3b. Meaning of `/t/` scope is [unverified], see S3 | Unresolved | Verified | BC-011 |
| 4 | `Doc.aspx` with `sourcedoc` GUID | `https://contoso.sharepoint.com/sites/SiteA/_layouts/15/Doc.aspx?sourcedoc=%7B{guid}%7D&file=File.docx&action=default` | Partial: site Derived, file name Derived when `file` is present, path Unresolved | Resolved through the shares endpoint with the whole link (spike S5). `WopiFrame.aspx?sourcedoc=` is treated the same way | Unresolved (site and file name are Derived hints) | Verified | BC-012 |
| 5 | `download.aspx` and similar layouts pages with `SourceUrl` | `https://contoso.sharepoint.com/sites/SiteA/_layouts/15/download.aspx?SourceUrl={enc}` | Full | As row 1 | Path, folder and file: Derived. Library: Inferred | Verified | BC-013 |
| 5b | `download.aspx` with `UniqueId` | `.../_layouts/15/download.aspx?UniqueId={guid}` | Partial: site Derived, item Unresolved | As row 4 | Unresolved | Verified | BC-013 |
| 6 | OneDrive for Business personal site | `https://contoso-my.sharepoint.com/personal/user_contoso_onmicrosoft_com/_layouts/15/onedrive.aspx?id={enc}` and direct `https://contoso-my.sharepoint.com/personal/user_contoso_onmicrosoft_com/Documents/Folder/File.xlsx` | Full | `GET /sites/{host}:/personal/{alias}` to resolve the personal site [unverified that personal sites resolve by path, see S2], then as row 1. Through the session route the user must have opened OneDrive in the browser once (spike S9) | Path, folder and file: Derived. Library: Inferred, defaulting to `Documents` | Verified | BC-014 |
| 7a | OneDrive consumer, `onedrive.live.com` with `cid` and `resid` | `https://onedrive.live.com/?cid={hex}&resid={hex}%21{n}&authkey={key}` | Fails cleanly: consumer OneDrive is not supported | Not applicable | No result state. Reason code `consumer_onedrive` with a message saying this is a consumer OneDrive link and not supported | Not applicable | BC-051 |
| 7b | OneDrive consumer short link | `https://1drv.ms/x/s!{token}` and `https://1drv.ms/b/s/{token}` | Fails cleanly as row 7a. The link is never fetched or expanded | Not applicable | As row 7a | Not applicable | BC-051 |
| 8 | Guest access links | Modern: identical in shape to rows 3b to 3d; nothing in the URL distinguishes a guest recipient [unverified], see S3. Legacy: `https://contoso.sharepoint.com/sites/SiteA/_layouts/15/guestaccess.aspx?docid={id}&authkey={key}` [unverified whether still emitted], see S3 | Type and site hints only | As row 3b for modern. Legacy form: `/shares` with the full URL [unverified], see S2 | Unresolved | Verified where `/shares` accepts it | BC-011 |
| 9 | Teams deep link wrapping a file URL | `https://teams.microsoft.com/l/file/{guid}?tenantId={guid}&fileType=docx&objectUrl={enc-full-url}&baseUrl={enc}&serviceName=teams&threadId={id}&groupId={guid}` | Full unwrap, then as the inner form | As the inner form | As the inner form. The wrapper is recorded in the result | As the inner form | BC-016 |
| 10 | Outlook Safe Links wrapper | `https://{region}.safelinks.protection.outlook.com/?url={enc-full-url}&data={blob}&sdata={blob}&reserved=0` and the `/ap/{code}/?url=` variant [unverified, see S3] | Full unwrap, then as the inner form | As the inner form | As the inner form. The wrapper is recorded in the result | As the inner form | BC-017 |
| 11 | Copy link output carrying `csf`, `web` and `e`, with or without `d` | Any of rows 1, 2 or 3a with `?csf=1&web=1&e={short}` appended | Full | As the underlying row | As the underlying row. The parameters are stripped from output URLs and `d` is retained as an identifier | As the underlying row | BC-010 |
| 12 | Sovereign and government cloud hosts | Rows 1 to 6 on `sharepoint.us`, `sharepoint-mil.us` or `sharepoint.cn` hosts, and on `-my` variants of each | As the matching row | Endpoints differ by cloud and are not configured | As the matching row | Not supported | BC-020 |
| 13 | Folder rather than file, in any of the above | Row 1 with `id` equal to `parent`, row 2 ending in a folder, row 3 with a `:f:` prefix | As the matching row | As the matching row | As the matching row, with no file component and the folder URL equal to the path | As the matching row | BC-019 |
| 14 | Malformed, truncated or non Microsoft links | Any input that is not a URL, is missing its host, has a cut off query string, or points at an unrelated host | Fails cleanly | Not applicable | No result state. A reason code and message are returned instead | Not applicable | BC-021 |

Notes on the matrix:

- A modern sharing link in the `/s/`, `/g/` or `/t/` variants cannot be expanded by an unauthenticated HTTP request. Fetching it without a session redirects to sign in. BreadCrumb never fetches a link to expand it: it either decodes the link offline or asks SharePoint about it with the user's session.
- The library boundary is only deterministic in row 1, where the page path places `/Forms/AllItems.aspx` at the library root. In every other form the split between site, library and folders is Inferred until a lookup confirms it.

---

## 5. User stories

Story format: ID and title, user story sentence, acceptance criteria as Given, When, Then, then priority, size and dependencies. Every criterion is written to be tested on its own.

### E8 Standalone extension

#### BC-053 Remove the web application, the API and the deployment stack

As the person maintaining BreadCrumb, I want the web application and everything that hosted it removed from the repository, so that the extension is the only thing to build, install and reason about.

- Given the repository after this story, When it is inspected, Then the web application package, the server, the SQLite database layer and its migrations, the Docker and compose files and the Portainer runbook are gone, and no file references them.
- Given the extension after this story, When it is loaded and used end to end, Then it never calls a BreadCrumb API, the API base URL setting is gone from the options page and from storage, and no feature reports that BreadCrumb cannot be reached.
- Given the shared packages, When the build runs, Then the parser and the confirmation package still build and their tests still pass, and the confirmation package no longer depends on anything that only existed in the server.
- Given continuous integration, When it runs on the change, Then it builds and tests only the packages that remain, with no step referring to a container image or a database.
- Given the README, When it is read by someone who has never seen the project, Then it describes installing an extension, and nothing in it describes hosting a service.
- Given a user who relied on the web pages to paste a link, When they read the README, Then it points them at the in-extension paste (BC-054).

Priority: Must. Size: M. Depends on: BC-054 (so the paste path exists before the pages go), BC-055.
Decisions to close first: D16, D22.

#### BC-054 Paste a link by hand in the extension

As a user, I want to paste any Microsoft 365 link into the extension, so that I can get its folder location when the link did not come from a Copilot citation.

- Given the extension popup on any page, When the user chooses to paste a link, Then a single input accepts one link and converting it shows the same row presentation as a citation: file name, document location, confidence state and the copy actions.
- Given a pasted link on a tenant the user has granted, When it is converted, Then it is confirmed with the SharePoint session exactly as a citation is (BC-049), and the row shows Verified with the method text naming the call.
- Given a pasted link that fails to parse, When it is converted, Then the failure message and reason are shown in the row, with no exception and no empty state.
- Given a pasted link, When it has been converted, Then it is kept in the extension's history (BC-055) with its source recorded as pasted rather than extracted.
- Given the popup opened on a page that is not a Copilot surface, When it opens, Then the paste input is available there too, so the extension is useful anywhere.

Priority: Must. Size: M. Depends on: BC-055.
Decisions to close first: D14.

#### BC-055 The extension keeps its own history

As a user, I want every link I resolve to be remembered on my device, so that I can find a folder again without repeating the work.

- Given a resolved citation or pasted link, When it is shown in the popup, Then it is written to extension storage with its link, document key, file name, path, folder URL, file URL, state, method text, the host page it came from and the time, and it survives closing the popup, restarting the browser and updating the extension.
- Given the same document resolved again through a different link form, When it is written, Then it updates the existing entry rather than adding a second one, matching on the parser's document key exactly as the withdrawn lookup API did.
- Given an entry that was Inferred and is later confirmed, When the confirmation arrives, Then the entry records the upgrade and keeps the earlier state and values visible.
- Given storage that is filling up, When the number of entries passes the documented cap, Then the oldest entries are dropped first, the cap is stated in the options page, and the user is told when dropping starts.
- Given a failure to write to storage, When it happens, Then the popup says so plainly and the result is still shown; a failure to persist is never silent.
- Given the user has enterprise mode configured (BC-058), When an entry is written to the SharePoint list, Then the local entry records that it was sent, with the list item it became.

Priority: Must. Size: M. Depends on: BC-044.
Decisions to close first: D8, D11, D15.

#### BC-056 History page: search, filter, delete and export

As a user, I want to browse what I have resolved, search it and get it out, so that the history is useful beyond the last popup.

- Given the extension's history page, When it is opened, Then entries are listed newest first with file name, document location, state and when they were captured, and the list is usable at two thousand entries.
- Given a search term, When it is typed, Then entries whose file name, path or original link contain it are shown, matching is case insensitive, and the first results appear within one second at two thousand entries.
- Given the filters, When a state or a source (extracted, pasted) is chosen, Then only matching entries are listed and the filter is visible in the page.
- Given one entry or a selection, When delete is chosen, Then those entries are removed after a confirmation that names how many will go, and nothing else is touched.
- Given the current filtered set, When export is chosen, Then it downloads as CSV and as JSON with every stored field, and the file opens in a spreadsheet with the columns intact.
- Given the page, When it is operated with the keyboard only and with a screen reader, Then every control is reachable and labelled, and state is never conveyed by colour alone.

Priority: Must. Size: M. Depends on: BC-055.
Decisions to close first: D24.

#### BC-057 Options page for tenant and enterprise settings

As a user or an administrator, I want one place to set up the extension, so that granting tenant access and pointing at a list are obvious and reversible.

- Given the options page, When it is opened, Then it offers the tenant host access grant (BC-049), the enterprise list target (BC-058), the history cap and nothing that refers to a BreadCrumb server.
- Given a tenant host granted earlier, When the options page is opened, Then the granted hosts are listed with the date they were granted and each can be revoked, and revoking takes effect without reloading the extension.
- Given a value supplied by enterprise policy (BC-063), When the options page is opened, Then that value is shown, marked as set by the organisation, and cannot be edited there.
- Given a setting is changed, When it is saved, Then the popup uses the new value the next time it opens, and an invalid value is refused with a message naming the setting.

Priority: Must. Size: S. Depends on: BC-053.
Decisions to close first: D18.

### E9 Enterprise SharePoint list

#### BC-058 Send selected results to a SharePoint list

As a team, we want selected results written to a SharePoint list we own, so that the folder locations we find are kept in our tenant and shared with colleagues.

- Given a configured list and a selection in the popup, When the user sends the selection, Then one list item is created per document with the documented columns filled (BC-059), and each row reports its own outcome with the list item it became.
- Given a document that is already in the list, When it is sent again, Then the existing item is updated rather than duplicated, matched on the stored document key (decision D12 records what update means).
- Given the write route decided in D10, When the user sends a selection, Then no credential is stored by the extension: the write uses the user's own SharePoint session or a token held for the session only, and cookie values are never read.
- Given a write that is refused, When the reason is a permission problem, a missing list, a missing column or throttling, Then the popup says which, names the list, and repeats the attempt only when the user asks; throttling shows the wait the service asked for.
- Given enterprise mode is not configured, When the popup opens, Then nothing about lists is shown and every other feature works unchanged.
- Given a sent result, When the user opens the list from the popup, Then the list opens in a new tab filtered to, or scrolled to, the item just written.

Priority: Must. Size: L. Depends on: BC-059, S10, D10.
Decisions to close first: D10, D12, D21.

#### BC-059 SharePoint list schema and provisioning runbook

As an administrator, I want a documented list to create, so that BreadCrumb has somewhere to write and the columns mean what the team expects.

- Given the runbook, When an administrator follows it, Then they create a list with the documented columns (document key, file name, document location, folder URL, file URL, original link, confidence state, method text, site, library, captured by, captured at, source) and each column's type and purpose is stated.
- Given the list created from the runbook, When the extension writes to it (BC-058), Then every column it needs exists and no write fails for a missing column.
- Given a list that is missing a column, When the extension checks the list before its first write, Then it names the missing columns and refuses to write rather than writing a partial item.
- Given the runbook, When it is followed with a script instead of by hand, Then the script creates the same list and is safe to run twice.
- Given the runbook, When an administrator reads it, Then it states the minimum permission a user needs to add and update items, and says BreadCrumb never creates lists, site columns or content types itself.

Priority: Must. Size: S. Depends on: S10.
Decisions to close first: D19, D20.

#### BC-060 Enterprise mode is honest about what it sends

As a person whose file names end up in a shared list, I want to see exactly what will be written before it is written, so that nothing sensitive is shared by accident.

- Given a selection about to be sent, When the user asks what will be sent, Then the popup shows the field values for the first item and says the same fields go for every item.
- Given the list target, When the popup is open in enterprise mode, Then the site and list being written to are named where the user can see them, not only in the options page.
- Given a document whose state is Unresolved or failed, When the user sends a selection, Then it is not written to the list, and the popup says which were left out and why.
- Given a write that partly succeeded, When the popup reports, Then it states which items were written, which were updated and which failed, and the local history records the same.

Priority: Should. Size: S. Depends on: BC-058.
Decisions to close first: D20.

#### BC-061 Sign in to Microsoft from the extension

As a user whose SharePoint session cannot confirm every citation, I want to sign in from the extension, so that the rest can be confirmed and written to the list.

- Given the sign in control in the extension, When the user signs in against the tenant, Then a delegated token is obtained through the route chosen in spike S12, the token is held only for the session, and nothing is written to disk that would let another program use it.
- Given a signed in user, When a citation the SharePoint session could not confirm is looked up, Then it is confirmed through Graph and the method text names the call, exactly as the withdrawn web application did.
- Given a signed in user, When they sign out, Then the token is discarded, and the extension keeps working in best effort and session modes.
- Given no sign in, When the extension is used, Then every feature except Graph confirmation works, and nothing prompts for sign in unprompted.
- Given consent is refused by the tenant, When sign in is attempted, Then the message names the permission that was refused and points at the administrator request in the runbook.

Priority: Should. Size: M. Depends on: S12, D10.
Decisions to close first: D13.

#### BC-062 Confirm what the session cannot, without a second window

As a user, I want confirmation to happen while I look at the popup, so that I never have to visit another page to make a result Verified.

- Given citations in the popup, When the popup opens with tenant access granted, Then confirmation runs for every unconfirmed row and the rows update in place as answers arrive.
- Given a row that neither the session nor Graph can confirm, When confirmation finishes, Then the row keeps its best effort state with a plain explanation, and it is never left looking as though it is still working.
- Given confirmation is running, When the user sends or copies, Then those actions are not blocked by confirmation still being in flight.
- Given the withdrawn background verification tab, When the extension is used after this story, Then no tab is opened for verification at any point.

Priority: Must. Size: M. Depends on: BC-053.
Decisions to close first: D17, D23.

#### BC-063 Enterprise policy configuration

As an administrator, I want to push BreadCrumb's settings by policy, so that a team does not configure each device by hand.

- Given the extension installed by enterprise policy with managed settings, When it first runs, Then the list target and the granted tenant hosts come from policy, and the user is not asked for them.
- Given a policy value and a user value for the same setting, When they differ, Then the policy value wins and the options page says the organisation set it (BC-057).
- Given policy is removed, When the extension next runs, Then it falls back to the user's own settings and says so, rather than failing.
- Given the documentation, When an administrator reads it, Then it gives the exact policy keys and one worked example for Microsoft Edge.

Priority: Should. Size: S. Depends on: BC-057, S11.
Decisions to close first: D7.

#### BC-064 Packaged release of the extension

As the person rolling BreadCrumb out, I want a versioned package to install, so that installation does not mean handing someone a build directory.

- Given a release build, When it runs, Then it produces a versioned package of the extension and records the parser version it contains.
- Given the package, When it is installed in Microsoft Edge by policy or unpacked, Then the extension works with no further build step.
- Given a released version, When a user asks which version they are running, Then the options page shows the extension version and the parser version.
- Given the release steps, When they are documented, Then someone other than the author can produce the same package.

Priority: Should. Size: S. Depends on: BC-053.
Decisions to close first: D7.

### E6 Copilot extension

#### BC-050 Chrome and other Chromium browsers

As a user of Chrome or another Chromium browser, I want the extension to work there too, so that I am not tied to Edge.

- Given the extension loaded unpacked in current stable Chrome, When the acceptance criteria of BC-042 to BC-049 and BC-054 to BC-058 are run, Then they pass or each difference from Edge is recorded.
- Given enterprise policy on Chrome, When BC-063 is run there, Then the policy keys are recorded for that browser too, or the difference is stated.

Priority: Could (a want, low priority). Size: S. Depends on: BC-058.

---

## 6. Release plan

Milestones M1 to M4 were delivered between 10 and 15 September 2026 under the previous architecture (a self hosted web application plus an extension that submitted to it). Their stories are in `BACKLOG-completed.md`; the parts that the architecture change removes are listed there under `## Superseded`. What survives them is the shared parser, the confirmation package, the citation extraction and the popup.

### M5 The extension stands alone

Stories: BC-053, BC-054, BC-055, BC-056, BC-057, BC-062.

Demonstrable outcome: on a machine with no BreadCrumb server anywhere, the extension is installed in Microsoft Edge. A Copilot response citing SharePoint and OneDrive files is opened, and the popup lists the files with their document locations, confirming them with the browser's SharePoint session while the user watches. A link that never appeared in Copilot is pasted into the extension and resolves the same way. Both appear in the extension's own history, which survives a browser restart, can be searched and filtered, and exports as CSV and JSON. Nothing in the repository builds a container.

Deliberately excluded: the SharePoint list, sign in to Microsoft, enterprise policy, Chrome.

Progress evidence at the boundary: a recording of the popup and the history page on a machine with no server running, and an exported file.

### M6 Enterprise list

Stories: BC-058, BC-059, BC-060, BC-061, BC-063, BC-064.

Demonstrable outcome: an administrator creates the list from the runbook and pushes the settings by policy. A user opens a Copilot response, selects citations, sends them, and the items appear in the SharePoint list with the documented columns filled. Sending the same document again updates its item rather than duplicating it. A citation the session cannot confirm is confirmed after signing in. The rollout uses a versioned package.

Deliberately excluded: creating lists or columns from the extension, per user or per site lists, scheduled or background writes, Chrome (BC-050, Could).

Progress evidence at the boundary: the list with items written by two different people, the policy file used, and the package that was installed.

---

## 7. Spikes

Each spike is timeboxed. If the timebox ends without the closing evidence, the dependent stories are re-planned rather than the spike extended.

| ID | Question | Timebox | Closing evidence | Blocks |
|---|---|---|---|---|
| S2 | Does the shares endpoint with a `u!` base64url encoded link return a driveItem for `/s/`, `/g/` and `/t/` tokens and for `-my` host tokens, what is the minimum delegated permission when Graph is used, does it work for a token created by another user, does the legacy `guestaccess.aspx` form resolve, and does a personal site resolve by path? | 1 day | A table of link variant against result and HTTP status from the test tenant, with the exact permission set that succeeded and the smallest set that failed. Removes the [unverified] markers in matrix rows 3b, 3c, 3d, 6 and 8. | BC-061 |
| S3 | Which link forms does a modern tenant actually emit from its own copy link and share controls today: the SharePoint library "Copy link" for each audience option, OneDrive web, the Office desktop share dialogue, the Teams files tab, an Outlook attachment link, and a Copilot citation? Do `RootFolder`, `guestaccess.aspx` and the Safe Links `/ap/` variant still appear? What do `/g/` and `/t/` mean? | 1 day | One anonymised fixture per control and audience option added to the corpus (BC-022), and a note against each matrix row saying "emitted today", "legacy but seen" or "not observed". Removes the [unverified] markers in rows 1b, 3c, 3d, 8 and 10. | BC-022 completeness. Nothing else is blocked. |
| S10 | Can the extension add and update items in a SharePoint list using only the user's browser session: does `POST /_api/contextinfo` yield a form digest the extension can use, does the list item write succeed with `credentials: 'include'` from the popup or service worker, and what does it return for a missing column, a missing list and throttling? If not, what does the same write need through Microsoft Graph (`POST /sites/{id}/lists/{id}/items`), and which delegated permission is the minimum? | 1 to 2 days | A recorded add and update against a list in the test tenant by both routes where they work, with request and response shapes anonymised, the permission set that succeeded, and a statement of which route BC-058 should use. Feeds decision D10. | BC-058, BC-059, D10 |
| S11 | How are managed settings delivered to an extension in Microsoft Edge: which policy keys and file or registry locations, does `storage.managed` read them without extra permissions, and how does a policy value behave when it changes while the browser is running? | Half a day | A working policy on this machine that sets the list target, with the exact keys recorded and a note on what happened when the value changed. | BC-063 |
| S12 | How should the extension obtain a delegated Microsoft token now that there is no web application: MSAL in an extension page, `chrome.identity.launchWebAuthFlow`, or a Microsoft 365 tab the user is already signed into? Which works in Manifest V3 in Microsoft Edge, what redirect URI does each need in the Entra app registration, and where does each keep the token? | 1 day | A sign in that returns a usable token in the extension, with the registration settings recorded, a statement of where the token lives and for how long, and the failure behaviour when consent is refused. | BC-061, D10 |

---

## 8. Test strategy

**Fixture corpus.** The parser package holds a corpus of link fixtures, one file per case, grouped by link form matrix row. Each fixture records the input link, the expected state, the expected path, folder URL and file URL, the expected components with their Derived or Inferred flag, the expected wrappers removed, the expected method text and, for failures, the expected reason code. Negative fixtures for BC-021 sit alongside. The corpus is data, not code, so a new case needs no test code.

**Anonymisation before entry to the repository.** No real link enters the repository. A contributor takes the real link, applies the anonymisation checklist and commits only the result. The checklist: replace the tenant with `contoso`, sites with `SiteA` and `SiteB`, personal site aliases with `user_contoso_onmicrosoft_com`, folder and file names with neutral names that keep the same encoding characteristics (spaces, hyphens, full stops, ampersands, non ASCII characters), regenerate every GUID, replace sharing tokens with random strings of the same length and character class, truncate Safe Links `data` and `sdata` blobs to a fixed placeholder, and replace Teams thread and group identifiers. A check run in continuous integration fails the build if a fixture contains a host other than the documented placeholders, a string that looks like a real tenant, or a token longer than the placeholder length. Client names and file titles from the 848 tenant never appear in fixtures; the worked example from the brief is the single exception and is retained verbatim because the brief already publishes it.

**Adding a new link form as a regression case.** The order is fixed: anonymise the link, add a fixture with the expected result written by hand, watch it fail, add or change the parser rule, watch the whole corpus pass, add a matrix row to this document. A parser change that alters an existing fixture's expected output must update that fixture in the same change and bump the parser version (BC-006).

**Testing the parser independently of its consumer.** The parser's tests run in Node with no browser, no server and no network, and they run the whole corpus. A second run executes the same corpus inside a headless Chromium context to prove the package has no Node only dependency. The extension then has a thin contract test: its popup model is fed every corpus input and the result is compared with the fixture. If that test fails while the parser test passes, the fault is in the extension's adapter, not the parser.

**Encoding round trip.** A property style test takes every decoded path from the corpus, rebuilds the URL, decodes it again and asserts equality, catching double encoding (BC-009).

**Extension tests.** DOM captures from S1 are the fixtures for BC-043. Extraction tests run against the captures, not the live sites, so a markup change shows up as a capture that needs refreshing rather than a flaky test. Popup behaviour is tested through the popup model in Node, with the browser APIs stubbed; a rendered check of the popup page is taken from a headless browser when the layout changes.

**Storage tests.** The history layer is tested against a fake of the extension storage API: writing, updating by document key, the cap, the drop order, export shape and a write that fails. A migration of stored entries between versions is tested by seeding the previous shape and reading it with the new code.

**SharePoint list tests.** Writes are tested against recorded responses, anonymised the same way as links, so the suite runs without a tenant: an add, an update, a missing column, a missing list, a permission refusal and a throttled response. One manual run per milestone boundary writes to the real test tenant list.

**Confirmation tests.** The confirmation package is tested against recorded SharePoint and Graph responses. Every new recorded response is anonymised before it enters the repository.

---

## 9. Non functional requirements

| Area | Requirement |
|---|---|
| Installation | Installing the extension is the whole installation. No server, container, database or network service is required, and the repository contains nothing that deploys one. |
| Packaging | A versioned package produced by a documented release step (BC-064), installable unpacked or by enterprise policy. |
| Configuration | Settings come from the options page or enterprise policy (managed storage). No secrets in the repository, in the package or in logs. There is no client secret: any Entra registration is a public client. |
| Persistence | The extension's history lives in extension storage on the device, within the browser's quota, with a documented cap and a stated drop order (BC-055). It is a working copy, not a system of record. |
| Data sensitivity | History and list items hold client names and file titles. Local history is visible to anyone using that browser profile; list items are visible to everyone with access to the list. The README says both plainly, and the list target is always visible while enterprise mode is on. |
| Network posture | The extension talks only to Microsoft 365 hosts: the Copilot hosts it runs on, the tenant SharePoint and OneDrive hosts the user has granted, and Microsoft Graph when signed in. It has no backend of its own and sends data to no third party. |
| Error handling | No unhandled exception reaches a user. Every failure carries a reason code and a plain language message. A failure to persist or to write to the list is never silent. |
| Performance | Conversion under 100 ms for any offline form. The popup lists citations within a second of opening, and confirmation updates rows as answers arrive rather than blocking the list. History search under one second at two thousand entries. |
| Browser support | Microsoft Edge (current stable) is the primary and only required browser. Chrome and other Chromium browsers are a low priority want (BC-050). Firefox and Safari are out of scope. |
| Accessibility | WCAG 2.2 AA for contrast and keyboard operation, state never conveyed by colour alone, in the popup, the options page and the history page. |
| Privacy of credentials | Cookie values are never read. Tokens, where they exist at all, are held for the session and never written where another program could use them. |

---

## 10. Risk register

Likelihood and impact are High, Medium or Low. Owner is a placeholder role until names are assigned.

| ID | Risk | Likelihood | Impact | Mitigation | Owner |
|---|---|---|---|---|---|
| R1 | Copilot citation markup changes without notice on any of the three hosts, breaking extraction. | High | Medium | Select on the most stable roles and attributes found in S1, keep DOM captures as fixtures, fail to a "no citations found" state with a report action (BC-043), and treat each host's selectors as separately replaceable. | Extension owner |
| R2 | Delegated permission consent is refused or delayed in the production tenant. | Medium | Medium | Best effort parsing and session confirmation never need consent. Ask for the smallest permission S2 and S10 prove sufficient, and document the request for the tenant administrator before M6. | Product owner |
| R3 | Some link forms cannot be resolved at all, even with a lookup. | Medium | Low | They remain Unresolved with an honest message. The matrix records the ceiling per form. | Parser owner |
| R7 | Extension installation is blocked by browser policy on managed devices. | Medium | High | Now the whole product, not one of two ways in. Confirm with the device administrator that policy installation and the optional SharePoint host permission are allowed, and prove the policy path in S11 before M6. | Product owner |
| R9 | The library boundary heuristic is wrong often enough that Inferred results mislead. | Medium | Medium | Always label Inferred. Measure the hit rate against confirmed results and refine BC-018 from real data. | Parser owner |
| R12 | The Verified state is asserted by the extension, so a modified extension could claim a false Verified. | Low | Low | Acceptable: the audience is the user's own team. Record the item id with every Verified result so it can be re-checked. | Product owner |
| R13 | The SharePoint list write is refused from the extension: the form digest route does not work with the session, or the tenant blocks it. | Medium | High | Spike S10 before any of M6 is built, with the Graph route as the fallback (BC-061, decision D10). If neither route works, enterprise mode is re-planned as an export the user uploads. | Extension owner |
| R14 | Local history is lost: the extension is removed, the profile is reset, or the browser evicts storage. | Medium | Medium | Say plainly that it is a working copy. Export (BC-056) and enterprise mode (BC-058) are the ways to keep anything that matters. Cap and drop order are documented. | Product owner |
| R15 | A user writes file names into a shared list that colleagues should not see. | Medium | Medium | Show what will be written before writing (BC-060), name the target list in the popup, refuse to write Unresolved and failed rows, and leave the list's own permissions to the organisation. | Product owner |
| R16 | The list schema drifts: a column is renamed or removed and writes start failing. | Medium | Medium | Check the list's columns before the first write and name what is missing (BC-059). Keep the runbook and the script as the single definition of the schema. | Extension owner |
| R17 | Removing the web application takes away the only place to paste a link that did not come from Copilot. | High | Medium | BC-054 delivers the paste path inside the extension before BC-053 removes the pages. | Product owner |
| R18 | Everything now depends on one browser extension: a breaking browser change stops the whole product. | Low | High | Keep the parser and the confirmation package free of extension APIs so they can be reused, pin the manifest version in the release package, and test each Edge update at the milestone boundary. | Extension owner |

Risks R4, R5, R6, R8, R10 and R11 are closed by the architecture change: they were about hosting the web application on a private network, reaching it from the extension, and the SQLite database. They are kept in `BACKLOG-completed.md` history only.

---

## 11. Open decisions

Each row says when it has to be settled. A story cannot start while a decision it depends on is open: either close the decision or re-plan the story. Where I have a recommendation it is stated in bold, and that is what the stories assume until someone says otherwise.

| ID | Decision needed | Options | Decide by | Who decides |
|---|---|---|---|---|
| D7 | How the extension is distributed. | Unpacked developer mode; enterprise policy from a private update URL; browser store. Now the only distribution question, since there is no server. | Before BC-064, and before M6 is demonstrated. Blocks BC-063, R7. | Product owner |
| D8 | Whether failed conversions are kept in the extension's history by default. **Recommended: keep them, since local history is cheap and a failure is worth seeing again.** | Never kept; kept only when the user opts in; always kept (recommended). | Before BC-055 is built. | Product owner |
| D10 | How the extension writes to the SharePoint list. **Recommended: the user's browser session with a form digest, falling back to Microsoft Graph with a delegated token only where the session route fails.** The session route needs no application registration and no tenant consent. | Session with form digest only; Graph with a delegated token only; session first with a Graph fallback (recommended); an export file the user uploads by hand. Decided from S10. | Before BC-058 starts. Blocks BC-059, BC-061. | Product owner, after S10 |
| D11 | Whether the extension's local history stays once enterprise mode exists. **Recommended: keep both, the list as the shared record and local history as the working copy.** | Keep both (recommended); local only; list only when enterprise mode is on. | Before BC-055 is built. Blocks BC-056. | Product owner |
| D12 | What "already in the list" means when a document is sent again. **Recommended: update the existing item in place.** | Update in place (recommended); add a new item and leave the old one; update and keep a revision note in the item. | Before BC-058 starts. | Product owner |
| D13 | Whether Microsoft Graph confirmation survives at all, now that the SharePoint session covers the tested forms. | Keep it for what the session cannot confirm (assumed in BC-061 and BC-062); drop it and accept the session's ceiling; keep it only for the list write. | After S10 and S12, before M6 planning is fixed. Blocks BC-061. | Product owner |
| D14 | Where the paste input lives. **Recommended: in the popup, above the citation list, so there is one place to look.** | Popup only (recommended); a separate extension page; the browser side panel; both popup and page. | Before BC-054 starts. | Product owner |
| D15 | The history cap and what is dropped first. **Recommended: two thousand entries, dropping the oldest that were never sent to the list.** | A fixed cap with oldest first; a cap the user sets; no cap until the browser complains; never drop, refuse to add. | Before BC-055 is built. Blocks the BC-056 performance criterion. | Product owner |
| D16 | What the third row action becomes now that "In BreadCrumb" has nowhere to go. **Recommended: "In the list" when the document has been written, opening the list item; otherwise no third action.** | Open the list item (recommended); open the extension's own history entry; drop the third action. | Before BC-053 removes the web pages. | Product owner |
| D17 | When extraction runs: on opening the popup, as now, or as the Copilot response arrives. | On popup open (as now); watch the page and keep a running list; watch only when the user turns it on. | Before M5 is demonstrated; affects BC-062 and R1. | Extension owner |
| D18 | How the list target is expressed and whether more than one is allowed. **Recommended: one target, as a site URL plus a list title, resolved to ids once and cached.** | Site URL plus list title (recommended); list id; the full list URL pasted from the browser. One target or several. | Before BC-057 and BC-058 start. | Product owner |
| D19 | Which of the documented columns are mandatory, and whether the extension writes by internal name or display name. **Recommended: write by internal name, treat document key, file name and document location as mandatory and the rest as optional.** | Internal names (recommended) or display names; all columns mandatory or a mandatory core. | Before BC-059 is written, since the runbook states it. | Extension owner |
| D20 | What "captured by" holds, and whether it is recorded at all. | The signed in user the session reports; nothing, and rely on the list's own Created By; a free text note the user sets once. | Before BC-059 is written. Feeds R15. | Product owner |
| D21 | Whether a result that has been written to the list is hidden, marked or left alone in the local history. **Recommended: marked, never hidden.** | Marked (recommended); hidden behind a filter; removed locally once written. | Before BC-058 starts. | Product owner |
| D22 | Where diagnostics go now that the server log is gone. **Recommended: copy a redacted report to the clipboard, as "Report markup" already does.** | Clipboard only (recommended); a downloaded file; the browser console only; an opt in endpoint. | Before BC-053 removes the client log route. | Extension owner |
| D23 | What happens on a tenant host the user has not granted. **Recommended: show best effort results and offer the grant in the row, never prompt on open.** | Offer in the row (recommended); prompt on opening the popup; say nothing and stay best effort. | Before M5 is demonstrated. | Product owner |
| D24 | Whether the extension keeps a versioned export of history that another install can read, as insurance against R14. | JSON export that imports back (an import story would be added); export only, no import; neither. | Before BC-056 is built. | Product owner |

Decisions D1, D2, D5 and D6 are closed by the architecture change: the web framework, the SQLite driver, history search and TLS on a private network no longer apply. D3 (where Graph tokens live) is replaced by D10 and by invariant 15 in its new form. D4 (application level access control) no longer applies: there is no application to control access to, and the list's own permissions govern the shared record. D9 (session confirmations count as Verified) stands.

---

## 12. Explicitly out of scope

- Any BreadCrumb server, API, database, container image or deployment. Withdrawn 2026-09-17.
- Personal (consumer) OneDrive in any form: such links fail with a not supported message (BC-051).
- Authenticated confirmation for sovereign and government clouds. Those links parse in best effort mode only.
- Extension support for Firefox, Safari or any non Chromium browser, and browser store publication.
- Copilot surfaces other than the three named hosts, including Copilot panes inside Word, Excel, PowerPoint, Outlook and Teams.
- Any write operation against SharePoint or OneDrive other than adding and updating items in the configured list: never files, folders, permissions or sharing.
- Creating the list, its site columns or its content types from the extension.
- Bulk import of link lists, scheduled or background writing, and automatic submission without a user selecting items.
- SharePoint Server on premises links.
- Multi language user interface.

---

## 13. Architectural invariants

The following are design rules for all future development. They restate the locked decisions so that they survive the stories that first implement them.

1. The link parser is implemented once, in a shared package, and consumed by the extension and by the confirmation package. No consumer may carry its own parsing rules.
2. The parser is pure. It takes a string and returns a result, and it never performs network access, reads the DOM or depends on Node built in modules.
3. Every result carries exactly one confidence state: Verified, Derived, Inferred or Unresolved. The states have the meanings fixed in the conventions at the top of this file and nowhere else.
4. A result always states how it was obtained and which components are inferred. Nothing inferred is ever presented as fact.
5. Best effort parsing with no sign in and no granted host is the default path and must keep working unchanged when confirmation is unavailable, unconfigured or refused.
6. Authenticated confirmation may upgrade a result but never overwrites the original. The earlier state and values remain visible.
7. Output URLs are encoded exactly once. Characters legal in a path segment are never double encoded.
8. Malformed, truncated and non Microsoft input fails with a reason code and a plain language message, never with an exception reaching the user.
9. The extension is the whole product. BreadCrumb runs no service of its own, and nothing in the repository requires a host, a container or a database.
10. All stored data goes through one storage layer. No popup, page or parser code touches the browser storage API directly.
11. Stored data has a version, and a change to its shape ships with a migration that reads the previous shape.
12. Persistence failures, local or to the list, are never silent.
13. The extension's storage is a working copy on one device. Anything that must outlive the device goes to the SharePoint list or an export.
14. Configuration comes from the options page or enterprise policy only. No secret is committed to the repository, packaged into the extension or written to logs.
15. Credentials stay with Microsoft: cookie values are never read, and any token exists only for the session and is never persisted where another program could use it.
16. The only writes BreadCrumb makes to Microsoft 365 are adding and updating items in the configured list, only when the user asks. It never writes files, folders, permissions or sharing links.
17. The extension declares host permissions for the three named Copilot hosts. It may also hold the optional host permission `https://*.sharepoint.com/*`, which covers SharePoint, OneDrive for Business and the list site, requested at runtime for one tenant's hosts only when the user asks. Nothing broader. Consumer OneDrive and sovereign cloud hosts are not included.
18. The consumer Copilot host shows a defined empty state, never an error.
19. History is a log of lookups. Entries are appended, updated by document key and deleted, never silently edited.
20. New stories should improve one or more stages of: find or paste a link, get the folder path, keep or share the result.
