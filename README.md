# BreadCrumb

BreadCrumb turns a Microsoft 365 SharePoint or OneDrive link into the folder location it points at, keeps every conversion in a searchable history, and (from M4) lifts file citations out of Microsoft Copilot responses.

> **Private network only.** BreadCrumb has no application level access control in v1 and its history holds client names and file titles. Host it only where the private network is the boundary. The compose file binds to `127.0.0.1` by default; set `BREADCRUMB_BIND` to the host's private interface address to expose it to the LAN, and never to a public interface. See backlog risks R4 and R5 and open decision D4.

## Repository layout

| Path | Purpose |
|---|---|
| `packages/parser` | `@breadcrumb/parser`. Pure link parser, the single implementation consumed by both the web application and the extension. No runtime dependencies. |
| `packages/app` | `@breadcrumb/app`. Fastify web application: conversion page, JSON API, history pages, SQLite data access layer. |
| `packages/extension` | `@breadcrumb/extension`. Manifest V3 Chromium extension (build-only stub until M4). |
| `compose.yaml` | The single deployment definition, used unchanged by `docker compose up` locally and by a Portainer Git stack. |
| `docs/` | Worked example, spike write-ups, runbooks and milestone evidence. |
| `BACKLOG.md`, `BACKLOG-completed.md` | Open and completed product backlog. |

## Prerequisites

- Node 24 LTS (see `.nvmrc`)
- pnpm 10 (`corepack enable` installs the pinned version)
- Docker with Compose v2 or later, for the container workflow

## Install, build and test

```sh
pnpm install
pnpm build
pnpm test
```

`pnpm dev` starts the web application from source with reload. `pnpm start` runs the built application.

## Configuration

Every setting is an environment variable with a documented default. Nothing is required in M1. A malformed value stops the process at start with a message naming the variable.

| Variable | Default | Required | Meaning |
|---|---|---|---|
| `PORT` | `3000` | No | Port the application listens on inside the process or container. |
| `DATABASE_PATH` | `./data/breadcrumb.sqlite` (compose sets `/data/breadcrumb.sqlite`) | No | SQLite database file. Its directory is created if missing. |
| `LOG_LEVEL` | `info` | No | One of `trace`, `debug`, `info`, `warn`, `error`, `fatal`. |
| `LOG_REDACT_LINKS` | `false` | No | When `true`, request logs carry only the host of a submitted link, never the full link. |
| `SHORTLINK_EXPANSION_ENABLED` | `false` | No | When `true`, the server follows `1drv.ms` redirects (without cookies, at most 5 hops, only that host is ever fetched) so the target link can be parsed. Needs outbound HTTPS from the container. Off by default so the application makes no outbound requests. |
| `SHORTLINK_TIMEOUT_MS` | `5000` | No | Timeout for one short link request. |
| `AUTH_TENANT_ID` | unset | Only with `AUTH_CLIENT_ID` | Entra tenant id (GUID) for optional Microsoft sign in. When both auth variables are unset the sign in control is hidden and a log line says validation is not configured. Setting one without the other stops the process. |
| `AUTH_CLIENT_ID` | unset | Only with `AUTH_TENANT_ID` | Application (client) id of the public client registration described under "Authenticated validation". |
| `TLS_CERT_FILE` | unset | Only with `TLS_KEY_FILE` | PEM certificate to serve HTTPS (decision D6). Required for Microsoft sign in anywhere other than `localhost`. In compose the files live on the named volume `breadcrumb-tls` mounted at `/tls`. See `docs/https-private-ca.md`. |
| `TLS_KEY_FILE` | unset | Only with `TLS_CERT_FILE` | PEM private key for `TLS_CERT_FILE`. |
| `CLIENT_LOG` | `false` | No | Local diagnostics for sign in runs. When `true` (and auth is configured), the browser posts its sign in, MSAL and Graph events to the server log. Tokens are never sent, but events include file names and paths from the tenant, so leave it off on a shared host. |
| `AUTH_SCOPES` | `Files.Read.All Sites.Read.All` | No | Delegated Graph permissions requested at sign in, space separated. Spike S2 may narrow this. |
| `BREADCRUMB_BIND` | `127.0.0.1` | No | Compose only. Host interface the published port binds to. |
| `BREADCRUMB_PUBLISH_PORT` | `3000` | No | Compose only. Host port mapped to the container's `PORT`. |

## Run with Docker Compose

```sh
docker compose up --build
```

Then open `http://127.0.0.1:3000`. History lives on the named volume `breadcrumb-data`, which survives `docker compose down`, image rebuilds and redeploys. `docker compose down -v` deletes it.

## Deploy with Portainer

See `docs/portainer-runbook.md` (written when spike S7 closes).

## API

One link per request. There is no authentication and any origin is allowed (backlog risk R4), which is why the host must sit on a private network.

