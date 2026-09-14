# BreadCrumb completed backlog

Stories and spikes are moved here verbatim from `BACKLOG.md` once their acceptance criteria genuinely pass or their closing evidence exists. Each entry keeps its ID and gains a `**Completed:** <YYYY-MM-DD> · <commit SHA>` line. IDs are never reused. `BACKLOG.md` only ever contains open work.

## Completed

### Spike S4: SQLite access approach

| ID | Question | Timebox | Closing evidence | Blocks |
|---|---|---|---|---|
| S4 | Which SQLite access approach fits the container: a native module driver that needs build tooling or prebuilt binaries in the image, the Node built in SQLite module whose stability by Node version is [unverified], or a WebAssembly build? What does each do to image size, build time, write ahead logging and online backup? | 1 day | Three throwaway images with recorded build time, image size, whether the build needed a compiler stage, and a pass or fail on a write ahead log and online backup check. Feeds decision D2. | BC-029, BC-048, D2 |

**Finding:** `node:sqlite` inside the unmodified `node:24-alpine` image (Node 24.21.0, SQLite 3.53.4) enables write ahead logging and takes an online backup through `backup(db, dest)` with no compiler stage and no flag; base image 56 MB. Only the built in module was tried because it met every requirement. Decision D2 closed as `node:sqlite`. Evidence: `docs/spikes/S4-sqlite.md`.

**Completed:** 2026-09-10 · 9c06c95

#### BC-001 TypeScript monorepo scaffold

As a developer, I want a single repository with separate packages for the parser, the web application and the extension, so that the parser is implemented once and consumed by both.

- Given a fresh clone, When the install and build commands documented in the README are run, Then all three packages build without error and the web application and the extension both resolve the parser as a workspace dependency rather than a copy.
- Given a change to the parser package, When the build runs, Then both consumers pick up the change without a manual publish step.
- Given the repository root, When a reviewer inspects it, Then there is exactly one implementation of link parsing and a search of the repository finds no second copy in either consumer.

Priority: Must. Size: S. Depends on: none.

**Completed:** 2026-09-10 · 5b806e1

#### BC-005 Configuration through environment variables only

As the person running BreadCrumb, I want every setting supplied as an environment variable with a documented default, so that no configuration or secret is committed to the repository.

- Given the repository, When it is searched for secrets, keys or tenant identifiers, Then none are found and the README lists every variable, its default and whether it is required.
- Given a required variable is missing or malformed, When the application starts, Then it exits with a message naming the variable and does not start half configured.
- Given an optional variable is not set, When the application starts, Then it logs the default in use.

Priority: Must. Size: S. Depends on: BC-001.

**Completed:** 2026-09-10 · 5b806e1

#### BC-006 Parser package with a stable public contract

As a developer, I want the parser to be a pure package with one entry point that takes a string and returns a structured result, so that the web application and the extension consume identical behaviour.

- Given any input string, When the parser is called, Then it returns a result carrying exactly one of the states Verified, Derived, Inferred or Unresolved, or a clean failure with a reason code, and never throws for string input.
- Given the package, When its dependency list is inspected, Then it has no dependency on Node built in modules, the DOM or any network client, so it can run unchanged in a browser extension and on the server.
- Given a result, When it is inspected, Then it contains the server relative path, folder URL, file URL where applicable, the components (tenant, host, site path, library, folder chain, file name), a per component flag showing whether that component is Derived or Inferred, the method used, the detected form, and any wrappers that were removed.
- Given the parser's version, When any output changes, Then the package version changes so that history rows can record which parser produced them.

Priority: Must. Size: M. Depends on: BC-001.

**Completed:** 2026-09-10 · 5b806e1

#### BC-007 Library view links with id and parent

As a user, I want to paste a library view link (AllItems.aspx) and get the file's path and folder, so that I can find the file in its library.

- Given the worked example link from the brief, When it is converted, Then the path, folder URL and file URL match the expected output exactly, and the result state is Derived.
- Given a library view link whose `id` path begins with the library segment preceding `/Forms/`, When it is converted, Then the library component is marked Derived, the tenant is `848` style first host label, the site path is `/sites/848Technical`, the folder chain lists each folder in order and the file name is the last segment.
- Given a library view link whose `id` path does not begin with the library taken from the page path, When it is converted, Then the library component is marked Inferred and the overall state is Inferred.
- Given a library view link with `id` only and no `parent`, When it is converted, Then the folder is the parent of `id` and the state is unchanged.
- Given a classic view link carrying `RootFolder` instead of `id`, When it is converted, Then the folder is decoded from `RootFolder`, no file component is reported and the state is Derived or Inferred by the same library rule.

