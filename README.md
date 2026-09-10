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
