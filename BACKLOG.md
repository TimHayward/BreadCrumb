# BreadCrumb product backlog

Repository: github.com/TimHayward/BreadCrumb
Document date: 10 September 2026
Revised: 17 September 2026. **Architecture change: BreadCrumb is a browser extension only.** The self hosted web application, its API, its SQLite database and the whole container and Portainer deployment are withdrawn. Work delivered under the previous architecture stays in `BACKLOG-completed.md`, with the superseded stories listed there under `## Superseded`. The removal was executed on 18 September 2026.
Revised: 19 September 2026. **Output change, following market research: results go to an Obsidian note, not a SharePoint list.** The extension appends a row per document to a Markdown table in a note in the user's vault, creating the note and the table when they do not exist. The SharePoint list stories (BC-058, BC-059, BC-060) and spike S10 are withdrawn in `BACKLOG-completed.md`; nothing of them was built. The Obsidian stories take new IDs (BC-065 to BC-069), because an ID is never reused for different work.
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

BreadCrumb is a Microsoft Edge extension that turns any Microsoft 365 SharePoint or OneDrive for Business link into the folder location it points at. It lifts file citations from Microsoft Copilot responses, decodes each one with a shared parser, and confirms it with the user's own SharePoint session where the user has allowed that tenant. The popup lists each cited file with its document location, its confidence state and copy actions for the original link and the folder link. A link that did not come from Copilot can be pasted into the extension by hand. Results are kept in the extension's own storage on the user's device, and selected results are written into an Obsidian note as rows in a Markdown table, in the user's own vault on the same device. Every result states how it was obtained using four states: Verified, Derived, Inferred and Unresolved. There is no server, no database and no deployment: installing the extension is the whole installation.

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
- The extension's own history lives in browser extension storage on the device. It is the user's working copy, not a system of record: removing the extension removes it. Anything that must outlive the device goes to the Obsidian note.
- The Obsidian output is optional and off until the user picks a vault folder and a note path. Everything else in the extension works without it.
- The user has Obsidian installed, with a vault that is an ordinary folder on the same device as the browser. Vaults on a network share or in a cloud folder are the user's own arrangement; BreadCrumb only writes a file.
- The note is BreadCrumb's to append to, but not to own: it may hold other content, and the table may be edited by hand between sends. BreadCrumb touches only the table it writes to.
- Obsidian itself is not scripted or automated. BreadCrumb writes a Markdown file; Obsidian picks the change up as it would any other external edit.
- Sharing is the vault's business, not BreadCrumb's. Whether the note reaches colleagues depends on how the user syncs their vault.
- The user interface is English only.

---

## 3. Epics

| Epic | Goal | Value delivered |
|---|---|---|
| E2 Shared link parser | One package that decodes every Microsoft 365 link form in best effort mode and labels its output honestly. Consumed by the extension and by the confirmation package (the existing validation package, which holds the Graph and SharePoint lookup logic). | Coverage and correctness live in one place and are tested once. |
| E6 Copilot extension | A Manifest V3 extension for Microsoft Edge that lifts file citations from Copilot responses, resolves them with the shared parser, confirms them with the user's SharePoint session, and presents each one with its folder, its state and copy actions. | Citations become folder locations without copying links by hand. |
| E8 Standalone extension | Everything the withdrawn web application used to provide, now inside the extension: paste a link by hand, keep a history, search it, export it. | The tool needs no host, no container and no network of its own. |
| E9 Obsidian note output | An optional mode that appends selected results as rows in a Markdown table in the user's Obsidian vault, creating the note and the table if they are not there, configured on the options page or by enterprise policy. | A folder location worked out once lands in the notes the user already keeps, and stays after the browser is closed. |

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

**Mostly executed 2026-09-18**, at Tim's instruction, ahead of BC-054 and BC-055 rather than after them. Removed: the `app` package, the Docker, compose and Portainer files, the server scripts and their docs, the catalog entries only the server used, and the container job in continuous integration. Removed from the extension: the "Send selected to BreadCrumb" action, the lookup of what BreadCrumb already knew, the background verification tab, the "In BreadCrumb" row action, the API base URL setting and the client log reporting. The local database was moved out of the repository rather than deleted. Decision D22 was taken as recommended: diagnostics go to the clipboard. Still open in this story: the last two criteria, which need the in-extension paste (BC-054). **Known gap until BC-054 and BC-055 land:** a link that did not come from a Copilot citation cannot be converted at all, and no result is kept once the popup closes. This is risk R17 accepted deliberately.

As the person maintaining BreadCrumb, I want the web application and everything that hosted it removed from the repository, so that the extension is the only thing to build, install and reason about.

- Given the repository after this story, When it is inspected, Then the web application package, the server, the SQLite database layer and its migrations, the Docker and compose files and the Portainer runbook are gone, and no file references them.
- Given the extension after this story, When it is loaded and used end to end, Then it never calls a BreadCrumb API, the API base URL setting is gone from the options page and from storage, and no feature reports that BreadCrumb cannot be reached.
- Given the shared packages, When the build runs, Then the parser and the confirmation package still build and their tests still pass, and the confirmation package no longer depends on anything that only existed in the server.
- Given continuous integration, When it runs on the change, Then it builds and tests only the packages that remain, with no step referring to a container image or a database.
- Given the README, When it is read by someone who has never seen the project, Then it describes installing an extension, and nothing in it describes hosting a service.
- Given a user who relied on the web pages to paste a link, When they read the README, Then it points them at the in-extension paste (BC-054).

