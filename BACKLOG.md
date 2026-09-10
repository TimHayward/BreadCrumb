# BreadCrumb product backlog

Repository: github.com/TimHayward/BreadCrumb
Document date: 10 September 2026
Status: draft for review. Planning artefact only. No application code, schema, compose or configuration content appears in this document.

**How to use this file.** Each story is self contained and written to be executed cold by an AI coding model or a developer with no other context. Pick a story, read its dependencies, implement, and satisfy every acceptance criterion. Where a story names a spike, the spike closes first and its evidence is linked from the story before implementation starts.

**When a story is done.** Once its acceptance criteria genuinely pass, move the whole story verbatim out of this file into `BACKLOG-completed.md` under a `## Completed` heading, appending a `**Completed:** <YYYY-MM-DD> · <commit SHA>` line. Keep the ID. IDs are never reused. Spikes are moved the same way once their closing evidence exists, with a one line summary of the finding. This file only ever contains open work, so the milestone lists in section 6 shrink as stories complete.

**Design rules.** Section 13 lists the architectural invariants that every story must respect. A story that would break an invariant is re-planned, not implemented.

Conventions used throughout:

- Confidence states, used identically everywhere: **Verified** (confirmed by an authenticated Microsoft Graph lookup), **Derived** (decoded deterministically from the link with no guesswork), **Inferred** (best effort where at least one component is a guess, such as the document library boundary), **Unresolved** (the form is recognised but cannot be decoded without authentication).
- **[unverified]** marks a claim I am not certain of. Every such marker names the spike that closes it.
- Sizes: XS under half a day, S one to two days, M three to five days, L one to two weeks, XL longer than two weeks, for one developer.

---

## 1. Product summary

BreadCrumb is a self hosted tool that turns any Microsoft 365 SharePoint or OneDrive link into the folder location it points at. A user pastes a link into the web application and receives the decoded server relative path, the containing folder URL, the direct file URL and a breakdown of tenant, site, document library, folder chain and file name. Every conversion is stored in a searchable history held in SQLite on a dedicated Docker named volume. A Chromium extension extracts file citations from Microsoft Copilot responses, resolves them with the same shared parser and submits selected items to the web application. Every result states how it was obtained using four states: Verified, Derived, Inferred and Unresolved.

---

## 2. Assumptions

Each line is a gap in the brief that I filled. Correct any that are wrong before M1 starts.

- A single small team uses the tool from the same private network as the host. Write load is a few requests per minute at most.
- "Chromium" means current stable Chrome and Edge. Other Chromium browsers are untested.
- The extension is loaded unpacked in developer mode or pushed by enterprise policy. Store publication is not needed for v1.
- The personal test tenant is an Entra work tenant with SharePoint and OneDrive for Business, not a consumer Microsoft account.
- The web application is served over plain HTTP on the private network in v1 unless the TLS open decision (D6) says otherwise.
- The extension learns the API base URL from a value the user types into the extension options page. There is no discovery mechanism.
- Node LTS at the time M1 starts is the target runtime, and the exact version is pinned during M1.
- The tenant name is the first label of the host, so `848` in the worked example. The site path is `/sites/{name}` or `/teams/{name}`. Links on the root site have an empty site path and the library is the first path segment.
- Corrections made by authenticated validation are recorded alongside the original best effort result rather than overwriting it, so the upgrade is visible.
- Short link expansion needs outbound HTTPS from the container to Microsoft hosts. Where the host has no outbound access the feature is switched off and short links stay Unresolved.
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
| E6 Copilot extension | A Manifest V3 extension that lifts file citations from Copilot responses on the three hosts, resolves them with the shared parser and submits chosen items to the API. | Citations become folder locations without copying links by hand. |
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
| 7a | OneDrive consumer, `onedrive.live.com` with `cid` and `resid` | `https://onedrive.live.com/?cid={hex}&resid={hex}%21{n}&authkey={key}` | Identifiers only | `/shares` with the full URL may work for consumer accounts, but consumer sign in is out of scope for v1 | Unresolved (cid and resid reported as Derived identifiers) | Not in v1 | BC-015 |
| 7b | OneDrive consumer short link | `https://1drv.ms/x/s!{token}` and `https://1drv.ms/b/s/{token}` | Nothing until expanded | Not applicable. Expansion is an HTTP redirect, after which the target is parsed as row 7a or a sharing form | Unresolved until expanded, then as the target | Not in v1 | BC-015, BC-027 |
| 8 | Guest access links | Modern: identical in shape to rows 3b to 3d; nothing in the URL distinguishes a guest recipient [unverified], see S3. Legacy: `https://contoso.sharepoint.com/sites/SiteA/_layouts/15/guestaccess.aspx?docid={id}&authkey={key}` [unverified whether still emitted], see S3 | Type and site hints only | As row 3b for modern. Legacy form: `/shares` with the full URL [unverified], see S2 | Unresolved | Verified where `/shares` accepts it | BC-011 |
| 9 | Teams deep link wrapping a file URL | `https://teams.microsoft.com/l/file/{guid}?tenantId={guid}&fileType=docx&objectUrl={enc-full-url}&baseUrl={enc}&serviceName=teams&threadId={id}&groupId={guid}` | Full unwrap, then as the inner form | As the inner form | As the inner form. The wrapper is recorded in the result | As the inner form | BC-016 |
| 10 | Outlook Safe Links wrapper | `https://{region}.safelinks.protection.outlook.com/?url={enc-full-url}&data={blob}&sdata={blob}&reserved=0` and the `/ap/{code}/?url=` variant [unverified, see S3] | Full unwrap, then as the inner form | As the inner form | As the inner form. The wrapper is recorded in the result | As the inner form | BC-017 |
| 11 | Copy link output carrying `csf`, `web` and `e`, with or without `d` | Any of rows 1, 2 or 3a with `?csf=1&web=1&e={short}` appended | Full | As the underlying row | As the underlying row. The parameters are stripped from output URLs and `d` is retained as an identifier | As the underlying row | BC-010 |
| 12 | Sovereign and government cloud hosts | Rows 1 to 6 on `sharepoint.us`, `sharepoint-mil.us` or `sharepoint.cn` hosts, and on `-my` variants of each | As the matching row | Graph endpoints differ by cloud and are not configured in v1 | As the matching row | Not in v1 | BC-020 |
| 13 | Folder rather than file, in any of the above | Row 1 with `id` equal to `parent`, row 2 ending in a folder, row 3 with a `:f:` prefix | As the matching row | As the matching row | As the matching row, with no file component and the folder URL equal to the path | As the matching row | BC-019 |
| 14 | Malformed, truncated or non Microsoft links | Any input that is not a URL, is missing its host, has a cut off query string, or points at an unrelated host | Fails cleanly | Not applicable | No result state. A reason code and message are returned instead | Not applicable | BC-021 |

Notes on the matrix:

- A modern sharing link in the `/s/`, `/g/` or `/t/` variants cannot be expanded by an unauthenticated HTTP request. Fetching it without a session redirects to sign in, so the web application must not attempt it. Only row 7b is expanded by redirect (BC-027).
- The library boundary is only deterministic in row 1, where the page path places `/Forms/AllItems.aspx` at the library root. In every other form the split between site, library and folders is Inferred until Graph confirms it by listing the site's drives.

---

## 5. User stories

Story format: ID and title, user story sentence, acceptance criteria as Given, When, Then, then priority, size and dependencies. Every criterion is written to be tested on its own.

### E1 Foundation and deployment

#### BC-001 TypeScript monorepo scaffold

As a developer, I want a single repository with separate packages for the parser, the web application and the extension, so that the parser is implemented once and consumed by both.

- Given a fresh clone, When the install and build commands documented in the README are run, Then all three packages build without error and the web application and the extension both resolve the parser as a workspace dependency rather than a copy.
- Given a change to the parser package, When the build runs, Then both consumers pick up the change without a manual publish step.
- Given the repository root, When a reviewer inspects it, Then there is exactly one implementation of link parsing and a search of the repository finds no second copy in either consumer.

Priority: Must. Size: S. Depends on: none.

#### BC-002 Compose file at the repository root runs locally

As the person running BreadCrumb, I want a compose file at the repository root that builds and starts the application with one command, so that local runs and deployments share one definition.

- Given a machine with Docker and Docker Compose and a checked out repository, When `docker compose up` is run from the root, Then the image builds, the container starts and the web application answers on the configured port.
- Given the container is running, When the health endpoint (BC-047) is requested, Then it returns a success response.
- Given no environment file is present, When the stack starts, Then it runs with the documented defaults and prints which settings are in use, without failing.

Priority: Must. Size: S. Depends on: BC-001.

#### BC-003 Portainer stack deploys the same compose file from Git

As the person running BreadCrumb, I want to deploy the stack in Portainer straight from the Git repository, so that the repository is the single source of truth.

- Given a Portainer instance with access to the repository, When a stack is created from the Git repository pointing at the root compose file with no edits, Then the stack deploys and the application answers on the configured port.
- Given the same compose file, When it is used both by the Portainer Git stack and by `docker compose up` locally (BC-002), Then both start the application with identical service and volume names and no file differs between the two uses.
- Given a new commit on the tracked branch, When the stack is redeployed from Portainer, Then the new image is built and the previous container is replaced.
- Given the Portainer stack is redeployed, When history is inspected afterwards, Then all entries from before the redeploy are present (this is the Portainer path of BC-004).

Priority: Must. Size: S. Depends on: BC-002.

#### BC-004 SQLite on a dedicated named volume survives a container rebuild

As the person running BreadCrumb, I want the database to live on a named Docker volume separate from the container filesystem, so that history survives rebuilds and redeploys.

- Given the compose file, When it is inspected, Then the database path is on a named volume declared in the file and is not a bind mount and not a path inside the image layers.
- Given one conversion has been recorded, When the container is stopped, its image rebuilt with a code change and the stack started again, Then the conversion is still present in the history list with the same timestamp and values.
- Given the stack is removed with the command that removes containers but not volumes, When the stack is started again, Then the database and its history are intact.
- Given the named volume, When it is inspected with the Docker CLI, Then it exists independently of any container and contains the database file.

Priority: Must. Size: M. Depends on: BC-002, BC-030.

#### BC-005 Configuration through environment variables only

As the person running BreadCrumb, I want every setting supplied as an environment variable with a documented default, so that no configuration or secret is committed to the repository.

- Given the repository, When it is searched for secrets, keys or tenant identifiers, Then none are found and the README lists every variable, its default and whether it is required.
- Given a required variable is missing or malformed, When the application starts, Then it exits with a message naming the variable and does not start half configured.
- Given an optional variable is not set, When the application starts, Then it logs the default in use.

Priority: Must. Size: S. Depends on: BC-001.

### E2 Shared link parser

#### BC-006 Parser package with a stable public contract

As a developer, I want the parser to be a pure package with one entry point that takes a string and returns a structured result, so that the web application and the extension consume identical behaviour.

- Given any input string, When the parser is called, Then it returns a result carrying exactly one of the states Verified, Derived, Inferred or Unresolved, or a clean failure with a reason code, and never throws for string input.
- Given the package, When its dependency list is inspected, Then it has no dependency on Node built in modules, the DOM or any network client, so it can run unchanged in a browser extension and on the server.
- Given a result, When it is inspected, Then it contains the server relative path, folder URL, file URL where applicable, the components (tenant, host, site path, library, folder chain, file name), a per component flag showing whether that component is Derived or Inferred, the method used, the detected form, and any wrappers that were removed.
- Given the parser's version, When any output changes, Then the package version changes so that history rows can record which parser produced them.

Priority: Must. Size: M. Depends on: BC-001.

#### BC-007 Library view links with id and parent

As a user, I want to paste a library view link (AllItems.aspx) and get the file's path and folder, so that I can find the file in its library.

- Given the worked example link from the brief, When it is converted, Then the path, folder URL and file URL match the expected output exactly, and the result state is Derived.
- Given a library view link whose `id` path begins with the library segment preceding `/Forms/`, When it is converted, Then the library component is marked Derived, the tenant is `848` style first host label, the site path is `/sites/848Technical`, the folder chain lists each folder in order and the file name is the last segment.
- Given a library view link whose `id` path does not begin with the library taken from the page path, When it is converted, Then the library component is marked Inferred and the overall state is Inferred.
- Given a library view link with `id` only and no `parent`, When it is converted, Then the folder is the parent of `id` and the state is unchanged.
- Given a classic view link carrying `RootFolder` instead of `id`, When it is converted, Then the folder is decoded from `RootFolder`, no file component is reported and the state is Derived or Inferred by the same library rule.

Priority: Must. Size: M. Depends on: BC-006, BC-009.

#### BC-008 Direct server relative file and folder URLs

As a user, I want to paste a plain SharePoint URL to a file or folder and get its components, so that I get the same breakdown as for view links.

- Given a direct file URL under a site, When it is converted, Then the path, folder URL and file URL are returned, the path and file are Derived and the library component is Inferred, so the overall state is Inferred.
- Given a direct URL with no file extension on the last segment and a trailing slash, When it is converted, Then it is treated as a folder with no file component.
- Given a direct URL on the root site with no `/sites/` or `/teams/` prefix, When it is converted, Then the site path is empty and the first segment is offered as the Inferred library.

Priority: Must. Size: S. Depends on: BC-006, BC-009, BC-018.

#### BC-009 Percent encoding fidelity

As a user, I want decoded paths to show real characters and rebuilt URLs to be encoded exactly once, so that output links open and paths read naturally.