### `POST /api/convert`

Request body (JSON):

```json
{ "link": "https://contoso.sharepoint.com/sites/SiteA/Lib/Forms/AllItems.aspx?id=...", "source": "web" }
```

`source` is `web` or `extension` and is stored with the history row.

Success, `200`:

```json
{
  "id": 42,
  "createdAt": "2026-09-10T16:05:00.000Z",
  "result": {
    "ok": true,
    "state": "Derived",
    "form": "library-view",
    "method": { "code": "library-view/id+parent", "text": "Path decoded from the link's id and parent parameters. Library boundary taken from the page path." },
    "cloud": "global",
    "path": "/sites/SiteA/Lib/Folder/File.pdf",
    "folderUrl": "https://contoso.sharepoint.com/sites/SiteA/Lib/Folder",
    "fileUrl": "https://contoso.sharepoint.com/sites/SiteA/Lib/Folder/File.pdf",
    "components": {
      "tenant": { "value": "contoso", "flag": "Derived" },
      "host": { "value": "contoso.sharepoint.com", "flag": "Derived" },
      "sitePath": { "value": "/sites/SiteA", "flag": "Derived" },
      "library": { "value": "Lib", "flag": "Derived", "reason": "from page path" },
      "folders": { "value": ["Folder"], "flag": "Derived" },
      "fileName": { "value": "File.pdf", "flag": "Derived" }
    },
    "identifiers": [],
    "hints": [],
    "wrappers": [],
    "original": "https://contoso.sharepoint.com/sites/SiteA/Lib/Forms/AllItems.aspx?id=...",
    "parserVersion": "0.1.0"
  }
}
```

`state` is exactly one of `Verified`, `Derived`, `Inferred` or `Unresolved`. `fileUrl` and `components.fileName` are absent for folder results. Every component carries a `flag` of `Derived` or `Inferred`.

Parse failure, `400`, and no history row is written:

```json
{ "ok": false, "reason": "not_microsoft_365", "message": "www.example.com is not a SharePoint or OneDrive host, so there is nothing to decode.", "detail": { "host": "www.example.com" }, "parserVersion": "0.1.0" }
```

Reason codes: `not_a_url`, `not_microsoft_365`, `truncated` (with `detail.parameter`), `unsupported_form`, `missing_parameter`, `parser_error`. A malformed request (no `link`, bad `source`, invalid JSON) returns `400` with `reason: "invalid_request"`.

Unresolved results (sharing tokens, `Doc.aspx`, consumer OneDrive) are `200` with `state: "Unresolved"` and no `path`, `folderUrl` or `fileUrl`; `components` then carries only what the link reveals, and `identifiers` and `hints` hold the ids and best effort clues. Wrappers removed (Teams file links, Safe Links, expanded short links) are listed in `wrappers` in the order removed.

### `GET /history/export.csv` and `GET /history/export.json`

Download the history, filtered by the same query parameters as the history page (`q`, `state`, `from`, `to`, `source`, `host`).

### `GET /healthz`

`200 { "status": "ok", "database": "/data/breadcrumb.sqlite" }` when the database file is readable and writable and a write lock can be taken; otherwise `503` with `failed` set to `file-access` or `write-lock`. The compose health check uses this endpoint.

### Logs

One JSON line per request with `method`, `route`, `status`, `durationMs` and, for conversions, `form`, `state` (or `reason` for failures) and `input`. With `LOG_REDACT_LINKS=true` the `input` field carries only the link's host.

## History

Every successful conversion is kept. The history page searches input, path, folder URL, file URL and file name (case insensitive), filters by state (including kept failures), date range, source and host or tenant, and reflects the combination in the URL so it can be bookmarked. Entries can be deleted singly or in bulk after one confirmation. The current filtered set exports as CSV or JSON with the date in the file name.

To measure search on a large history, build once and seed a scratch database:

```sh
pnpm build
node scripts/seed-history.mjs ./data/seed.sqlite 5000
```

## Authenticated validation

Optional. Without it everything above works unchanged. With it, a user can sign in to Microsoft in the browser and confirm a Derived, Inferred or Unresolved result against Microsoft Graph. The result becomes Verified, corrections to the library boundary and folder chain are shown as "was inferred as", and the original result stays beneath. Graph is called from the browser; the access token lives in the browser session (`sessionStorage`) and is never sent to the server. Signing out discards it.

**Register a public client once in Entra ID (global Microsoft cloud only):**

1. Entra admin centre → App registrations → New registration. Single tenant. No client secret is needed or used.
2. Authentication → Add a platform → **Single-page application**. Redirect URI: the exact origin users open, with a trailing slash, for example `http://192.168.1.20:3000/`. Add one entry per address in use.
3. API permissions → Add a permission → Microsoft Graph → **Delegated** → `Files.Read.All` and `Sites.Read.All` (the default `AUTH_SCOPES`). Grant admin consent, or let each user consent if the tenant allows it. Spike S2 records the smallest set that works.
4. Set `AUTH_TENANT_ID` (Directory (tenant) ID) and `AUTH_CLIENT_ID` (Application (client) ID) in the environment and restart.