Priority: Must. Size: M. Depends on: nothing outstanding; the last two criteria wait on BC-054.
Decisions to close first: D16, D22.

#### BC-054 Paste a link by hand in the extension

**Shipped 2026-09-25.** Tim settled decision D14 by describing the flow he wanted: a "Paste a link" control that reveals a field, and a result that joins the top of the list when there is one.

As a user, I want to paste any Microsoft 365 link into the extension, so that I can get its folder location when the link did not come from a Copilot citation.

- Given the extension popup on any page, When the user chooses to paste a link, Then a single input accepts one link and converting it shows the same row presentation as a citation: file name, document location, confidence state and the copy actions. **Done.**
- Given a pasted link on a tenant the user has granted, When it is converted, Then it is confirmed with the SharePoint session exactly as a citation is (BC-049), and the row shows Verified with the method text naming the call. **Done.**
- Given a pasted link that fails to parse, When it is converted, Then the failure message and reason are shown in the row, with no exception and no empty state. **Done.**
- Given a pasted link, When it has been converted, Then it is kept in the extension’s history (BC-055) with its source recorded as pasted rather than extracted. **Not yet: the row carries its source, but there is no history to keep it in until BC-055.**
- Given the popup opened on a page that is not a Copilot surface, When it opens, Then the paste input is available there too, so the extension is useful anywhere. **Done.**
- Given a document already listed, When the same document is pasted in any link form, Then it moves to the top rather than being listed twice. **Done.**

Priority: Must. Size: M. Depends on: BC-055 for the last criterion only.
Decisions: D14 closed 2026-09-25, in the popup, revealed by a button.

#### BC-055 The extension keeps its own history

**Shipped 2026-09-25.** Decisions D8, D11, D15 and D21 taken as recommended: failures are kept, the note and this history both stay, the cap is two thousand dropping the oldest never written to the note, and a written entry is marked rather than hidden.

As a user, I want every link I resolve to be remembered on my device, so that I can find a folder again without repeating the work.

- Given a resolved citation or pasted link, When it is shown in the popup, Then it is written to extension storage with its link, document key, file name, path, folder URL, state, method text, the page it came from and the time. **Done.** Surviving a browser restart and an extension update is browser behaviour for `storage.local`, and is worth one manual check.
- Given the same document resolved again through a different link form, When it is written, Then it updates the existing entry rather than adding a second one, matching on the parser’s document key. **Done.**
- Given an entry that was Inferred and is later confirmed, When the confirmation arrives, Then the entry records the upgrade and keeps the earlier state and values visible. **Done.**
- Given storage that is filling up, When the number of entries passes the cap, Then the oldest are dropped first, the cap is stated in the options page, and the user is told when dropping starts. **Done.**
- Given a failure to write to storage, When it happens, Then the popup says so plainly and the result is still shown. **Done.**
- Given the Obsidian output is configured, When an entry is written to the note, Then the local entry records that it was written, and when. **Done.**

Priority: Must. Size: M. Depends on: BC-044.
Decisions: D8, D11, D15 and D21 closed 2026-09-25.

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

#### BC-057 Options page for tenant and note settings

As a user or an administrator, I want one place to set up the extension, so that granting tenant access and pointing at a note are obvious and reversible.

- Given the options page, When it is opened, Then it offers the tenant host access grant (BC-049), the vault folder and note path (BC-067), the history cap and nothing that refers to a BreadCrumb server.
- Given the vault folder, When the user picks it, Then the picker runs from this page rather than the popup, the chosen folder is named back to the user, and the grant survives a browser restart or says plainly that it must be given again.
- Given a vault folder granted earlier, When the user wants it gone, Then it can be revoked here, and after revoking the extension holds no file access at all.
- Given a tenant host granted earlier, When the options page is opened, Then the granted hosts are listed with the date they were granted and each can be revoked, and revoking takes effect without reloading the extension.
- Given a value supplied by enterprise policy (BC-063), When the options page is opened, Then that value is shown, marked as set by the organisation, and cannot be edited there.
- Given a setting is changed, When it is saved, Then the popup uses the new value the next time it opens, and an invalid value is refused with a message naming the setting.

Priority: Must. Size: S. Depends on: BC-053.
Decisions to close first: D10, D18.

### E9 Obsidian note output

#### BC-067 Send selected results to an Obsidian note

**Sprint 1 shipped 2026-09-19:** the vault folder picker and note path on the options page, the file route (a directory handle kept in IndexedDB, read and write through the File System Access API), "Send selected to Obsidian" in the popup, note and table creation, always-append, the header mismatch refusal, and skipping rows whose location is unknown. The format is documented in `docs/obsidian-note.md`. **Added 2026-09-20:** every row now says whether it was written or why it was not, the bar names the vault and note before a send (a BC-069 criterion met early), and a successful send offers "Open the note in Obsidian". A hung vault lookup now gives up after three seconds rather than leaving the button disabled. **Still open in this story:** the real-browser run against a vault with Obsidian open, which only Tim can do.

As a knowledge worker, I want the files I find written into my Obsidian vault as rows in a table, so that a folder location I worked out once stays in my own notes.

