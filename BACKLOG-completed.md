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