- Given an input containing `%20`, `%2D` and `%2E`, When it is converted, Then the path shows a space, a hyphen and a full stop respectively.
- Given a decoded path containing spaces, hyphens, full stops, ampersands, hash signs, plus signs and literal percent signs, When the folder and file URLs are rebuilt, Then spaces become `%20`, hyphens and full stops stay literal, ampersands, hash signs, plus signs and percent signs are encoded, and no existing `%20` is turned into `%2520`.
- Given the worked example, When its output URLs are compared with the expected output in the brief, Then they match character for character.
- Given an input with mixed case hex such as `%2d`, When it is converted, Then it decodes identically to `%2D`.

Priority: Must. Size: S. Depends on: BC-006.

#### BC-010 Path bearing sharing links and copy link parameters

As a user, I want `/r/` sharing links and copy link output with `d`, `csf`, `web` and `e` parameters to convert, so that links copied from the Share dialogue work.

- Given a link of the form `/:w:/r/sites/SiteA/Lib/Folder/File.docx?d=w{guid}&csf=1&web=1&e={short}`, When it is converted, Then the path, folder URL and file URL are Derived, the library is Inferred, the overall state is Inferred and the four parameters do not appear in any output URL.
- Given the `d` parameter is present, When the result is inspected, Then its value is reported as an identifier labelled "document id from link" and marked Derived.
- Given a type code prefix such as `:b:`, `:x:`, `:p:`, `:v:`, `:f:`, `:u:` or `:t:`, When the result is inspected, Then the item type implied by the prefix is reported and a `:f:` prefix yields a folder result with no file component.
- Given a direct URL (BC-008) with `?web=1` or `?csf=1&web=1&e=` appended, When it is converted, Then the result is identical to the same URL without the parameters.

Priority: Must. Size: M. Depends on: BC-006, BC-009.

#### BC-011 Token bearing sharing links and guest access links

As a user, I want token based sharing links in the `/s/`, `/g/` and `/t/` variants and guest access links to be recognised and labelled Unresolved, so that I know they need authenticated validation rather than seeing a wrong path.

- Given a link of the form `/:b:/s/SiteA/{token}?e={short}`, When it is converted, Then the state is Unresolved, the message says the link is a sharing token that needs sign in to resolve, and the site name and item type from the prefix are reported as Derived hints.
- Given `/g/` and `/t/` variants of the same shape, including `/g/personal/{alias}/{token}` on a `-my` host, When they are converted, Then they are Unresolved with the variant recorded in the detected form so the two can be told apart later.
- Given a legacy `guestaccess.aspx` link carrying `docid` or `share` parameters, When it is converted, Then the state is Unresolved and the identifiers are retained in the result.
- Given any Unresolved sharing link, When the result is inspected, Then the original link is preserved unchanged for later submission to Graph (BC-038).

Priority: Must. Size: S. Depends on: BC-006.

#### BC-012 Doc.aspx links with a sourcedoc GUID

As a user, I want `Doc.aspx` and `WopiFrame.aspx` links to be recognised, so that I get the site and file name straight away and a clear statement of what is missing.

- Given a `Doc.aspx?sourcedoc={guid}&file=File.docx&action=default` link, When it is converted, Then the site path is Derived, the file name is Derived from `file`, the sourcedoc GUID is reported as an identifier, and the overall state is Unresolved with a message that the folder cannot be known without sign in.
- Given the `sourcedoc` value is wrapped in encoded braces `%7B` and `%7D`, When it is converted, Then the GUID is extracted without the braces.
- Given a `Doc.aspx` link with no `file` parameter, When it is converted, Then no file name is reported and the state remains Unresolved.

Priority: Must. Size: S. Depends on: BC-006.

#### BC-013 download.aspx and layouts pages with SourceUrl or UniqueId

As a user, I want `download.aspx` links to convert, so that a link copied from a download button still yields the folder.

- Given `_layouts/15/download.aspx?SourceUrl={enc}`, When it is converted, Then the path, folder URL and file URL are Derived, the library is Inferred, and the overall state is Inferred.
- Given `download.aspx?UniqueId={guid}`, When it is converted, Then the site path is Derived, the GUID is reported as an identifier and the state is Unresolved.
- Given any other `_layouts/15/` page carrying a `SourceUrl` parameter, When it is converted, Then it is handled identically to `download.aspx`.

Priority: Must. Size: S. Depends on: BC-006, BC-009.

#### BC-014 OneDrive for Business personal site links

As a user, I want links on `-my.sharepoint.com` hosts to convert, so that files in a colleague's OneDrive resolve like SharePoint files.

- Given `https://contoso-my.sharepoint.com/personal/{alias}/_layouts/15/onedrive.aspx?id={enc}`, When it is converted, Then the site path is `/personal/{alias}`, the path and file are Derived, the library is Inferred as `Documents`, and the overall state is Inferred.
- Given a direct `/personal/{alias}/Documents/Folder/File.xlsx` URL, When it is converted, Then the result matches the `onedrive.aspx` form for the same file.
- Given the alias, When the result is inspected, Then the owner's user principal name is offered as a Derived hint by reversing the underscore encoding, labelled as a hint because underscores in the original name make it ambiguous.
- Given a `-my` host, When the tenant is extracted, Then it is the host's first label with the `-my` suffix removed.

Priority: Must. Size: S. Depends on: BC-006, BC-009, BC-018.

#### BC-015 OneDrive consumer links

As a user, I want `onedrive.live.com` and `1drv.ms` links to be recognised, so that I get a clear Unresolved result instead of a parse failure.

- Given `https://onedrive.live.com/?cid={hex}&resid={hex}%21{n}&authkey={key}`, When it is converted, Then the state is Unresolved, the `cid` and `resid` values are reported as Derived identifiers and the message says consumer OneDrive cannot be resolved to a path in this version.
- Given a `1drv.ms` link, When it is converted by the parser alone, Then the state is Unresolved and the result flags that the link needs expansion (BC-027) before anything more can be said.
- Given a `1drv.ms` link that has been expanded by BC-027 to an `onedrive.live.com` link, When the expanded link is converted, Then the result is as in the first criterion and the original short link is recorded as a wrapper.

Priority: Should. Size: S. Depends on: BC-006.

#### BC-016 Teams deep links wrapping a file URL

As a user, I want Teams file links to be unwrapped, so that a link copied from a Teams chat converts like its underlying SharePoint URL.

- Given a `teams.microsoft.com/l/file/` link whose `objectUrl` is a percent encoded SharePoint URL, When it is converted, Then the inner URL is decoded once and parsed, the result equals the result for the inner URL, and the wrapper is recorded with `teams` as its type.
- Given `objectUrl` is absent or is not a URL, When the link is converted, Then the result is a clean failure with a reason that names the missing parameter.
- Given the inner URL is itself a sharing token form, When it is converted, Then the state is Unresolved as in BC-011 and both the wrapper and the inner form are recorded.