- Given a configured vault and note, and a selection in the popup, When the user sends the selection, Then one table row is appended per document with the documented columns filled (BC-068), and each row in the popup reports its own outcome.
- Given the configured note does not exist, When a selection is sent, Then the note is created at that path with the front matter and the table header from BC-068, then the rows are appended, and the popup says the note was created.
- Given the note exists and already holds the table, When rows are appended, Then they go into that table, the existing rows and everything else in the note are unchanged, and the file ends with exactly one newline.
- Given the note exists but has no table, When rows are appended, Then the table header is added under the documented heading and the rows follow, and any other content in the note is left alone.
- Given a document that is already a row in the table, When it is sent again, Then a new row is appended anyway (decision D12): BreadCrumb never reads the existing rows to decide, and the two rows differ by their date processed.
- Given a write that fails, When the reason is a missing or revoked file permission, a vault folder that has moved, a note that cannot be parsed or a file locked by another program, Then the popup says which, names the note, and nothing is half written: either the whole append lands or the note is untouched.
- Given the Obsidian output is not configured, When the popup opens, Then nothing about Obsidian is shown and every other feature works unchanged.
- Given a successful write, When the user asks to see it, Then the popup offers to open the note in Obsidian.

Priority: Must. Size: L. Depends on: BC-068.
Decisions: D10, D12, D19 and D26 are closed. D21 and D25 are open but do not block the first sprint.

#### BC-068 Note and table format

**Sprint 1 shipped 2026-09-19:** the columns, escaping, date format and `docs/obsidian-note.md`. **Still open:** the criterion about mapping onto a table whose header a person reordered; today BreadCrumb refuses such a table rather than mapping onto it, which satisfies the "never write misaligned rows" half.

As someone who reads these notes later, I want the note and its table to be plain, predictable Markdown, so that the rows are useful in Obsidian and survive being edited by hand.

- Given the documented format, When it is read, Then it states the note's front matter, the heading the table sits under, the column set and order settled in decision D19, what each column holds, and the date format used.
- Given a row written by BreadCrumb, When it is read in Obsidian's reading view and in the editor, Then the table renders correctly, and a value containing a pipe, a newline or Markdown syntax does not break the table.
- Given a long document location, When it is written, Then the row stays on one line: no wrapping, no line breaks inside a cell.
- Given a table a person has edited by hand, for example by reordering or renaming columns, When BreadCrumb next appends, Then it maps its values onto the table's own header row where it can, and refuses with a plain message naming the mismatch where it cannot, rather than writing misaligned rows.
- Given the format, When someone wants the links to be clickable in Obsidian, Then the document states how the folder link and original link are written as Markdown links, and shows a rendered example.

Priority: Must. Size: S. Depends on: nothing outstanding.
Decisions: D19 is closed. D20 is closed by it: no column records who captured the row.

#### BC-069 Honest about what it writes

As a person whose file names end up in a note that may be synced or shared, I want to see exactly what will be written before it is written, so that nothing sensitive is written by accident.

- Given a selection about to be sent, When the user asks what will be sent, Then the popup shows the row as it will appear for the first item and says the same columns go for every item.
- Given the configured target, When the popup is open with Obsidian output on, Then the vault and note path being written to are named where the user can see them, not only on the options page. **Done 2026-09-20 with BC-067.**
- Given a document whose state is Unresolved or failed, When the user sends a selection, Then it is not written, and the popup says which were left out and why.
- Given a write that partly succeeded, When the popup reports, Then it states which rows were added, which were updated and which failed, and the local history records the same.

Priority: Should. Size: S. Depends on: BC-067.
Decisions to close first: D20.

#### BC-065 Write to Obsidian without granting file access

As a user who will not give a browser extension access to a folder, I want another way to get rows into my note, so that the Obsidian output is still usable.

- Given the fallback route chosen in D10, When the user sends a selection, Then the rows reach the configured note without the extension holding a file handle, and the popup says which route was used.
- Given the fallback route needs Obsidian to be running or a plugin to be installed, When it is not available, Then the message says exactly what is missing and how to set it up, and nothing is silently lost.
- Given either route, When the same selection is sent, Then the row content is identical: the format in BC-068 does not depend on how the write happens.
- Given the fallback, When the user has no Obsidian at all, Then "Copy as table rows" (BC-066) is offered instead.

Priority: Should. Size: M. Depends on: BC-067, S13.
Decisions to close first: D10.

#### BC-066 Copy the selection as Markdown table rows

**Sprint 1 shipped 2026-09-19:** "Copy as table rows" in the popup, always with the header row.

As a user, I want the selected results on my clipboard as table rows, so that I can paste them into any note, wherever it lives.

- Given a selection, When the user copies it as table rows, Then the clipboard holds one Markdown table row per document in the BC-068 column order, ready to paste under an existing header.
- Given nothing has been configured, When the copy action is used, Then it works: it needs no vault, no note and no Obsidian.
- Given a paste into an empty note, When the user wants a whole table, Then the copy includes the header row when the user asks for it.
- Given the same escaping rules as BC-068, When a value contains a pipe or a newline, Then the pasted row does not break the table.

Priority: Should. Size: XS. Depends on: BC-068.
Decisions to close first: D19.

#### BC-061 Sign in to Microsoft from the extension

As a user whose SharePoint session cannot confirm every citation, I want to sign in from the extension, so that the rest can be confirmed before I write them to my note.