Priority: Must. Size: M. Depends on: BC-006, BC-009.

**Completed:** 2026-09-10 · 5b806e1

#### BC-009 Percent encoding fidelity

As a user, I want decoded paths to show real characters and rebuilt URLs to be encoded exactly once, so that output links open and paths read naturally.

- Given an input containing `%20`, `%2D` and `%2E`, When it is converted, Then the path shows a space, a hyphen and a full stop respectively.
- Given a decoded path containing spaces, hyphens, full stops, ampersands, hash signs, plus signs and literal percent signs, When the folder and file URLs are rebuilt, Then spaces become `%20`, hyphens and full stops stay literal, ampersands, hash signs, plus signs and percent signs are encoded, and no existing `%20` is turned into `%2520`.
- Given the worked example, When its output URLs are compared with the expected output in the brief, Then they match character for character.
- Given an input with mixed case hex such as `%2d`, When it is converted, Then it decodes identically to `%2D`.

Priority: Must. Size: S. Depends on: BC-006.

**Completed:** 2026-09-10 · 5b806e1

#### BC-024 Conversion API endpoint

As a developer, I want an HTTP endpoint that accepts a link and a source label and returns the parser result, so that the page and the extension share one path into history.

- Given a request carrying a link and a source of `web` or `extension`, When it is received, Then the response contains the parser result including its state (Verified, Derived, Inferred or Unresolved), and a history row is written (BC-030) with that source.
- Given a request with no link or a link that fails BC-021, When it is received, Then the response is a client error carrying the reason code and message and no history row is written by default.
- Given a request from the extension's origin, When the browser performs its preflight, Then the response allows the request, and requests from any other origin on the private network are also allowed because there is no access control in v1 (recorded in risk R4).
- Given the endpoint, When its request and response shapes are read from the README, Then they match what the extension (BC-045) sends and expects.

Priority: Must. Size: S. Depends on: BC-006, BC-030.

**Completed:** 2026-09-10 · 5b806e1

#### BC-029 Data access layer with migrations

As a developer, I want all database access behind one interface with versioned migrations, so that SQLite can be replaced later without touching the rest of the application.

- Given the application code, When it is searched for database calls, Then they all live in one data access module and no route, page or parser code references the database driver directly.
- Given an empty volume, When the application starts, Then it creates the database and applies migrations to the current version, and a second start applies nothing.
- Given the data access interface, When a test double is substituted for it, Then the API and pages run their tests without a real database file.

Priority: Must. Size: M. Depends on: BC-002, BC-005.

**Completed:** 2026-09-10 · 5b806e1

#### BC-030 Every conversion is persisted

As a user, I want every conversion recorded automatically, so that I never have to convert the same link twice.

- Given a successful conversion from the page or the API, When it completes, Then a row is stored with the time, the original input, the parser result including its state (Verified, Derived, Inferred or Unresolved), the per component flags, the parser version and the source.
- Given the same link is converted twice, When history is viewed, Then two rows exist, because history is a log of lookups rather than a unique index of links.
- Given a conversion is stored, When the container is rebuilt (BC-004), Then the row is unchanged.

Priority: Must. Size: M. Depends on: BC-029, BC-006.

**Completed:** 2026-09-10 · 5b806e1

#### BC-031 History list

As a user, I want to browse past conversions newest first, so that I can find what I looked up recently.

- Given at least one row exists, When the history page opens, Then rows are listed newest first showing time, input, path, state badge and source.
- Given more rows than one page, When the user moves to the next page, Then the next set is shown and the current page is reflected in the URL so it can be bookmarked.
- Given a row, When it is opened, Then the full result is shown in the same layout as the conversion page (BC-023) including its labelling.

Priority: Must. Size: S. Depends on: BC-030.

**Completed:** 2026-09-10 · 5b806e1

#### BC-047 Health endpoint and structured logs

As the person running BreadCrumb, I want a health endpoint and readable logs, so that Portainer and I can see the container is working.