Priority: Must. Size: S. Depends on: BC-006, BC-011.

#### BC-017 Outlook Safe Links wrappers

As a user, I want Safe Links wrapped links to be unwrapped, so that a link pasted from an email converts like the link it protects.

- Given a `safelinks.protection.outlook.com` link with a `url` parameter, When it is converted, Then the inner URL is decoded once and parsed, the result equals the inner result and the wrapper is recorded with `safelinks` as its type.
- Given a Safe Links wrapper around a Teams deep link around a SharePoint URL, When it is converted, Then both wrappers are recorded in order and the result equals the innermost result.
- Given a Safe Links link whose `url` is truncated so that it is not a valid URL, When it is converted, Then the result is a clean failure that says the wrapped link is incomplete.

Priority: Must. Size: S. Depends on: BC-006, BC-016.

#### BC-018 Document library boundary inference

As a user, I want the split between site, library and folders to be shown as a guess where it is a guess, so that I never take an inferred library name as fact.

- Given any form where the library is not fixed by the page path (BC-008, BC-010, BC-013, BC-014), When it is converted, Then the library component is marked Inferred, the overall state is Inferred and the interface wording says the library boundary was inferred.
- Given a path whose first segment after the site is `Shared Documents` or `Documents`, When the library is inferred, Then that segment is chosen and the reason recorded is "well known library name".
- Given a path with no well known library name, When the library is inferred, Then the first segment after the site is chosen and the reason recorded is "first segment after site".
- Given the same path with the library already Derived (BC-007), When the result is inspected, Then the inference rule is not applied and the reason is "from page path".

Priority: Must. Size: M. Depends on: BC-006.

#### BC-019 Links to folders rather than files

As a user, I want a folder link to produce a folder result with no file component, so that I am not shown a made up file name.

- Given a library view link where `id` equals `parent`, When it is converted, Then no file name is reported, the folder URL equals the encoded path and the state follows the library rule in BC-007.
- Given a `:f:` sharing prefix in the `/r/` variant, When it is converted, Then the result is a folder with no file component and the state is Inferred.
- Given a folder result, When the interface renders it (BC-023), Then the file URL row is absent rather than blank.

Priority: Must. Size: XS. Depends on: BC-007, BC-010.

#### BC-020 Hosts other than sharepoint.com

As a user in a sovereign or government cloud, I want links on other Microsoft hosts to parse in best effort mode, so that the tool is not limited to the global cloud.

- Given a link on a `sharepoint.us`, `sharepoint-mil.us` or `sharepoint.cn` host in any of the offline resolvable forms, When it is converted, Then the result is identical in structure and state to the same form on `sharepoint.com`, and the cloud is recorded in the result.
- Given a link on a `-my` variant of those hosts, When it is converted, Then BC-014 behaviour applies.
- Given a host that matches none of the known suffixes but whose path has a recognised SharePoint shape, When it is converted, Then the result is produced with the state downgraded to Inferred and a note that the host is not a known Microsoft cloud.

Priority: Should. Size: S. Depends on: BC-008, BC-014.

#### BC-021 Malformed, truncated and non Microsoft links fail cleanly

As a user, I want bad input to produce a specific message, so that I know what to fix.

- Given an empty string, whitespace, or text that is not a URL, When it is converted, Then the parser returns a failure with a reason code for "not a URL" and no result state.
- Given a URL on a host that is not a recognised Microsoft host and has no recognised path shape, When it is converted, Then the failure reason is "not a Microsoft 365 link" and the host is named in the message.
- Given a recognised form whose query string is cut off mid value, When it is converted, Then the failure reason is "link appears truncated" and the message names the parameter that was incomplete.
- Given any failure, When the web application receives it, Then no history row is written unless the user has chosen to keep failures (BC-030).

Priority: Must. Size: S. Depends on: BC-006.

#### BC-022 Fixture corpus and regression harness

As a developer, I want every supported link form to have an anonymised fixture with its expected result, so that regressions are caught and new forms are added the same way every time.

- Given the parser package test suite, When it runs, Then every row of the link form matrix has at least one fixture and every fixture passes, including negative fixtures for BC-021.
- Given a new fixture file is added with an expected result, When the suite runs, Then it is picked up without registering it anywhere else.
- Given the fixture set, When the anonymisation check in section 8 runs, Then no fixture contains a real tenant name, person name, client name, sharing token or Safe Links data blob.
- Given a fixture, When its expected result is inspected, Then it states the expected confidence state and the expected per component Derived or Inferred flags.

Priority: Must. Size: S. Depends on: BC-006.

### E3 Web conversion experience

#### BC-023 Paste and convert page

As a user, I want to paste a link and see the path, folder URL, file URL and components, so that I can find the file's folder.

- Given the conversion page, When the worked example link is pasted and submitted, Then the path, folder URL and file URL shown match the expected output in the brief and the state badge reads Derived.
- Given any result, When it is rendered, Then the components (tenant, site, library, folder chain, file name) are listed, each Inferred component carries an "inferred" marker next to it, and the state badge shows exactly one of Verified, Derived, Inferred or Unresolved.
- Given a result, When the copy control next to the path, folder URL or file URL is used, Then the clipboard holds that value exactly, and the folder and file URLs are also rendered as links that open in a new tab.
- Given the input is submitted with the keyboard alone, When Enter is pressed in the input, Then conversion runs without needing the mouse.
- Given a folder result (BC-019), When it is rendered, Then no file URL row is shown.

Priority: Must. Size: M. Depends on: BC-006, BC-007, BC-024.

#### BC-024 Conversion API endpoint

As a developer, I want an HTTP endpoint that accepts a link and a source label and returns the parser result, so that the page and the extension share one path into history.

- Given a request carrying a link and a source of `web` or `extension`, When it is received, Then the response contains the parser result including its state (Verified, Derived, Inferred or Unresolved), and a history row is written (BC-030) with that source.
- Given a request with no link or a link that fails BC-021, When it is received, Then the response is a client error carrying the reason code and message and no history row is written by default.
- Given a request from the extension's origin, When the browser performs its preflight, Then the response allows the request, and requests from any other origin on the private network are also allowed because there is no access control in v1 (recorded in risk R4).
- Given the endpoint, When its request and response shapes are read from the README, Then they match what the extension (BC-045) sends and expects.

Priority: Must. Size: S. Depends on: BC-006, BC-030.

#### BC-025 Honest result labelling

As a user, I want every result to say how it was obtained and how much of it is a guess, so that I trust it exactly as much as it deserves.

- Given a Derived result, When it is rendered, Then the method text reads that the path was decoded from the link with no guesswork and no component carries an inferred marker.
- Given an Inferred result, When it is rendered, Then the method text names each inferred component and the rule used (from BC-018), for example "library boundary inferred: first segment after site".
- Given an Unresolved result, When it is rendered, Then the method text says what was recognised, what could not be decoded and that sign in would be needed, and no path is shown as if it were known.
- Given a Verified result (from M3), When it is rendered, Then the method text names the Graph lookup used and the time it was confirmed.
- Given a result that passed through wrappers (BC-016, BC-017), When it is rendered, Then the wrappers removed are listed in order.