- Given the sign in control in the extension, When the user signs in against the tenant, Then a delegated token is obtained through the route chosen in spike S12, the token is held only for the session, and nothing is written to disk that would let another program use it.
- Given a signed in user, When a citation the SharePoint session could not confirm is looked up, Then it is confirmed through Graph and the method text names the call, exactly as the withdrawn web application did.
- Given a signed in user, When they sign out, Then the token is discarded, and the extension keeps working in best effort and session modes.
- Given no sign in, When the extension is used, Then every feature except Graph confirmation works, including the Obsidian output, and nothing prompts for sign in unprompted.
- Given consent is refused by the tenant, When sign in is attempted, Then the message names the permission that was refused and says what stays unconfirmed without it.

Priority: Could (the Obsidian output no longer depends on it; only Graph confirmation does). Size: M. Depends on: S12.
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

- Given the extension installed by enterprise policy with managed settings, When it first runs, Then the note path, the table format and the granted tenant hosts come from policy, and the user is not asked for them.
- Given the vault folder, When policy is applied, Then it is still picked by the user, because a folder permission cannot be granted by policy; the options page says so plainly rather than appearing broken.
- Given a policy value and a user value for the same setting, When they differ, Then the policy value wins and the options page says the organisation set it (BC-057).
- Given policy is removed, When the extension next runs, Then it falls back to the user's own settings and says so, rather than failing.
- Given the documentation, When an administrator reads it, Then it gives the exact policy keys and one worked example for Microsoft Edge.

Priority: Should. Size: S. Depends on: BC-057, S11.
Decisions to close first: D7.

#### BC-072 Say what the refusal actually was

**Shipped 2026-09-24**, raised by Tim in user testing: the popup claimed six files had no signed in session on two hosts, while thirty one files on those same hosts had just been confirmed. One of the six was a file in a colleague’s OneDrive.

As a user, I want each unconfirmed file to say what actually stopped it, so that I do not go looking for a sign in problem that is not there.

- Given a file on a host where another file has just been confirmed, When SharePoint refuses it, Then it is never reported as a missing session, because the session plainly works. **Done.**
- Given a 403, When it is reported, Then it says the account has no access to that item, and says so in OneDrive terms when the host is a personal one. **Done.**
- Given a 404, When it is reported, Then it says the file is no longer there, and names the usual causes. **Done.**
- Given a link the validator cannot look up at all, When it is reported, Then it says the link does not point at a file, rather than blaming access. **Done.**
- Given a mix of these, When the summary line is written, Then each group is counted separately rather than lumped into one number. **Done.**
- Given a host that really has no session, When nothing on it has confirmed, Then the sign in helper appears exactly as before. **Done.**

Priority: Must. Size: S. Depends on: BC-049, BC-071.

#### BC-071 The popup helps rather than blames

**Shipped 2026-09-23**, both raised by Tim in user testing.

As a user, I want the popup to behave well when it has nothing to show and when it cannot confirm anything, so that I know what happened and what to do next.

- Given an answer that cites no files, which is the ordinary case, When the popup opens, Then it says so as an outcome rather than an error, explains in one line what BreadCrumb lists, and offers to look in the whole chat. **Done.**
- Given that the answer did cite files and extraction missed them, When the user wants to report it, Then the markup detail and the redacted sample sit behind a disclosure rather than in the way. **Done.**
- Given a tenant the user has granted but no SharePoint session in this browser, When confirmation fails with 401 or 403, Then the popup names the sites with no session, offers a link to open each, and a "Check again" button that re-runs confirmation. **Done.**
- Given the same case, When a row is read on its own, Then it says to open that site and check again, rather than "your session could not confirm it". **Done.**
- Given the options page with a tenant set, When it is read, Then it offers the same two links, because that is where the grant is given. **Done.**

Priority: Must. Size: S. Depends on: BC-049.

#### BC-070 The popup copes with a long chat

**Mostly shipped 2026-09-22**, raised by Tim before user testing: a long conversation can cite far more files than a popup can sensibly list, and confirming them all at once is slow and rude to the tenant.

As a user with a long Copilot conversation, I want the popup to stay quick and readable, so that fifty citations are no worse to work with than five.

- Given a conversation with many answers, When the popup opens, Then it reads only the latest answer, and a control offers the whole chat instead. **Done.**
- Given the whole chat is chosen, When the citations are listed, Then the count is shown, the first twenty five rows are rendered, and the rest appear on one press. **Done.**
- Given many rows, When they are confirmed with the SharePoint session, Then a few go at a time rather than all at once, and the status line says how far it has got. **Done.**
- Given many rows, When the user wants most of them, Then "Select all" and "Select none" tick them together. **Done.**
- Given a very long chat, When confirmation would take a long time, Then the rows the user can see are confirmed first, and the rest follow.
- Given the same document cited in several answers, When the whole chat is read, Then it appears once, as it already does within one answer.

Priority: Must. Size: M. Depends on: BC-044.
Decisions: none outstanding. The row cap and the number of lookups at once are in the code, not settings; make them settings only if testing shows the defaults are wrong.

### E6 Copilot extension

#### BC-050 Chrome and other Chromium browsers

As a user of Chrome or another Chromium browser, I want the extension to work there too, so that I am not tied to Edge.

- Given the extension loaded unpacked in current stable Chrome, When the acceptance criteria of BC-042 to BC-049, BC-054 to BC-057 and BC-065 to BC-069 are run, Then they pass or each difference from Edge is recorded, including how that browser handles the vault folder permission.
- Given enterprise policy on Chrome, When BC-063 is run there, Then the policy keys are recorded for that browser too, or the difference is stated.