- Given the container is running, When the health endpoint is requested, Then it returns success only if the database file on the volume is readable and writable.
- Given a request is handled, When the log is read, Then one structured line per request shows time, route, outcome, duration and, for conversions, the detected form and state, and never the full link when the environment variable for redacted logging is set.
- Given the compose file, When it is inspected, Then the container health check uses this endpoint.

Priority: Should. Size: XS. Depends on: BC-002, BC-029.

**Completed:** 2026-09-10 · 5b806e1

#### BC-002 Compose file at the repository root runs locally

As the person running BreadCrumb, I want a compose file at the repository root that builds and starts the application with one command, so that local runs and deployments share one definition.

- Given a machine with Docker and Docker Compose and a checked out repository, When `docker compose up` is run from the root, Then the image builds, the container starts and the web application answers on the configured port.
- Given the container is running, When the health endpoint (BC-047) is requested, Then it returns a success response.
- Given no environment file is present, When the stack starts, Then it runs with the documented defaults and prints which settings are in use, without failing.

Priority: Must. Size: S. Depends on: BC-001.

**Completed:** 2026-09-10 · 923d7b4

#### BC-004 SQLite on a dedicated named volume survives a container rebuild

As the person running BreadCrumb, I want the database to live on a named Docker volume separate from the container filesystem, so that history survives rebuilds and redeploys.

- Given the compose file, When it is inspected, Then the database path is on a named volume declared in the file and is not a bind mount and not a path inside the image layers.
- Given one conversion has been recorded, When the container is stopped, its image rebuilt with a code change and the stack started again, Then the conversion is still present in the history list with the same timestamp and values.
- Given the stack is removed with the command that removes containers but not volumes, When the stack is started again, Then the database and its history are intact.
- Given the named volume, When it is inspected with the Docker CLI, Then it exists independently of any container and contains the database file.

Priority: Must. Size: M. Depends on: BC-002, BC-030.

**Completed:** 2026-09-10 · 923d7b4

#### BC-008 Direct server relative file and folder URLs

As a user, I want to paste a plain SharePoint URL to a file or folder and get its components, so that I get the same breakdown as for view links.

- Given a direct file URL under a site, When it is converted, Then the path, folder URL and file URL are returned, the path and file are Derived and the library component is Inferred, so the overall state is Inferred.
- Given a direct URL with no file extension on the last segment and a trailing slash, When it is converted, Then it is treated as a folder with no file component.
- Given a direct URL on the root site with no `/sites/` or `/teams/` prefix, When it is converted, Then the site path is empty and the first segment is offered as the Inferred library.

Priority: Must. Size: S. Depends on: BC-006, BC-009, BC-018.

**Completed:** 2026-09-10 · 35734f6

#### BC-010 Path bearing sharing links and copy link parameters

As a user, I want `/r/` sharing links and copy link output with `d`, `csf`, `web` and `e` parameters to convert, so that links copied from the Share dialogue work.

- Given a link of the form `/:w:/r/sites/SiteA/Lib/Folder/File.docx?d=w{guid}&csf=1&web=1&e={short}`, When it is converted, Then the path, folder URL and file URL are Derived, the library is Inferred, the overall state is Inferred and the four parameters do not appear in any output URL.
- Given the `d` parameter is present, When the result is inspected, Then its value is reported as an identifier labelled "document id from link" and marked Derived.
- Given a type code prefix such as `:b:`, `:x:`, `:p:`, `:v:`, `:f:`, `:u:` or `:t:`, When the result is inspected, Then the item type implied by the prefix is reported and a `:f:` prefix yields a folder result with no file component.
- Given a direct URL (BC-008) with `?web=1` or `?csf=1&web=1&e=` appended, When it is converted, Then the result is identical to the same URL without the parameters.

Priority: Must. Size: M. Depends on: BC-006, BC-009.

**Completed:** 2026-09-10 · 35734f6

#### BC-011 Token bearing sharing links and guest access links

As a user, I want token based sharing links in the `/s/`, `/g/` and `/t/` variants and guest access links to be recognised and labelled Unresolved, so that I know they need authenticated validation rather than seeing a wrong path.