Priority: Must. Size: S. Depends on: BC-023, BC-018.

#### BC-026 Failure and Unresolved presentation

As a user, I want failures and Unresolved results to tell me what to do next, so that I am not left with a bare error.

- Given a parse failure from BC-021, When it is rendered, Then the message states the reason in plain language and the input remains in the box for editing.
- Given an Unresolved result, When it is rendered before M3 ships, Then the next step reads that authenticated validation is not yet available in this version, and the result can still be saved to history with its Unresolved state.
- Given an Unresolved result, When it is rendered after M3 ships, Then the next step offers the sign in and validate action (BC-036).
- Given a failure, When the user chooses "keep this in history anyway", Then a row is written with the failure reason and no state, and it is filterable as a failure (BC-033).

Priority: Must. Size: S. Depends on: BC-023, BC-021.

#### BC-027 Server side short link expansion

As a user, I want `1drv.ms` short links to be expanded before parsing, so that the parser can see the real link.

- Given expansion is enabled by its environment variable and the container has outbound HTTPS, When a `1drv.ms` link is submitted, Then the server follows redirects up to a documented limit without sending cookies, passes the final URL to the parser, and the result records the short link as a wrapper.
- Given expansion is disabled or the outbound request fails or times out, When a `1drv.ms` link is submitted, Then the result is Unresolved with a message that the link could not be expanded and why, and the failure is logged.
- Given the expansion feature, When the allow list is inspected, Then only the documented short link hosts are ever fetched and a sharing token link (BC-011) is never fetched, because it would redirect to sign in.
- Given expansion succeeds, When the final host is not a recognised Microsoft host, Then the result is a clean failure naming the host.

Priority: Should. Size: M. Depends on: BC-015, BC-024, BC-005.

#### BC-028 Accessibility of the conversion and history pages

As a user relying on a keyboard or a screen reader, I want the pages to be operable and announced correctly, so that I can use the tool without a mouse.

- Given the conversion page, When it is navigated with Tab and Enter only, Then every control is reachable in a sensible order and the result region is announced when it updates.
- Given the state badge and inferred markers, When viewed by a colour vision deficiency simulator, Then the state is still distinguishable by text or shape, not colour alone.
- Given the history page, When an automated accessibility checker runs, Then no critical or serious issues are reported and text contrast meets WCAG 2.2 AA.

Priority: Should. Size: S. Depends on: BC-023, BC-031.

### E4 Conversion history

#### BC-029 Data access layer with migrations

As a developer, I want all database access behind one interface with versioned migrations, so that SQLite can be replaced later without touching the rest of the application.

- Given the application code, When it is searched for database calls, Then they all live in one data access module and no route, page or parser code references the database driver directly.
- Given an empty volume, When the application starts, Then it creates the database and applies migrations to the current version, and a second start applies nothing.
- Given the data access interface, When a test double is substituted for it, Then the API and pages run their tests without a real database file.

Priority: Must. Size: M. Depends on: BC-002, BC-005.

#### BC-030 Every conversion is persisted

As a user, I want every conversion recorded automatically, so that I never have to convert the same link twice.

- Given a successful conversion from the page or the API, When it completes, Then a row is stored with the time, the original input, the parser result including its state (Verified, Derived, Inferred or Unresolved), the per component flags, the parser version and the source.
- Given the same link is converted twice, When history is viewed, Then two rows exist, because history is a log of lookups rather than a unique index of links.
- Given a conversion is stored, When the container is rebuilt (BC-004), Then the row is unchanged.

Priority: Must. Size: M. Depends on: BC-029, BC-006.

#### BC-031 History list

As a user, I want to browse past conversions newest first, so that I can find what I looked up recently.

- Given at least one row exists, When the history page opens, Then rows are listed newest first showing time, input, path, state badge and source.
- Given more rows than one page, When the user moves to the next page, Then the next set is shown and the current page is reflected in the URL so it can be bookmarked.
- Given a row, When it is opened, Then the full result is shown in the same layout as the conversion page (BC-023) including its labelling.

Priority: Must. Size: S. Depends on: BC-030.

#### BC-032 Search across history

As a user, I want to search history by any text, so that I can find a conversion from a client name, file name or part of a link.

- Given rows exist, When a search term is entered, Then rows whose input, path, folder URL, file URL or file name contain the term are returned, case insensitively.
- Given a history of at least five thousand rows, When a search is run, Then results appear within one second on the reference host and the page remains responsive.
- Given a search that matches nothing, When it completes, Then the page says so and offers to clear the search.
- Given each matched row, When it is listed, Then its state badge is shown so Verified, Derived, Inferred and Unresolved rows can be told apart in results.

Priority: Must. Size: M. Depends on: BC-031.

#### BC-033 Filter history

As a user, I want to filter history by state, date range, host or tenant, source and failure, so that I can narrow a long list.

- Given rows with mixed states, When the state filter is set to one of Verified, Derived, Inferred or Unresolved, Then only rows in that state are shown and the count is displayed.
- Given a date range, When it is applied, Then only rows converted within the range are shown, inclusive of both ends.
- Given the source filter is set to `extension`, When applied, Then only rows submitted by the extension are shown.
- Given filters and a search term together, When applied, Then the result is the intersection and the combination is reflected in the URL.

Priority: Should. Size: S. Depends on: BC-032.

#### BC-034 Delete history entries

As a user, I want to delete one entry or a selected set, so that I can remove lookups that should not be kept.

- Given a row, When delete is chosen and confirmed, Then the row is gone from the list and from search, and a second confirmation is not required.
- Given several rows are selected, When bulk delete is confirmed, Then only those rows are removed and the count removed is shown.
- Given a delete is cancelled at the confirmation step, When the list is refreshed, Then nothing has changed.

Priority: Must. Size: S. Depends on: BC-031.

#### BC-035 Export history

As a user, I want to export the current filtered history as CSV and JSON, so that I can use it outside the tool.

- Given a filter or search is active, When export is chosen, Then only the matching rows are exported and the file name includes the date.
- Given the CSV export, When it is opened in a spreadsheet, Then one row per conversion appears with columns for time, input, path, folder URL, file URL, state, method, source and inferred components, and values containing commas or quotes are escaped correctly.
- Given the JSON export, When it is parsed, Then each entry contains the full stored result including the state and per component flags.

Priority: Should. Size: S. Depends on: BC-033.

### E5 Authenticated validation

#### BC-036 Optional Microsoft sign in with tokens held in the browser session

As a user, I want to sign in to Microsoft optionally, so that I can validate results without changing the default no sign in experience.