Priority: Could (a want, low priority). Size: S. Depends on: BC-067.

---

## 6. Release plan

Milestones M1 to M4 were delivered between 10 and 15 September 2026 under the previous architecture (a self hosted web application plus an extension that submitted to it). Their stories are in `BACKLOG-completed.md`; the parts that the architecture change removes are listed there under `## Superseded`. What survives them is the shared parser, the confirmation package, the citation extraction and the popup.

### M5 The extension stands alone

Stories: BC-053, BC-054, BC-055, BC-056, BC-057, BC-062.

Demonstrable outcome: on a machine with no BreadCrumb server anywhere, the extension is installed in Microsoft Edge. A Copilot response citing SharePoint and OneDrive files is opened, and the popup lists the files with their document locations, confirming them with the browser's SharePoint session while the user watches. A link that never appeared in Copilot is pasted into the extension and resolves the same way. Both appear in the extension's own history, which survives a browser restart, can be searched and filtered, and exports as CSV and JSON. Nothing in the repository builds a container.

Deliberately excluded: the Obsidian output, sign in to Microsoft, enterprise policy, Chrome.

Progress evidence at the boundary: a recording of the popup and the history page on a machine with no server running, and an exported file.

### M6 Obsidian output

Stories: BC-067, BC-068, BC-069, BC-065, BC-066, BC-063, BC-070, BC-071, BC-072.

**Sprint 1 (started 2026-09-19): rows in a note.** BC-068 (the format), the core of BC-067 (pick a vault folder on the options page, set a note path, append rows from the popup with a button, create the note and the table when they are not there, report what happened per row) and BC-066 (copy the selection as table rows). Deliberately left for later in the milestone: the fallback route (BC-065), the full "show me what will be written" preview (BC-069, though the vault and note path are already named in the popup), enterprise policy (BC-063) and the packaged release (BC-064).

Demonstrable outcome: a user points BreadCrumb at their vault and a note path. They open a Copilot response, select citations and send them. The note is created with its front matter, heading and table header, and a row appears per document. Sending more citations later appends to the same table without touching anything else in the note, and sending the same document again behaves as decision D12 says. Obsidian, open beside the browser, shows the rows arriving. The same selection can be copied as table rows and pasted into any other note. The rollout uses a versioned package, with the note path and table format pushed by policy.

Deliberately excluded: writing anywhere outside the configured note, editing or reorganising the user's notes, an Obsidian plugin of our own, vault sync, scheduled or background writes, Chrome (BC-050, Could).

Progress evidence at the boundary: the note before and after two sends, the policy file used, and the package that was installed.

---

## 7. Spikes

Each spike is timeboxed. If the timebox ends without the closing evidence, the dependent stories are re-planned rather than the spike extended.

| ID | Question | Timebox | Closing evidence | Blocks |
|---|---|---|---|---|
| S2 | Does the shares endpoint with a `u!` base64url encoded link return a driveItem for `/s/`, `/g/` and `/t/` tokens and for `-my` host tokens, what is the minimum delegated permission when Graph is used, does it work for a token created by another user, does the legacy `guestaccess.aspx` form resolve, and does a personal site resolve by path? | 1 day | A table of link variant against result and HTTP status from the test tenant, with the exact permission set that succeeded and the smallest set that failed. Removes the [unverified] markers in matrix rows 3b, 3c, 3d, 6 and 8. | BC-061 |
| S3 | Which link forms does a modern tenant actually emit from its own copy link and share controls today: the SharePoint library "Copy link" for each audience option, OneDrive web, the Office desktop share dialogue, the Teams files tab, an Outlook attachment link, and a Copilot citation? Do `RootFolder`, `guestaccess.aspx` and the Safe Links `/ap/` variant still appear? What do `/g/` and `/t/` mean? | 1 day | One anonymised fixture per control and audience option added to the corpus (BC-022), and a note against each matrix row saying "emitted today", "legacy but seen" or "not observed". Removes the [unverified] markers in rows 1b, 3c, 3d, 8 and 10. | BC-022 completeness. Nothing else is blocked. |
| S13 | **Partly answered by building it in sprint 1 (2026-09-19): the file route works, and the decision is closed in D10.** What remains, if BC-065 is ever built: how does the extension get rows into a vault note? Three candidates: the File System Access API with a directory handle for the vault, picked once and kept in IndexedDB; the `obsidian://` URI scheme, with and without the Advanced URI community plugin; and a local REST API plugin. For the file route: does a picker work from the popup or only from the options page, does the handle survive a browser restart and an extension update, when is permission re-prompted, and does a user gesture suffice? For the URI route: can it append to an existing note without opening a window each time, and can it target a table rather than the end of the file? What does Obsidian do when a note it has open changes underneath it, and what happens when the vault is syncing? | 2 days | A row appended to a real vault note by each route that works, with the exact API calls, the permission behaviour after a restart and an update, a note on what Obsidian did with the open file, and a statement of which route BC-067 should use and which BC-065 becomes. Feeds decision D10. | BC-067, BC-065, D10 |
| S11 | How are managed settings delivered to an extension in Microsoft Edge: which policy keys and file or registry locations, does `storage.managed` read them without extra permissions, and how does a policy value behave when it changes while the browser is running? Can anything about a file or folder permission be delivered this way, or must the vault always be picked by the user? | Half a day | A working policy on this machine that sets the note path and table format, with the exact keys recorded, a note on what happened when the value changed, and a statement on the vault folder. | BC-063 |
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