- Given a link of the form `/:b:/s/SiteA/{token}?e={short}`, When it is converted, Then the state is Unresolved, the message says the link is a sharing token that needs sign in to resolve, and the site name and item type from the prefix are reported as Derived hints.
- Given `/g/` and `/t/` variants of the same shape, including `/g/personal/{alias}/{token}` on a `-my` host, When they are converted, Then they are Unresolved with the variant recorded in the detected form so the two can be told apart later.
- Given a legacy `guestaccess.aspx` link carrying `docid` or `share` parameters, When it is converted, Then the state is Unresolved and the identifiers are retained in the result.
- Given any Unresolved sharing link, When the result is inspected, Then the original link is preserved unchanged for later submission to Graph (BC-038).

Priority: Must. Size: S. Depends on: BC-006.

**Completed:** 2026-09-10 · 35734f6

#### BC-012 Doc.aspx links with a sourcedoc GUID

As a user, I want `Doc.aspx` and `WopiFrame.aspx` links to be recognised, so that I get the site and file name straight away and a clear statement of what is missing.

- Given a `Doc.aspx?sourcedoc={guid}&file=File.docx&action=default` link, When it is converted, Then the site path is Derived, the file name is Derived from `file`, the sourcedoc GUID is reported as an identifier, and the overall state is Unresolved with a message that the folder cannot be known without sign in.
- Given the `sourcedoc` value is wrapped in encoded braces `%7B` and `%7D`, When it is converted, Then the GUID is extracted without the braces.
- Given a `Doc.aspx` link with no `file` parameter, When it is converted, Then no file name is reported and the state remains Unresolved.

Priority: Must. Size: S. Depends on: BC-006.

**Completed:** 2026-09-10 · 35734f6

#### BC-013 download.aspx and layouts pages with SourceUrl or UniqueId

As a user, I want `download.aspx` links to convert, so that a link copied from a download button still yields the folder.

- Given `_layouts/15/download.aspx?SourceUrl={enc}`, When it is converted, Then the path, folder URL and file URL are Derived, the library is Inferred, and the overall state is Inferred.
- Given `download.aspx?UniqueId={guid}`, When it is converted, Then the site path is Derived, the GUID is reported as an identifier and the state is Unresolved.
- Given any other `_layouts/15/` page carrying a `SourceUrl` parameter, When it is converted, Then it is handled identically to `download.aspx`.

Priority: Must. Size: S. Depends on: BC-006, BC-009.

**Completed:** 2026-09-10 · 35734f6

#### BC-014 OneDrive for Business personal site links

As a user, I want links on `-my.sharepoint.com` hosts to convert, so that files in a colleague's OneDrive resolve like SharePoint files.

- Given `https://contoso-my.sharepoint.com/personal/{alias}/_layouts/15/onedrive.aspx?id={enc}`, When it is converted, Then the site path is `/personal/{alias}`, the path and file are Derived, the library is Inferred as `Documents`, and the overall state is Inferred.
- Given a direct `/personal/{alias}/Documents/Folder/File.xlsx` URL, When it is converted, Then the result matches the `onedrive.aspx` form for the same file.
- Given the alias, When the result is inspected, Then the owner's user principal name is offered as a Derived hint by reversing the underscore encoding, labelled as a hint because underscores in the original name make it ambiguous.
- Given a `-my` host, When the tenant is extracted, Then it is the host's first label with the `-my` suffix removed.

Priority: Must. Size: S. Depends on: BC-006, BC-009, BC-018.

**Completed:** 2026-09-10 · 35734f6

#### BC-015 OneDrive consumer links

As a user, I want `onedrive.live.com` and `1drv.ms` links to be recognised, so that I get a clear Unresolved result instead of a parse failure.

- Given `https://onedrive.live.com/?cid={hex}&resid={hex}%21{n}&authkey={key}`, When it is converted, Then the state is Unresolved, the `cid` and `resid` values are reported as Derived identifiers and the message says consumer OneDrive cannot be resolved to a path in this version.
- Given a `1drv.ms` link, When it is converted by the parser alone, Then the state is Unresolved and the result flags that the link needs expansion (BC-027) before anything more can be said.
- Given a `1drv.ms` link that has been expanded by BC-027 to an `onedrive.live.com` link, When the expanded link is converted, Then the result is as in the first criterion and the original short link is recorded as a wrapper.

Priority: Should. Size: S. Depends on: BC-006.

**Completed:** 2026-09-10 · 35734f6

#### BC-016 Teams deep links wrapping a file URL

As a user, I want Teams file links to be unwrapped, so that a link copied from a Teams chat converts like its underlying SharePoint URL.

