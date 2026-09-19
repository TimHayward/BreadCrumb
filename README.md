# BreadCrumb

BreadCrumb is a Microsoft Edge extension that turns the SharePoint and OneDrive for Business citations in a Microsoft Copilot response into the folder location each file sits in, and puts those links on your clipboard.

Installing the extension is the whole installation. There is no server, no database and no deployment: the extension decodes links in the browser with a shared parser and, where you allow it, confirms them with the Microsoft 365 session your browser already has.

It can also write what it finds into an Obsidian note, as rows in a Markdown table in your own vault.

> **What it holds.** File names and folder paths from your tenant appear in the popup while it is open, go to your clipboard when you copy, and go into your note when you send. The extension itself stores only the tenant you granted, your vault folder and the note path. Keeping a searchable history in the extension is still to come (see `BACKLOG.md`, story BC-055).

## Repository layout

| Path | Purpose |
|---|---|
| `packages/extension` | `@breadcrumb/extension`. The product: a Manifest V3 extension for Microsoft Edge. |
| `packages/parser` | `@breadcrumb/parser`. Pure link parser, the single implementation of every link form. No runtime dependencies, no network, no DOM. |
| `packages/validation` | `@breadcrumb/validation`. Turns a parsed link into a confirmed result through a Microsoft Graph shaped lookup, which the extension calls against SharePoint with your browser session. |
| `docs/` | Worked example, spike write-ups and run notes. |
| `BACKLOG.md`, `BACKLOG-completed.md` | Open and completed product backlog. |

## Prerequisites

- Node 24 LTS (see `.nvmrc`)
- pnpm 10 (`corepack enable` installs the pinned version)

## Install, build and test

```sh
pnpm install
pnpm build
pnpm test
```

`pnpm build` writes the loadable extension to `packages/extension/dist`.

## Install the extension

```sh
pnpm build
# Edge: edge://extensions → Developer mode → Load unpacked → packages/extension/dist
```

Then open the extension's options page and grant access to your tenant, by entering the tenant name (the first label of your SharePoint host, so `contoso` for `contoso.sharepoint.com`) and allowing access when the browser asks. Without that grant the extension still decodes links; with it, citations are confirmed against SharePoint and shown as Verified.

## Using it

Open a Copilot response that cites files on `m365.cloud.microsoft` or `copilot.cloud.microsoft`, then open the popup. It lists every SharePoint or OneDrive for Business citation once, and each row shows:

- the file name, a tick box, and the confidence state;
- the document location, with a "library inferred" marker where the library boundary was a guess;
- **Original link** and **Folder link**, which copy that link to the clipboard rather than opening a tab.

Below the list, **Send selected to Obsidian** writes the ticked rows into your note. **Copy selected file links** and **Copy selected folder links** copy the ticked rows, one link per line: each folder is copied once, and any ticked file whose folder is not known yet is left out and counted in the status line. **Copy as table rows** puts the same rows on the clipboard in the note's table format, with its header, to paste anywhere.

## Send to Obsidian

Open the options page, choose your vault folder and allow the browser's prompt, then set the note path (`BreadCrumb/Document locations.md` by default). Tick the rows you want in the popup and press **Send selected to Obsidian**.

The note is created if it is missing, with front matter, a heading and the table header. Rows are always appended, so sending the same document twice leaves two rows with different dates, and BreadCrumb never rewrites rows you already have. The columns are Document name, File path, Source URL, Folder URL and Date processed. A link that failed, or one still Unresolved, has no location to record and is left out with a count. See `docs/obsidian-note.md` for the format and the exact rules.

BreadCrumb holds access to the one folder you picked and writes the one note you named. Nothing is sent anywhere: the note is written on this device.

On `copilot.microsoft.com` the popup shows a defined empty state, because Copilot there cites web pages rather than files. When no citations are found on a work surface, "Report markup" copies a redacted sample of the response container to the clipboard so a markup change can be diagnosed; "Diagnose this page" does the same for the whole page.

## Confidence states

Every result says how it was obtained, and nothing inferred is presented as fact.

| State | Meaning |
|---|---|
| Verified | Confirmed by an authenticated Microsoft 365 lookup. Today that is SharePoint answering with your browser session; the method text names the call. |
| Derived | Decoded deterministically from the link, with no guesswork. |
| Inferred | Best effort: at least one component is a guess, usually where the document library ends and the folders begin. |
| Unresolved | The link form is recognised but cannot be decoded without an authenticated lookup, for example a sharing token. |

Personal (consumer) OneDrive is not supported. Links on `onedrive.live.com` and `1drv.ms` fail with a message saying so, and are never fetched.

## How confirmation works

For a tenant you have granted, the extension calls that tenant's own SharePoint host at `/_api/v2.0/...` with `credentials: 'include'`, so the browser attaches the session you already have. Only SharePoint's answers are used: cookie values are never read, and nothing is sent anywhere else. The optional host permission is `https://*.sharepoint.com/*`, requested at runtime for one tenant's hosts and revocable from the options page.

OneDrive for Business links need OneDrive to have been opened in the browser at least once, otherwise SharePoint answers 401 for the `-my` host and the row keeps its best effort result.

## Development

The parser is the single implementation of link decoding (architectural invariant 1) and is pure: no network, no DOM, no Node built-ins. It carries a fixture corpus covering every row of the link form matrix in `BACKLOG.md`, and the extension has a contract test that feeds the same corpus through its popup model.

No real tenant link, file name or client name enters the repository. Anonymise before committing: the checklist is in `BACKLOG.md`, section 8.

```sh
pnpm test            # every package
pnpm typecheck
```

Work happens directly on `main` until the MVP is declared. Finished stories move to `BACKLOG-completed.md` with `node scripts/complete-story.mjs --sha <commit> BC-0xx`.