**Obsidian note tests.** The note writer is pure text work and is tested as such: given the text of a note and a set of rows, it returns the new text. The cases are a missing note, an empty note, a note with the table already there, a note with other content above and below the table, a table whose header a person has reordered or renamed, a note with no trailing newline, values containing pipes, newlines and Markdown syntax, and a document key already present. The file access itself is tested against a fake of the directory handle, including a revoked permission, a missing folder and a file that cannot be written. One manual run per milestone boundary writes to a real vault with Obsidian open.

**Confirmation tests.** The confirmation package is tested against recorded SharePoint and Graph responses. Every new recorded response is anonymised before it enters the repository.

---

## 9. Non functional requirements

| Area | Requirement |
|---|---|
| Installation | Installing the extension is the whole installation. No server, container, database or network service is required, and the repository contains nothing that deploys one. |
| Packaging | A versioned package produced by a documented release step (BC-064), installable unpacked or by enterprise policy. |
| Configuration | Settings come from the options page or enterprise policy (managed storage). No secrets in the repository, in the package or in logs. There is no client secret: any Entra registration is a public client. |
| Persistence | The extension's history lives in extension storage on the device, within the browser's quota, with a documented cap and a stated drop order (BC-055). It is a working copy, not a system of record. |
| Data sensitivity | History and note rows hold client names and file titles. Local history is visible to anyone using that browser profile; the note is as private as the vault it sits in, which may be synced or shared. The README says both plainly, and the vault and note path are always visible while the Obsidian output is on. |
| Network posture | The extension talks only to Microsoft 365 hosts: the Copilot hosts it runs on, the tenant SharePoint and OneDrive hosts the user has granted, and Microsoft Graph when signed in. The Obsidian output is local: a file write on the device, or a local URI handled by Obsidian. It has no backend of its own and sends data to no third party. |
| Error handling | No unhandled exception reaches a user. Every failure carries a reason code and a plain language message. A failure to persist or to write to the note is never silent, and a failed note write never leaves the note half written. |
| Performance | Conversion under 100 ms for any offline form. The popup lists citations within a second of opening, and confirmation updates rows as answers arrive rather than blocking the list. History search under one second at two thousand entries. |
| Browser support | Microsoft Edge (current stable) is the primary and only required browser. Chrome and other Chromium browsers are a low priority want (BC-050). Firefox and Safari are out of scope. |
| Accessibility | WCAG 2.2 AA for contrast and keyboard operation, state never conveyed by colour alone, in the popup, the options page and the history page. |
| Privacy of credentials | Cookie values are never read. Tokens, where they exist at all, are held for the session and never written where another program could use them. |
| File access | The extension holds access to exactly one folder, the vault the user picked, and writes to exactly one note inside it. The grant is visible on the options page and revocable there. Nothing else on the device is read or written. |

---

## 10. Risk register

Likelihood and impact are High, Medium or Low. Owner is a placeholder role until names are assigned.

| ID | Risk | Likelihood | Impact | Mitigation | Owner |
|---|---|---|---|---|---|
| R1 | Copilot citation markup changes without notice on any of the three hosts, breaking extraction. | High | Medium | Select on the most stable roles and attributes found in S1, keep DOM captures as fixtures, fail to a "no citations found" state with a report action (BC-043), and treat each host's selectors as separately replaceable. | Extension owner |
| R2 | Delegated permission consent is refused or delayed in the production tenant. | Medium | Low | Best effort parsing and session confirmation never need consent, and the Obsidian output needs no Microsoft permission at all. Only Graph confirmation (BC-061, Could) would need it. | Product owner |
| R3 | Some link forms cannot be resolved at all, even with a lookup. | Medium | Low | They remain Unresolved with an honest message. The matrix records the ceiling per form. | Parser owner |
| R7 | Extension installation is blocked by browser policy on managed devices, or the device blocks a browser extension writing to local files. | Medium | High | Now the whole product, not one of two ways in. Confirm with the device administrator that policy installation, the optional SharePoint host permission and local file access are allowed; prove the policy path in S11 before M6. BC-065 and BC-066 are the routes that survive a file access block. | Product owner |
| R9 | The library boundary heuristic is wrong often enough that Inferred results mislead. | Medium | Medium | Always label Inferred. Measure the hit rate against confirmed results and refine BC-018 from real data. | Parser owner |
| R12 | The Verified state is asserted by the extension, so a modified extension could claim a false Verified. | Low | Low | Acceptable: the audience is the user's own team. Record the item id with every Verified result so it can be re-checked. | Product owner |
| R13 | No usable route into the vault: the browser will not keep a folder permission across restarts, the picker cannot be driven from the extension, or the URI route cannot target a table. | Medium | High | Spike S13 before any of M6 is built, trying three routes. BC-065 keeps a second route alive and BC-066 (copy as table rows) needs no integration at all, so the output degrades rather than disappearing. | Extension owner |
| R14 | Local history is lost: the extension is removed, the profile is reset, or the browser evicts storage. | Medium | Medium | Say plainly that it is a working copy. Export (BC-056) and the vault note (BC-067) are the ways to keep anything that matters. Cap and drop order are documented. | Product owner |
| R15 | A user writes file names into a note that is synced or shared more widely than they realise. | Medium | Medium | Show what will be written before writing (BC-069), name the vault and note in the popup, refuse to write Unresolved and failed rows, and say plainly that the note is only as private as the vault. | Product owner |
| R16 | The note drifts: someone reorders or renames the table columns, edits rows by hand, or moves the table. | High | Medium | Read the table's own header before appending and map onto it; refuse with a plain message rather than writing misaligned rows (BC-068). Never rewrite anything except the table BreadCrumb appends to. | Extension owner |
| R19 | Two writers at once: the note is open in Obsidian, or the vault is syncing, while BreadCrumb appends, and an edit is lost or a sync conflict file appears. | Medium | Medium | Read immediately before writing and write the whole file once; if the note changed since it was read, stop and tell the user rather than overwriting. Spike S13 records what Obsidian and the sync tool actually did. | Extension owner |
| R20 | Obsidian changes its URI scheme, or the community plugin the fallback route relies on is abandoned. | Medium | Low | The file route (BC-067) depends on neither. The fallback is a second route, never the only one, and BC-066 needs nothing external. | Extension owner |
| R17 | Removing the web application takes away the only place to paste a link that did not come from Copilot. | High | Medium | BC-054 delivers the paste path inside the extension before BC-053 removes the pages. | Product owner |
| R18 | Everything now depends on one browser extension: a breaking browser change stops the whole product. | Low | High | Keep the parser and the confirmation package free of extension APIs so they can be reused, pin the manifest version in the release package, and test each Edge update at the milestone boundary. | Extension owner |