- Given no sign in has happened, When the conversion page is used, Then everything in E3 works unchanged and the sign in control is the only visible difference.
- Given the sign in control is used, When the Microsoft sign in completes against the configured test tenant, Then the page shows the signed in account and the token is held only in the browser session, is not sent to the server and is gone when the browser session ends.
- Given the tenant and client identifiers are supplied by environment variables (BC-005), When they are absent, Then the sign in control is hidden and a log line says validation is not configured.
- Given a signed in user, When they sign out, Then the session token is discarded and validation controls are hidden again.

Priority: Must. Size: M. Depends on: BC-023, BC-005.

#### BC-037 Validate a best effort result and correct the library boundary

As a signed in user, I want a Derived or Inferred result confirmed against Graph, so that the library split and path are facts rather than guesses.

- Given a Derived or Inferred result on the global cloud, When validate is chosen, Then the site is resolved by path, the site's drives are listed, the library boundary is set from the drive whose URL prefixes the path, the item is fetched by path within that drive, and the result becomes Verified with every component marked as confirmed.
- Given the Inferred library differs from the drive Graph returns, When validation completes, Then the corrected library and folder chain replace the inferred ones in the displayed result and the original inferred values are shown beneath as "was inferred as".
- Given the item is not found by Graph, When validation completes, Then the result keeps its previous state (Derived or Inferred), and a message says Graph could not find the item at that path.
- Given a link with a `d` identifier (BC-010), When validation completes, Then the identifier is compared with the item's list item unique id and any mismatch is shown.

Priority: Must. Size: L. Depends on: BC-036, BC-018, BC-040.

#### BC-038 Resolve sharing tokens through the shares endpoint

As a signed in user, I want token based sharing links resolved, so that Unresolved links become real paths.

- Given an Unresolved sharing link from BC-011, When validate is chosen, Then the full link is encoded as `u!` plus base64url and submitted to the Graph shares endpoint, and a successful driveItem response yields a Verified result with the path, folder URL, file URL and components taken from the returned item.
- Given Graph answers with a permission error, When validation completes, Then the result stays Unresolved and the message names the missing permission or consent (BC-041).
- Given the link is a `/g/` or `/t/` variant, When it is resolved, Then the behaviour is the same and the variant is recorded, so that spike S3 findings can be checked against real results.

Priority: Must. Size: M. Depends on: BC-036, BC-011, BC-040.

#### BC-039 Resolve sourcedoc and UniqueId GUIDs

As a signed in user, I want `Doc.aspx` and `UniqueId` links resolved, so that a document GUID becomes a folder.

- Given an Unresolved result from BC-012 or BC-013 carrying a GUID, When validate is chosen, Then the item is looked up by the method proven in spike S5 and the result becomes Verified.
- Given the lookup method from S5 returns nothing, When validation completes, Then the result stays Unresolved with a message that the document id could not be resolved in this site.

Priority: Should. Size: M. Depends on: BC-036, BC-012, BC-040. Blocked by spike S5.

#### BC-040 Record validation upgrades in history

As a user, I want to see which stored results were upgraded by validation, so that I can tell verified facts from earlier guesses.

- Given a stored row in the Derived, Inferred or Unresolved state, When it is validated, Then the row records the Verified result, the time and the Graph item identifier while retaining the original result, and the list shows an "upgraded" marker with the previous state.
- Given the history filter (BC-033), When "upgraded" is chosen, Then only rows that moved from Inferred or Unresolved to Verified are listed.
- Given a row that was Verified from the start, When it is listed, Then it carries no "upgraded" marker.

Priority: Must. Size: M. Depends on: BC-030, BC-036.

#### BC-041 Graph failures are reported honestly

As a signed in user, I want Graph errors shown plainly, so that I know whether to retry, ask for consent or give up.

- Given Graph returns a consent or permission error, When it is rendered, Then the message names the permission and says an administrator may need to grant consent, and the result state is unchanged.
- Given Graph returns a throttling response, When it is rendered, Then the message says to retry later and the retry control honours the wait Graph asked for.
- Given the token has expired, When validate is chosen, Then the user is prompted to sign in again and the result state is unchanged.

Priority: Must. Size: S. Depends on: BC-036.

### E6 Copilot extension

#### BC-042 Manifest V3 extension scaffold consuming the shared parser

As a developer, I want a Manifest V3 extension with a popup, a content script and a service worker that imports the parser package, so that the extension shares parsing with the web application.

- Given the manifest, When it is inspected, Then it declares host permissions for `m365.cloud.microsoft`, `copilot.cloud.microsoft` and `copilot.microsoft.com` and nothing broader.
- Given the extension is loaded unpacked in Chrome and Edge, When any of the three hosts is opened, Then the content script loads without console errors and the popup opens.
- Given the extension bundle, When it is inspected, Then the parser comes from the shared package (BC-001) and running the fixture corpus (BC-022) inside the extension test harness produces identical results to the server.

Priority: Must. Size: M. Depends on: BC-001, BC-006, BC-022.

#### BC-043 Citation extraction on the work surfaces

As a user, I want file citations in a Copilot response extracted, so that I do not have to copy each link by hand.

- Given a Copilot response on `m365.cloud.microsoft` or `copilot.cloud.microsoft` that cites SharePoint or OneDrive files, When the popup opens, Then every cited file link is collected once, using the selectors proven in spike S1, including citations inside shadow roots if S1 finds them there.
- Given a response that cites the same file twice, When extracted, Then it appears once.
- Given the page markup does not match the expected shape, When extraction runs, Then the popup says no citations were found and offers a "report markup" action that copies a redacted sample of the response container for diagnosis, and no exception reaches the console.
- Given each extracted link, When it is passed through the parser, Then it carries a state of Derived, Inferred or Unresolved before anything is shown.

Priority: Must. Size: L. Depends on: BC-042. Blocked by spike S1.

#### BC-044 Popup lists files and folders with states

As a user, I want the popup to list each cited file with its folder and confidence, so that I can see where things live before submitting.

- Given extracted citations, When the popup renders, Then each row shows the file name, the folder path, the state badge (Derived, Inferred or Unresolved) and an inferred marker where the library was guessed.
- Given an Unresolved citation, When it is listed, Then the row says it needs validation in the web application and can still be selected for submission.
- Given no citations, When the popup renders on a work host, Then it shows the "no citations found" state from BC-043.

Priority: Must. Size: M. Depends on: BC-043.

#### BC-045 Select and submit to the API

As a user, I want to tick items and send them to BreadCrumb with one click, so that the folders are kept in history.

- Given the API base URL is set on the options page, When selected items are submitted, Then each is sent to the conversion endpoint (BC-024) with source `extension`, and each row shows success or the failure message returned.
- Given the API base URL is not set, When submit is chosen, Then the popup explains where to set it and nothing is sent.
- Given the API is unreachable, When submit is chosen, Then every selected row shows a reachability error naming the base URL and the popup suggests checking the network, following the findings of spike S6.
- Given items were submitted, When the history page is opened, Then they appear with source `extension` and the same state the popup showed.