- Given a `teams.microsoft.com/l/file/` link whose `objectUrl` is a percent encoded SharePoint URL, When it is converted, Then the inner URL is decoded once and parsed, the result equals the result for the inner URL, and the wrapper is recorded with `teams` as its type.
- Given `objectUrl` is absent or is not a URL, When the link is converted, Then the result is a clean failure with a reason that names the missing parameter.
- Given the inner URL is itself a sharing token form, When it is converted, Then the state is Unresolved as in BC-011 and both the wrapper and the inner form are recorded.

Priority: Must. Size: S. Depends on: BC-006, BC-011.

**Completed:** 2026-09-10 · 35734f6

#### BC-017 Outlook Safe Links wrappers

As a user, I want Safe Links wrapped links to be unwrapped, so that a link pasted from an email converts like the link it protects.

- Given a `safelinks.protection.outlook.com` link with a `url` parameter, When it is converted, Then the inner URL is decoded once and parsed, the result equals the inner result and the wrapper is recorded with `safelinks` as its type.
- Given a Safe Links wrapper around a Teams deep link around a SharePoint URL, When it is converted, Then both wrappers are recorded in order and the result equals the innermost result.
- Given a Safe Links link whose `url` is truncated so that it is not a valid URL, When it is converted, Then the result is a clean failure that says the wrapped link is incomplete.

Priority: Must. Size: S. Depends on: BC-006, BC-016.

**Completed:** 2026-09-10 · 35734f6

#### BC-018 Document library boundary inference

As a user, I want the split between site, library and folders to be shown as a guess where it is a guess, so that I never take an inferred library name as fact.

- Given any form where the library is not fixed by the page path (BC-008, BC-010, BC-013, BC-014), When it is converted, Then the library component is marked Inferred, the overall state is Inferred and the interface wording says the library boundary was inferred.
- Given a path whose first segment after the site is `Shared Documents` or `Documents`, When the library is inferred, Then that segment is chosen and the reason recorded is "well known library name".
- Given a path with no well known library name, When the library is inferred, Then the first segment after the site is chosen and the reason recorded is "first segment after site".
- Given the same path with the library already Derived (BC-007), When the result is inspected, Then the inference rule is not applied and the reason is "from page path".

Priority: Must. Size: M. Depends on: BC-006.

**Completed:** 2026-09-10 · 35734f6

#### BC-019 Links to folders rather than files

As a user, I want a folder link to produce a folder result with no file component, so that I am not shown a made up file name.

- Given a library view link where `id` equals `parent`, When it is converted, Then no file name is reported, the folder URL equals the encoded path and the state follows the library rule in BC-007.
- Given a `:f:` sharing prefix in the `/r/` variant, When it is converted, Then the result is a folder with no file component and the state is Inferred.
- Given a folder result, When the interface renders it (BC-023), Then the file URL row is absent rather than blank.

Priority: Must. Size: XS. Depends on: BC-007, BC-010.

**Completed:** 2026-09-10 · 35734f6

#### BC-020 Hosts other than sharepoint.com

As a user in a sovereign or government cloud, I want links on other Microsoft hosts to parse in best effort mode, so that the tool is not limited to the global cloud.

- Given a link on a `sharepoint.us`, `sharepoint-mil.us` or `sharepoint.cn` host in any of the offline resolvable forms, When it is converted, Then the result is identical in structure and state to the same form on `sharepoint.com`, and the cloud is recorded in the result.
- Given a link on a `-my` variant of those hosts, When it is converted, Then BC-014 behaviour applies.
- Given a host that matches none of the known suffixes but whose path has a recognised SharePoint shape, When it is converted, Then the result is produced with the state downgraded to Inferred and a note that the host is not a known Microsoft cloud.

Priority: Should. Size: S. Depends on: BC-008, BC-014.

**Completed:** 2026-09-10 · 35734f6

#### BC-021 Malformed, truncated and non Microsoft links fail cleanly

As a user, I want bad input to produce a specific message, so that I know what to fix.

- Given an empty string, whitespace, or text that is not a URL, When it is converted, Then the parser returns a failure with a reason code for "not a URL" and no result state.
- Given a URL on a host that is not a recognised Microsoft host and has no recognised path shape, When it is converted, Then the failure reason is "not a Microsoft 365 link" and the host is named in the message.
- Given a recognised form whose query string is cut off mid value, When it is converted, Then the failure reason is "link appears truncated" and the message names the parameter that was incomplete.
- Given any failure, When the web application receives it, Then no history row is written unless the user has chosen to keep failures (BC-030).

