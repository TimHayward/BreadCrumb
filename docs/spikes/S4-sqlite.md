# S4: SQLite access approach

**Question.** Which SQLite access approach fits the container: a native module driver, the Node built-in `node:sqlite` module, or a WebAssembly build? What does each do to image size, build time, write-ahead logging and online backup?

**Timebox.** 1 day. Closed in about one hour because the built-in module met every requirement on the first check, so the native and WebAssembly throwaway images were not built.

**Date.** 2026-09-10

## Method

A throwaway script (`s4-check.mjs`, kept out of the repository) ran inside the unmodified `node:24-alpine` image with a Docker volume mounted at `/data`. It opened a database on the volume, switched it to write-ahead logging, spawned two child processes that each inserted 1000 rows concurrently, then took an online backup while the main connection stayed open and counted the rows in the copy.

```
docker run --rm -v <script>:/spike -v s4-spike-data:/data node:24-alpine node /spike/s4-check.mjs
```

## Result

| Check | Outcome |
|---|---|
| Node version in `node:24-alpine` | v24.21.0 |
| SQLite library version bundled with Node | 3.53.4 |
| `node:sqlite` importable without a flag | Yes. No `ExperimentalWarning` printed to stderr. |
| `PRAGMA journal_mode = WAL` | Returns `wal`. Companion `-wal` and `-shm` files appear on the volume. |
| Two processes writing concurrently, 2000 inserts, `busy_timeout = 5000` | 1999 rows landed. One insert raised `SQLITE_BUSY` in one writer. |
| Online backup while the database is open | Works through the module level `backup(db, destinationPath)` function (there is no `db.backup()` method on `DatabaseSync` in Node 24). Copy held the same row count as the source. |
| Compiler stage needed | No. Nothing was installed; the image was used as pulled. |
| Base image size | 56 MB (`node:24-alpine`). The runtime image will be this plus the built application, far under the 250 MB target. |
| Build time impact | None. No native compilation step. |

## Reading the one busy error

The app runs as a single process with a single connection, so cross-process write contention does not occur in v1. The one `SQLITE_BUSY` under deliberate two-process contention is recorded so that R8 (SQLite limits if the tool spreads to a team) has a data point. The data access layer will still set a busy timeout and retry a write once on `SQLITE_BUSY` as cheap insurance, and will surface persistence failures rather than swallow them (invariant 12).

## Decision D2

**Closed: use `node:sqlite`.** No native module, no prebuilt binaries, no WebAssembly build. `db/connection.ts` in `@breadcrumb/app` is the only file that imports the driver (invariant 10), so if a later Node upgrade changes the module's behaviour the swap to `better-sqlite3` is confined to that file plus a Dockerfile install step.

Consequences carried into stories:

- BC-029: open with WAL and a busy timeout; migrations run inside a transaction.
- BC-048: the documented backup command uses `backup()` from `node:sqlite` so it is safe while the application runs, and the restore instructions cover `-wal` and `-shm` files.
- NFR image size: the runtime image needs no compiler stage.
- R11 (native module build failure): no longer applies.