Priority: Must. Size: M. Depends on: BC-044, BC-024.

#### BC-046 Consumer surface empty state

As a user on `copilot.microsoft.com`, I want the popup to explain that this surface cites web pages, so that it does not look broken.

- Given the popup opens on `copilot.microsoft.com`, When the page has a response citing web pages, Then the popup shows a defined empty state saying SharePoint and OneDrive citations appear only on the work surfaces, and no extraction error is shown.
- Given a response on the consumer host that happens to contain a SharePoint URL in its text, When the popup opens, Then that URL is offered like a work host citation, so the empty state appears only when nothing parseable is present.
- Given the empty state, When rendered, Then it links to the web application so the user can paste a link by hand.

Priority: Must. Size: S. Depends on: BC-042, BC-043.

### E7 Operability

#### BC-047 Health endpoint and structured logs

As the person running BreadCrumb, I want a health endpoint and readable logs, so that Portainer and I can see the container is working.

- Given the container is running, When the health endpoint is requested, Then it returns success only if the database file on the volume is readable and writable.
- Given a request is handled, When the log is read, Then one structured line per request shows time, route, outcome, duration and, for conversions, the detected form and state, and never the full link when the environment variable for redacted logging is set.
- Given the compose file, When it is inspected, Then the container health check uses this endpoint.

Priority: Should. Size: XS. Depends on: BC-002, BC-029.

#### BC-048 Backup and restore of the database

As the person running BreadCrumb, I want a documented and tested way to back up and restore the database file, so that history can be recovered after a failure.

- Given the application is running, When the documented backup command is run, Then a consistent copy of the database is produced without stopping the container, and opening the copy shows the same row count.
- Given a backup copy, When the documented restore steps are followed on a fresh volume, Then the application starts and history matches the backup.
- Given the README, When it is read, Then it states where the file lives on the volume, that write ahead log companion files must be included if present, and how to verify a restore.

Priority: Must. Size: S. Depends on: BC-004, BC-029.

---

## 6. Release plan

Progress is reported only at the boundaries below. Each milestone is done when its demonstrable outcome has been shown from a deployed stack, not from a developer machine.

### M1 Walking skeleton

Stories: BC-001, BC-002, BC-003, BC-004, BC-005, BC-006, BC-007, BC-009, BC-023, BC-024, BC-029, BC-030, BC-031, BC-047.

Demonstrable outcome: the repository is a TypeScript monorepo with the compose file at its root. The same compose file is deployed as a Portainer Git stack and runs under `docker compose up` locally (BC-003). The worked example link converts end to end on the deployed stack with a Derived state and appears in the history list. A conversion written before the image is rebuilt and the stack redeployed is still present afterwards, on a named volume separate from the container filesystem (BC-004).

Deliberately excluded: every link form other than the library view form, confidence labelling beyond the single state badge, search, filters, delete, export, short link expansion, sign in, the extension, backup documentation. The health endpoint (BC-047) is included only because the compose health check needs it. No story depends on Graph, sign in or tenant consent.

Progress evidence at the boundary: a screen recording or screenshots of the Portainer stack, the conversion, the rebuild and the surviving history row.

### M2 Breadth and history

Stories: BC-008, BC-010, BC-011, BC-012, BC-013, BC-014, BC-015, BC-016, BC-017, BC-018, BC-019, BC-020, BC-021, BC-022, BC-025, BC-026, BC-027, BC-028, BC-032, BC-033, BC-034, BC-035, BC-048.

Demonstrable outcome: every row of the link form matrix converts in best effort mode with the confidence state and per component inferred markers the matrix predicts, or fails with the message it predicts. The fixture corpus covers every row. History is searchable and filterable at five thousand rows, entries can be deleted singly and in bulk, and the filtered set exports as CSV and JSON. Backup and restore have been rehearsed once.

Deliberately excluded: anything Verified. Sign in, Graph calls and tenant consent are absent. The extension is absent. Spikes S1, S2 and S5 may run during M2 but nothing in M2 depends on them.

Progress evidence at the boundary: the fixture corpus report showing one pass per matrix row, and an export file from the deployed stack.

### M3 Authenticated validation

Stories: BC-036, BC-037, BC-038, BC-039, BC-040, BC-041.

Demonstrable outcome: a user signs in against the personal test tenant, validates an Inferred result whose library boundary was guessed wrongly, sees it corrected and upgraded to Verified, and sees the "was inferred as" record beneath it. An Unresolved sharing token resolves to a Verified path. The history list shows which rows were upgraded. Signing out removes the token and the default no sign in path is unchanged.

Deliberately excluded: production tenant consent, server side token storage, consumer OneDrive validation, sovereign cloud Graph endpoints, automatic re-validation of old rows. BC-039 ships only if spike S5 closes with a working method.

Progress evidence at the boundary: a recorded validation of three fixtures against the test tenant, one each from the Inferred and Unresolved states plus one Derived, with before and after states.

### M4 Extension

Stories: BC-042, BC-043, BC-044, BC-045, BC-046.

Demonstrable outcome: on `m365.cloud.microsoft` and `copilot.cloud.microsoft`, a Copilot response citing SharePoint and OneDrive files is opened, the popup lists the files with their folders and states, selected items are submitted and appear in history with source `extension`. On `copilot.microsoft.com` the popup shows the defined empty state.

Deliberately excluded: store publication, Firefox and Safari, Copilot panes inside Office and Teams, validation from inside the popup, automatic submission without selection.

Progress evidence at the boundary: a recording on each of the three hosts, and the history rows produced.

---

## 7. Spikes

Each spike is timeboxed. If the timebox ends without the closing evidence, the dependent stories are re-planned rather than the spike extended.