Priority: Must. Size: S. Depends on: BC-006.

**Completed:** 2026-09-10 · 35734f6

#### BC-022 Fixture corpus and regression harness

As a developer, I want every supported link form to have an anonymised fixture with its expected result, so that regressions are caught and new forms are added the same way every time.

- Given the parser package test suite, When it runs, Then every row of the link form matrix has at least one fixture and every fixture passes, including negative fixtures for BC-021.
- Given a new fixture file is added with an expected result, When the suite runs, Then it is picked up without registering it anywhere else.
- Given the fixture set, When the anonymisation check in section 8 runs, Then no fixture contains a real tenant name, person name, client name, sharing token or Safe Links data blob.
- Given a fixture, When its expected result is inspected, Then it states the expected confidence state and the expected per component Derived or Inferred flags.

Priority: Must. Size: S. Depends on: BC-006.

**Completed:** 2026-09-10 · 35734f6

#### BC-032 Search across history

As a user, I want to search history by any text, so that I can find a conversion from a client name, file name or part of a link.

- Given rows exist, When a search term is entered, Then rows whose input, path, folder URL, file URL or file name contain the term are returned, case insensitively.
- Given a history of at least five thousand rows, When a search is run, Then results appear within one second on the reference host and the page remains responsive.
- Given a search that matches nothing, When it completes, Then the page says so and offers to clear the search.
- Given each matched row, When it is listed, Then its state badge is shown so Verified, Derived, Inferred and Unresolved rows can be told apart in results.

Priority: Must. Size: M. Depends on: BC-031.

**Completed:** 2026-09-10 · 13fb069

#### BC-033 Filter history

As a user, I want to filter history by state, date range, host or tenant, source and failure, so that I can narrow a long list.

- Given rows with mixed states, When the state filter is set to one of Verified, Derived, Inferred or Unresolved, Then only rows in that state are shown and the count is displayed.
- Given a date range, When it is applied, Then only rows converted within the range are shown, inclusive of both ends.
- Given the source filter is set to `extension`, When applied, Then only rows submitted by the extension are shown.
- Given filters and a search term together, When applied, Then the result is the intersection and the combination is reflected in the URL.

Priority: Should. Size: S. Depends on: BC-032.

**Completed:** 2026-09-10 · 13fb069

#### BC-034 Delete history entries

As a user, I want to delete one entry or a selected set, so that I can remove lookups that should not be kept.

- Given a row, When delete is chosen and confirmed, Then the row is gone from the list and from search, and a second confirmation is not required.
- Given several rows are selected, When bulk delete is confirmed, Then only those rows are removed and the count removed is shown.
- Given a delete is cancelled at the confirmation step, When the list is refreshed, Then nothing has changed.

Priority: Must. Size: S. Depends on: BC-031.

**Completed:** 2026-09-10 · 13fb069

#### BC-035 Export history

As a user, I want to export the current filtered history as CSV and JSON, so that I can use it outside the tool.

- Given a filter or search is active, When export is chosen, Then only the matching rows are exported and the file name includes the date.
- Given the CSV export, When it is opened in a spreadsheet, Then one row per conversion appears with columns for time, input, path, folder URL, file URL, state, method, source and inferred components, and values containing commas or quotes are escaped correctly.
- Given the JSON export, When it is parsed, Then each entry contains the full stored result including the state and per component flags.

Priority: Should. Size: S. Depends on: BC-033.

**Completed:** 2026-09-10 · 13fb069

#### BC-028 Accessibility of the conversion and history pages

As a user relying on a keyboard or a screen reader, I want the pages to be operable and announced correctly, so that I can use the tool without a mouse.

- Given the conversion page, When it is navigated with Tab and Enter only, Then every control is reachable in a sensible order and the result region is announced when it updates.
- Given the state badge and inferred markers, When viewed by a colour vision deficiency simulator, Then the state is still distinguishable by text or shape, not colour alone.
- Given the history page, When an automated accessibility checker runs, Then no critical or serious issues are reported and text contrast meets WCAG 2.2 AA.

Priority: Should. Size: S. Depends on: BC-023, BC-031.