**Using it:** a "Sign in to Microsoft" control appears in the header. After signing in, every result Graph can check verifies automatically as soon as it is shown: sharing links (`/:x:/s/…`, `/g/`, `/t/`, `/r/`), `Doc.aspx` and `UniqueId` links, direct URLs and library views. The "Validate with Microsoft Graph" button stays for retries. Opening the history page while signed in verifies every unverified entry newest first, including entries the extension submitted, trying each entry once per tab; "Verify all unverified" retries everything. After you send citations from the extension it opens the history in a background tab, which verifies them and closes itself when all are Verified (it stays open if you need to sign in or an entry cannot be verified). Sign in is shared by all BreadCrumb tabs: MSAL keeps tokens in localStorage encrypted with a key held in a session cookie, so they are unusable once the browser session ends and never reach the server. Consumer OneDrive and sovereign cloud links are not validated. Sharing links are submitted to Graph with `Prefer: redeemSharingLink`, so a link that grants access on first use behaves as if you had clicked it. For diagnosis, `localStorage.setItem('breadcrumb:debug', '1')` in the browser console logs every Graph request and response. Graph errors are shown plainly: a permission or consent problem names the permission, throttling shows the wait Graph asked for and the button re-enables when it has passed, and an expired sign in asks you to sign in again. The stored result never changes on an error.

What the browser does: for a path (Derived or Inferred) it resolves the site by path, lists the site's document libraries, picks the library whose URL prefixes the path, and fetches the item by path within it. For a sharing token (Unresolved) it submits the link to the `/shares/{u!…}/driveItem` endpoint and reads the item and its library. `Doc.aspx` and `UniqueId` links await spike S5. Sovereign clouds and consumer OneDrive are not validated in this version.

The Verified state is asserted by the browser (risk R12): the server checks the payload's shape and records the Graph item and drive ids with every validation so it can be re-checked.

## Copilot extension

`packages/extension` is a Manifest V3 extension for current Chrome and Edge. It runs only on `m365.cloud.microsoft`, `copilot.cloud.microsoft` and `copilot.microsoft.com` (host permissions for those three and nothing broader). Opening the popup on a Copilot response lists every SharePoint or OneDrive citation once, with its folder, confidence state and a "library inferred" marker where the library boundary was guessed; ticked items are sent one at a time to `POST /api/convert` with source `extension`. On the consumer host the popup shows a defined empty state, because Copilot there cites web pages. When no citations are found on a work host, "Report markup" copies a redacted sample of the response container to the clipboard for diagnosis.

Build and load unpacked:

```sh
pnpm build
# Chrome or Edge: Extensions → Developer mode → Load unpacked → packages/extension/dist
```

Then open the extension options and enter the API base URL, for example `http://192.168.1.20:3000`. The extension keeps no other setting and uses the shared parser package, never a copy of it.

Until spike S1 delivers DOM captures from the live Copilot surfaces, the response container selectors in `packages/extension/src/extract.ts` are best effort; see `docs/m4-extension-run.md`.

## Backup and restore

The database lives at `/data/breadcrumb.sqlite` on the named volume `breadcrumb-data`. In write ahead logging mode SQLite also keeps `breadcrumb.sqlite-wal` and `breadcrumb.sqlite-shm` next to it. Never copy the raw files while the application runs: recent writes may still be in the `-wal` file.

**Back up while running.** The backup script uses SQLite's online backup API inside the container, so the copy is consistent and self contained (no `-wal` companion needed):

```sh
scripts/backup.sh                     # writes backups/breadcrumb-<timestamp>.sqlite
scripts/backup.sh /path/to/copy.sqlite
```

The command prints the number of conversions in the copy. Compare it with the count shown at the top of the history page.

**Check a backup** without touching the stack:

```sh
scripts/restore.sh --check backups/breadcrumb-20260910-120000.sqlite
```

**Restore.** This stops the application, replaces the database on the volume (removing any `-wal` and `-shm` files with it), starts the application and waits for the health check:

```sh
scripts/restore.sh backups/breadcrumb-20260910-120000.sqlite
```

**Verify a restore.** Open the history page and compare the entry count with the number printed by the backup or check command. If you copy the raw files by hand instead, stop the application first and copy `breadcrumb.sqlite` together with its `-wal` and `-shm` files if they exist.

Under Portainer the same scripts work from any machine with Docker access to the host, or run the two container commands they wrap (`node dist/backup-cli.js` inside the container, then copy the file out) from the Portainer console.
