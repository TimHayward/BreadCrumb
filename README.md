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

### `GET /healthz`

`200 { "status": "ok", "database": "/data/breadcrumb.sqlite" }` when the database file is readable and writable and a write lock can be taken; otherwise `503` with `failed` set to `file-access` or `write-lock`. The compose health check uses this endpoint.

### Logs

One JSON line per request with `method`, `route`, `status`, `durationMs` and, for conversions, `form`, `state` (or `reason` for failures) and `input`. With `LOG_REDACT_LINKS=true` the `input` field carries only the link's host.

## Backup and restore

Documented when BC-048 lands (M2).