**Note:** the automated check is axe-core inside jsdom with the colour contrast rule disabled (jsdom has no layout). Contrast ratios of the palette in `public/app.css` were computed by hand and all exceed 4.5:1. Keyboard order follows DOM order of native controls; a real browser pass is still worth doing alongside BC-023.

**Completed:** 2026-09-10 · 13fb069

#### BC-048 Backup and restore of the database

As the person running BreadCrumb, I want a documented and tested way to back up and restore the database file, so that history can be recovered after a failure.

- Given the application is running, When the documented backup command is run, Then a consistent copy of the database is produced without stopping the container, and opening the copy shows the same row count.
- Given a backup copy, When the documented restore steps are followed on a fresh volume, Then the application starts and history matches the backup.
- Given the README, When it is read, Then it states where the file lives on the volume, that write ahead log companion files must be included if present, and how to verify a restore.

Priority: Must. Size: S. Depends on: BC-004, BC-029.

---

**Completed:** 2026-09-10 · d4a0373

#### BC-025 Honest result labelling

As a user, I want every result to say how it was obtained and how much of it is a guess, so that I trust it exactly as much as it deserves.

- Given a Derived result, When it is rendered, Then the method text reads that the path was decoded from the link with no guesswork and no component carries an inferred marker.
- Given an Inferred result, When it is rendered, Then the method text names each inferred component and the rule used (from BC-018), for example "library boundary inferred: first segment after site".
- Given an Unresolved result, When it is rendered, Then the method text says what was recognised, what could not be decoded and that sign in would be needed, and no path is shown as if it were known.
- Given a Verified result (from M3), When it is rendered, Then the method text names the Graph lookup used and the time it was confirmed.
- Given a result that passed through wrappers (BC-016, BC-017), When it is rendered, Then the wrappers removed are listed in order.

Priority: Must. Size: S. Depends on: BC-023, BC-018.

**Completed:** 2026-09-10 · a93f940

#### BC-026 Failure and Unresolved presentation

As a user, I want failures and Unresolved results to tell me what to do next, so that I am not left with a bare error.

- Given a parse failure from BC-021, When it is rendered, Then the message states the reason in plain language and the input remains in the box for editing.
- Given an Unresolved result, When it is rendered before M3 ships, Then the next step reads that authenticated validation is not yet available in this version, and the result can still be saved to history with its Unresolved state.
- Given an Unresolved result, When it is rendered after M3 ships, Then the next step offers the sign in and validate action (BC-036).
- Given a failure, When the user chooses "keep this in history anyway", Then a row is written with the failure reason and no state, and it is filterable as a failure (BC-033).

Priority: Must. Size: S. Depends on: BC-023, BC-021.

**Completed:** 2026-09-10 · a93f940

#### BC-040 Record validation upgrades in history

As a user, I want to see which stored results were upgraded by validation, so that I can tell verified facts from earlier guesses.

- Given a stored row in the Derived, Inferred or Unresolved state, When it is validated, Then the row records the Verified result, the time and the Graph item identifier while retaining the original result, and the list shows an "upgraded" marker with the previous state.
- Given the history filter (BC-033), When "upgraded" is chosen, Then only rows that moved from Inferred or Unresolved to Verified are listed.
- Given a row that was Verified from the start, When it is listed, Then it carries no "upgraded" marker.

Priority: Must. Size: M. Depends on: BC-030, BC-036.

**Completed:** 2026-09-10 · a93f940

### Spike S5: resolving a document id

| ID | Question | Timebox | Closing evidence | Blocks |
|---|---|---|---|---|
| S5 | How is a list item unique id from `sourcedoc` or `UniqueId` resolved to a driveItem through Graph, if at all? | Half a day | A working call sequence against the test tenant, or a written conclusion that Graph cannot do it and the form stays Unresolved in v1. | BC-039 |

**Finding:** Graph resolves a `Doc.aspx?sourcedoc={guid}` link directly: `GET /shares/{u!base64url(link)}/driveItem` (with `Prefer: redeemSharingLink`) returned the file, its folder path and a top level `sharepointIds.listItemUniqueId` equal to the GUID, on the test tenant with delegated `Files.Read.All` and `Sites.Read.All`. No list lookup or search was needed; search by unique id and by file name within the site remain as fallbacks. Evidence: `docs/m3-tenant-run.md` (B5) and the anonymised recording `packages/app/test/fixtures/graph/doc-aspx-via-shares.json`.