Risks R4, R5, R6, R8, R10 and R11 are closed by the architecture change: they were about hosting the web application on a private network, reaching it from the extension, and the SQLite database. They are kept in `BACKLOG-completed.md` history only.

---

## 11. Open decisions

Each row says when it has to be settled. A story cannot start while a decision it depends on is open: either close the decision or re-plan the story. Where I have a recommendation it is stated in bold, and that is what the stories assume until someone says otherwise.

| ID | Decision needed | Options | Decide by | Who decides |
|---|---|---|---|---|
| D7 | How the extension is distributed. | Unpacked developer mode; enterprise policy from a private update URL; browser store. Now the only distribution question, since there is no server. | Before BC-064, and before M6 is demonstrated. Blocks BC-063, R7. | Product owner |
| D8 | Whether failed conversions are kept in the extension's history by default. **Decided 2026-09-25: always kept.** A link that could not be converted is worth seeing again, and local history is cheap. | Never kept; kept only when the user opts in; always kept (decided). | Closed. | Product owner |
| D10 | How rows reach the vault. **Decided 2026-09-19: the File System Access API with a directory handle for the vault, picked once on the options page.** BreadCrumb reads the note, places rows inside the table and writes the whole file back. Obsidian's own Web Clipper uses the `obsidian://` URI with the clipboard and is capped near 1,500 characters of content, which a growing table would pass; the file route has no such limit. The URI route stays as BC-065, for people who will not grant folder access. | File access with a vault folder handle (decided); the Obsidian URI scheme; a local REST API plugin; clipboard only (BC-066). | Closed. | Product owner |
| D11 | Whether the extension's local history stays once the note output exists. **Decided 2026-09-25: keep both.** The note is the record that lasts; the local history is the working copy. | Keep both (decided); local only; write to the note and keep nothing locally. | Closed. | Product owner |
| D12 | What happens when a document is sent again. **Decided 2026-09-19: always append a new row.** BreadCrumb never reads the existing rows to decide, never updates and never skips, so the note is a log of what was sent and when. The date processed column tells the two apart, and a duplicate is the user's to remove. | Always append (decided); update the row in place; skip it and say so. | Closed. | Product owner |
| D13 | Whether Microsoft Graph confirmation survives at all, now that the SharePoint session covers the tested forms and the note output needs no Microsoft credential. | Keep it for what the session cannot confirm (assumed in BC-061 and BC-062); drop it and accept the session's ceiling. | After S12, before M6 planning is fixed. Blocks BC-061. | Product owner |
| D14 | Where the paste input lives. **Decided 2026-09-25: in the popup, behind a "Paste a link" control that reveals the field**, so it costs nothing when it is not wanted and is there on any page, Copilot or not. | Popup only (decided); a separate extension page; the browser side panel; both popup and page. | Closed. | Product owner |
| D15 | The history cap and what is dropped first. **Decided 2026-09-25: two thousand, dropping the oldest that were never written to the note.** The options page says how many are kept, and the popup says when older results made way. | A fixed cap with oldest first (decided); a cap the user sets; no cap until the browser complains; never drop. | Closed. | Product owner |
| D16 | What the third row action becomes now that "In BreadCrumb" has nowhere to go. **Recommended: "Open in Obsidian" once the document has a row, using an `obsidian://` link to the note; otherwise no third action.** Taken as "no third action" on 2026-09-18 when the web pages went; revisit with BC-067. | Open the note in Obsidian (recommended); open the extension's own history entry; drop the third action. | Before BC-067 ships. | Product owner |
| D17 | When extraction runs: on opening the popup, as now, or as the Copilot response arrives. | On popup open (as now); watch the page and keep a running list; watch only when the user turns it on. | Before M5 is demonstrated; affects BC-062 and R1. | Extension owner |
| D18 | How the note target is expressed, and whether more than one is allowed. **Recommended: one vault folder handle plus one note path relative to it, for example `BreadCrumb/Document locations.md`.** | One vault and one fixed note path (recommended); a note per month or per tenant, from a pattern; a note chosen per send. | Before BC-057 and BC-067 start. | Product owner |
| D19 | The table's columns and how values are written. **Decided 2026-09-19: Document name, File path, Source URL, Folder URL, Date processed, in that order.** File path is the human readable decoded path. The two URLs are written bare, because Obsidian links them in reading view and they stay copyable as text. Date processed is local `YYYY-MM-DD HH:mm`. A pipe in a value is escaped and newlines become spaces, so a row never breaks the table. No document key column: D12 means nothing is ever matched. | Closed. | Product owner |
| D20 | Whether a row records who captured it. **Recommended: no, since the vault belongs to one person; revisit only if a shared vault is a real case.** | Nothing (recommended); the signed in user the session reports; a free text note the user sets once. | Before BC-068 is written. Feeds R15. | Product owner |
| D21 | Whether a result that has been written to the note is hidden, marked or left alone in the local history. **Decided 2026-09-25: marked, never hidden**, and a marked entry outlives an unmarked one when the cap bites. | Marked (decided); hidden behind a filter; removed locally once written. | Closed. | Product owner |
| D22 | Where diagnostics go now that the server log is gone. **Recommended: copy a redacted report to the clipboard, as "Report markup" already does.** | Clipboard only (recommended); a downloaded file; the browser console only; an opt in endpoint. | Before BC-053 removes the client log route. | Extension owner |
| D23 | What happens on a tenant host the user has not granted. **Recommended: show best effort results and offer the grant in the row, never prompt on open.** | Offer in the row (recommended); prompt on opening the popup; say nothing and stay best effort. | Before M5 is demonstrated. | Product owner |
| D24 | Whether the extension keeps a versioned export of history that another install can read, as insurance against R14. | JSON export that imports back (an import story would be added); export only, no import; neither. | Before BC-056 is built. | Product owner |
| D25 | What happens when the note has changed while BreadCrumb was writing it. Sprint 1 reads the file and writes it back in one step, so the window is small but not zero. **Recommended: compare the file's last modified time between read and write, and stop if it moved.** | Compare last modified and stop (recommended); write anyway; keep a copy of the previous text beside the note. | Before the Obsidian output is used by more than one person on one vault. Feeds R19. | Extension owner |
| D26 | Whether the Obsidian output is on by default once configured, or armed per send. **Decided 2026-09-19: a button the user presses, never automatic.** | A "Send to Obsidian" button (decided); automatic on confirmation; automatic for Verified rows only. | Closed. | Product owner |