| ID | Question | Timebox | Closing evidence | Blocks |
|---|---|---|---|---|
| S1 | What markup carries file citations in Copilot responses on `m365.cloud.microsoft` and `copilot.cloud.microsoft`, is it in the light DOM or inside shadow roots, which attribute holds the file URL, and what does the consumer host `copilot.microsoft.com` emit for web citations? | 2 days | An annotated DOM capture per host for a SharePoint file citation, a OneDrive file citation and a web citation, a note on shadow root depth, a list of stable attributes or roles to select on, and a redacted copy of each capture added to the extension test fixtures. | BC-043, BC-044, BC-046 |
| S2 | Does the Graph shares endpoint with a `u!` base64url encoded link return a driveItem for `/s/`, `/g/` and `/t/` tokens and for `-my` host tokens, what is the minimum delegated permission, does it work for a token created by another user, does the legacy `guestaccess.aspx` form resolve, and does a personal site resolve by path? | 1 day | A table of link variant against result and HTTP status from the test tenant, with the exact permission set that succeeded and the smallest set that failed. Removes the [unverified] markers in matrix rows 3b, 3c, 3d, 6 and 8. | BC-038, BC-037 (personal site case) |
| S3 | Which link forms does a modern tenant actually emit from its own copy link and share controls today: the SharePoint library "Copy link" for each audience option, OneDrive web, the Office desktop share dialogue, the Teams files tab, an Outlook attachment link, and a Copilot citation? Do `RootFolder`, `guestaccess.aspx` and the Safe Links `/ap/` variant still appear? What do `/g/` and `/t/` mean? | 1 day | One anonymised fixture per control and audience option added to the corpus (BC-022), and a note against each matrix row saying "emitted today", "legacy but seen" or "not observed". Removes the [unverified] markers in rows 1b, 3c, 3d, 8 and 10. | BC-022 completeness. Nothing in M1 or M2 is blocked. |
| S4 | Which SQLite access approach fits the container: a native module driver that needs build tooling or prebuilt binaries in the image, the Node built in SQLite module whose stability by Node version is [unverified], or a WebAssembly build? What does each do to image size, build time, write ahead logging and online backup? | 1 day | Three throwaway images with recorded build time, image size, whether the build needed a compiler stage, and a pass or fail on a write ahead log and online backup check. Feeds decision D2. | BC-029, BC-048, D2 |
| S5 | How is a list item unique id from `sourcedoc` or `UniqueId` resolved to a driveItem through Graph, if at all? | Half a day | A working call sequence against the test tenant, or a written conclusion that Graph cannot do it and the form stays Unresolved in v1. | BC-039 |
| S6 | Can a Manifest V3 extension on an `https` Copilot page submit to an `http` API on a private network address from another machine? Which of the popup, service worker and content script may make the call, does Chrome's private network access restriction or mixed content blocking interfere, and what CORS headers does the API need? | 1 day | A test extension reaching a stub API from a second machine on the private network, in both Chrome and Edge, with a record of what was blocked and which context succeeded. Feeds decision D6. | BC-045, D6 |
| S7 | How does a Portainer Git stack behave in practice: how are environment variables supplied, does "pull and redeploy" preserve named volumes, does removing the stack remove volumes, and does a private repository need stored credentials? Some of this is [unverified] from documentation alone. | Half a day | A runbook of the exact clicks, and a redeploy and a removal each followed by a check of the volume. | BC-003, BC-004 |
| S8 | Does `1drv.ms` redirect to a parseable URL when fetched from a container without cookies, how many hops, and does the target vary by link type? | Half a day | A table of five short links against final URL and hop count, and the allow list of hosts contacted. | BC-027 |

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
| Browser support | Web application: current stable Chrome and Edge, plus current Firefox and Safari for the web pages only. Extension: current stable Chrome and Edge. |
| Accessibility | WCAG 2.2 AA for contrast and keyboard operation, state never conveyed by colour alone (BC-028). |
| Network posture | The application listens on one port and makes no outbound requests except short link expansion when enabled, and Graph calls are made from the browser, not the server. |
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
| R7 | Extension installation is blocked by browser policy on managed devices. | Medium | Medium | Confirm with the device administrator whether unpacked or policy pushed extensions are allowed before M4 starts. The web application works without the extension. | Product owner |
| R8 | SQLite limits bite if the tool spreads to a team: concurrent writes, a single file, no network access to the database. | Low | Medium | The data access layer (BC-029) isolates the engine. Write ahead logging for concurrency. Watch row counts and error rates. Moving engine is a planned later change, not a v1 requirement. | Developer |
| R9 | The library boundary heuristic is wrong often enough that Inferred results mislead. | Medium | Medium | Always label Inferred. Measure the hit rate against Graph during M3 and refine the rules in BC-018 from real data. | Parser owner |
| R10 | Short link expansion needs outbound access the host does not have, or Microsoft changes redirect behaviour. | Medium | Low | Feature is optional and off when unavailable. Spike S8. Links stay Unresolved with a reason. | Developer |
| R11 | A native SQLite module fails to build in the container image or breaks on a Node upgrade. | Medium | Medium | Spike S4 and decision D2. Pin the Node version. | Developer |
| R12 | The Verified state is asserted by the browser, since Graph calls happen there, so a modified client could store a false Verified row. | Low | Low | Acceptable on a private network without access control. Record the Graph item id with every Verified row so it can be re-checked. Revisit with D3 and D4. | Product owner |

---

## 11. Open decisions

| ID | Decision needed | Options | What it blocks | Who decides |
|---|---|---|---|---|
| D1 | Web framework and whether to use an ORM or a query builder for the data access layer. | A minimal HTTP framework with hand written queries; a fuller framework with an ORM; a query builder with migrations but no ORM. The choice must not leak past the data access layer. | BC-002, BC-024, BC-029 | Repository owner |
| D2 | SQLite driver approach. | Native module with prebuilt binaries; native module built in a compiler stage; the Node built in SQLite module [unverified stability]; a WebAssembly build. Decided from the S4 evidence. | BC-029, BC-048, image size requirement | Repository owner, after S4 |
| D3 | Where Graph tokens live. | Default for v1: held in the browser session only, Graph called from the browser, server receives results (BC-036). Alternative, not chosen: token sent per request to the server, which calls Graph and does not persist the token. Second alternative: server side persistence, which needs access control first. | BC-036, BC-037, BC-038 | Product owner. Default stands unless changed before M3. |
| D4 | When application level access control is introduced. | Not in v1 (locked); before the first deployment outside the private network; when a second team starts using it; when tokens move server side. | Any hosting change, D3 alternatives, R4 and R5 | Product owner |
| D5 | History search implementation. | Substring matching in the data access layer; SQLite full text search. Decided against the five thousand row measurement in BC-032. | BC-032 | Developer |
| D6 | Whether the API is served over TLS on the private network and, if so, how certificates are issued. | Plain HTTP; TLS with a private certificate authority trusted on client devices; TLS terminated by a reverse proxy outside this stack. Decided from S6. | BC-045 | Operations owner, after S6 |
| D7 | How the extension is distributed. | Unpacked developer mode; enterprise policy from a private update URL; browser store. | BC-042 rollout, R7 | Product owner |
| D8 | Whether failed conversions are kept in history by default. | Never kept; kept only when the user opts in (assumed in BC-026); always kept. | BC-026, BC-033 | Product owner |

---

## 12. Explicitly out of scope for v1

- Any application level authentication, authorisation or user accounts. Locked decision, revisited under D4.
- Server side storage of Graph tokens or any background Graph access without a user present.
- Authenticated validation for OneDrive consumer accounts or for sovereign and government clouds. Those links parse in best effort mode only.
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
17. The extension declares host permissions for the three named Copilot hosts and nothing broader.
18. The consumer Copilot host shows a defined empty state, never an error.
19. History is a log of lookups. Rows are appended and deleted, never silently edited.
20. New stories should improve one or more stages of: paste a link, get the folder path, keep the result.