**Completed:** 2026-09-11 · a72c6ab

#### BC-023 Paste and convert page

As a user, I want to paste a link and see the path, folder URL, file URL and components, so that I can find the file's folder.

- Given the conversion page, When the worked example link is pasted and submitted, Then the path, folder URL and file URL shown match the expected output in the brief and the state badge reads Derived.
- Given any result, When it is rendered, Then the components (tenant, site, library, folder chain, file name) are listed, each Inferred component carries an "inferred" marker next to it, and the state badge shows exactly one of Verified, Derived, Inferred or Unresolved.
- Given a result, When the copy control next to the path, folder URL or file URL is used, Then the clipboard holds that value exactly, and the folder and file URLs are also rendered as links that open in a new tab.
- Given the input is submitted with the keyboard alone, When Enter is pressed in the input, Then conversion runs without needing the mouse.
- Given a folder result (BC-019), When it is rendered, Then no file URL row is shown.

Priority: Must. Size: M. Depends on: BC-006, BC-007, BC-024.

**Note:** the copy control was confirmed in a real browser on 2026-09-11 ("Folder URL copied to clipboard" on a Verified entry, served from localhost); the remaining criteria are covered by the page tests.

**Completed:** 2026-09-11 · a72c6ab

#### BC-039 Resolve sourcedoc and UniqueId GUIDs

As a signed in user, I want `Doc.aspx` and `UniqueId` links resolved, so that a document GUID becomes a folder.

- Given an Unresolved result from BC-012 or BC-013 carrying a GUID, When validate is chosen, Then the item is looked up by the method proven in spike S5 and the result becomes Verified.
- Given the lookup method from S5 returns nothing, When validation completes, Then the result stays Unresolved with a message that the document id could not be resolved in this site.

Priority: Should. Size: M. Depends on: BC-036, BC-012, BC-040. Blocked by spike S5.

**Note:** proven on the test tenant on 2026-09-11. Graph's shares endpoint resolves both a `Doc.aspx`/`doc2.aspx` sourcedoc link and a `download.aspx?UniqueId=` link directly (spike S5); search by unique id and by file name remain as replay-tested fallbacks, and the not-found message names every attempt.

**Completed:** 2026-09-11 · 0c507d0

### Spike S9: resolving links with the browser's SharePoint session

| ID | Question | Timebox | Closing evidence | Blocks |
|---|---|---|---|---|
| S9 | Can the extension resolve a link with the browser's existing SharePoint session instead of a Graph token: do SharePoint REST `GetFileById` (Doc.aspx, UniqueId) and SharePoint's `/_api/v2.0/shares/u!…/driveItem` (sharing links) answer an extension service worker request with `credentials: 'include'`, in Chrome and Edge, on the tenant and `-my` hosts? What does each browser's permission prompt say? | Half a day | A table of link form against call, status and body shape from the test tenant, and the prompt text per browser (the options page test posts results to the BreadCrumb log). Until decided, the extension carries `optional_host_permissions` for `https://*.sharepoint.com/*`, granted per tenant by the user; adopting the approach reopens invariant 17 and widens the definition of Verified to include SharePoint lookups. | Decision on cookie-based resolution in the extension |

**Finding:** in Microsoft Edge, an extension service worker with the optional host permission for the tenant's hosts resolves every link form with the user's existing SharePoint session and no app registration: SharePoint REST `GetFileById` returns the exact server-relative path of a Doc.aspx or doc2.aspx file and `…/ListItemAllFields/ParentList/RootFolder` its true library root; SharePoint's `/_api/v2.0/shares/u!…/driveItem` returns a Graph-shaped driveItem for Doc.aspx, `/r/` file and folder links (unique id equal to the link's `d`) and fresh `/s/` sharing tokens. OneDrive for Business (`-my`) links answer 401 until OneDrive has been opened in the browser session, because the session cookie is per host. A specific-people `/s/` link that had been removed answered 404 through both SharePoint and Graph. Chrome was not run: the contract now makes Edge primary and Chrome a low priority want (BC-050). Evidence: `docs/m4-extension-run.md` (spike S9). Adopted as BC-049; labelling of such results is decision D9.

**Completed:** 2026-09-14 · aae84ca