Decisions D1, D2, D5 and D6 are closed by the architecture change: the web framework, the SQLite driver, history search and TLS on a private network no longer apply. D3 (where Graph tokens live) is replaced by D10 and by invariant 15 in its new form. D4 (application level access control) no longer applies: there is no application to control access to, and the vault's own location governs who can read the note. D9 (session confirmations count as Verified) stands. D22 was taken as recommended on 2026-09-18: diagnostics go to the clipboard.

---

## 12. Explicitly out of scope

- Any BreadCrumb server, API, database, container image or deployment. Withdrawn 2026-09-17.
- Personal (consumer) OneDrive in any form: such links fail with a not supported message (BC-051).
- Authenticated confirmation for sovereign and government clouds. Those links parse in best effort mode only.
- Extension support for Firefox, Safari or any non Chromium browser, and browser store publication.
- Copilot surfaces other than the three named hosts, including Copilot panes inside Word, Excel, PowerPoint, Outlook and Teams.
- Any write operation against SharePoint or OneDrive: never files, folders, permissions or sharing. BreadCrumb reads from Microsoft 365 and writes only to the user's own note.
- Writing anywhere in the vault except the configured note, or changing anything in that note except the table BreadCrumb appends to.
- An Obsidian plugin of our own, or any dependency on a specific community plugin for the main route.
- Reading the vault to answer questions, indexing it, or syncing it.
- A SharePoint list output, withdrawn on 2026-09-19 after market research.
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
12. Persistence failures, local or to the note, are never silent.
13. The extension's storage is a working copy on one device. Anything that must outlive it goes to the Obsidian note or an export.
14. Configuration comes from the options page or enterprise policy only. No secret is committed to the repository, packaged into the extension or written to logs.
15. Credentials stay with Microsoft: cookie values are never read, and any token exists only for the session and is never persisted where another program could use it.
16. BreadCrumb never writes to Microsoft 365. Its only write anywhere is to the note the user chose, inside the vault folder the user picked, and only when the user asks. It appends to, and updates rows in, the table it maintains; it changes nothing else in that note and nothing else in the vault.
17. The extension declares host permissions for the three named Copilot hosts. It may also hold the optional host permission `https://*.sharepoint.com/*`, which covers SharePoint and OneDrive for Business, requested at runtime for one tenant's hosts only when the user asks. Nothing broader. Consumer OneDrive and sovereign cloud hosts are not included.
18. The consumer Copilot host shows a defined empty state, never an error.
19. History is a log of lookups. Entries are appended, updated by document key and deleted, never silently edited.
20. A note BreadCrumb writes is a plain Markdown file that a person can read, edit and keep without BreadCrumb. No private syntax, no machine-only fields, nothing that breaks if the extension is removed.
21. New stories should improve one or more stages of: find or paste a link, get the folder path, keep the result in the user's own notes.
