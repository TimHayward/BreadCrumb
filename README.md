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
| `docs/` | The worked example, the Obsidian note format, and notes from the tenant and extension runs. |
| `BACKLOG.md`, `BACKLOG-completed.md` | Open and completed product backlog. |

## Install without building

Download `breadcrumb-extension-<version>.zip` from the [latest release](https://github.com/TimHayward/BreadCrumb/releases/latest) and unzip it somewhere you can leave it: the browser loads the extension from that folder every time it starts, so deleting the folder uninstalls it.

1. Go to `edge://extensions`.
2. Turn on **Developer mode**.
3. Choose **Load unpacked** and select the unzipped folder, the one holding `manifest.json`.
4. Open the **Extensions** button in the toolbar and pin BreadCrumb.

Then set it up as below. To update, unzip the newer release over the same folder and press **Reload** on the BreadCrumb card.

Everything from here to "Using it" is for building from source instead.

## Prerequisites

Only for building. Once the extension is loaded, nothing but Microsoft Edge is needed to run it.

- Node 24 LTS (see `.nvmrc`)
- pnpm 10 (`corepack enable` installs the pinned version)

## Build

```sh
pnpm install
pnpm build
pnpm test     # optional: the whole suite
```

`pnpm build` writes the loadable extension to `packages/extension/dist`. That folder is what Edge loads: the manifest, four bundled scripts, the popup and options pages, the popup stylesheet and the icons. It is not committed, so it has to be built before the first load.

The icons are drawn by `scripts/make-icons.mjs`, which writes the PNGs in `packages/extension/icons`. They are committed, so that only needs running if the drawing changes.

To make a release zip of your own build:

```sh
pnpm build
node scripts/package-extension.mjs   # writes release/breadcrumb-extension-<version>.zip
```

## Install in Microsoft Edge

1. Go to `edge://extensions`.
2. Turn on **Developer mode**.
3. Choose **Load unpacked** and select `packages/extension/dist`. Select that folder itself, not `packages/extension`.
4. Open the **Extensions** button in the toolbar and pin BreadCrumb, so its trail of crumbs sits in the toolbar and the popup is one click away.

After changing the code, run `pnpm build` again and press **Reload** on the BreadCrumb card in `edge://extensions`. Your settings survive a reload. Access to the vault folder may not: if it has lapsed, the popup says so and Options takes a moment to restore.

Chrome and other Chromium browsers follow the same steps at `chrome://extensions` and are expected to work, but they are untested (backlog story BC-050).

## Set it up

Open **Options** from the popup, or use **Details → Extension options** on the extensions page. It opens as a full tab, because the folder picker cannot run inside the small settings panel.

- **Your tenant:** type the tenant name, the first label of your SharePoint host, so `contoso` for `contoso.sharepoint.com`, then choose **Allow access to this tenant** and accept the browser's prompt. Without this the extension still decodes links; with it, citations are confirmed against SharePoint and shown as Verified.
- **Your vault:** choose **Choose vault folder**, pick your Obsidian vault and accept the prompt, then set the note path. This is only needed if you want to send rows to a note.

Edge grants folder access for the session. After a browser restart, or an extension reload, the popup will say the access has to be given again: open Options and pick the same folder.

## Paste a link

A link sent in Teams or by email never passed through Copilot, so there is nothing to extract. Open the popup and choose **Paste a link**, paste it, and press **Convert**.

It works anywhere, not only on a Copilot page: on any other site the popup is the paste field and nothing else. On a Copilot page the result joins the top of the list, and is confirmed with your SharePoint session like any other row. The field stays open so several links can go in one after another.

A document already in the list moves to the top rather than appearing twice, even when the link you pasted is a different form of the same document.

## Using it

Open a Copilot response that cites files on `m365.cloud.microsoft` or `copilot.cloud.microsoft`, then open the popup. It lists each SharePoint or OneDrive for Business citation once, and each row shows:

- the file name, a tick box, and the confidence state;
- the document location, with a "library inferred" marker where the library boundary was a guess;
- **Original link** and **Folder link**, which copy that link to the clipboard rather than opening a tab.

Above the list, **Latest answer** and **Whole chat** choose how much of the page to read. A long conversation can cite a great many files, so the popup reads only the latest answer unless you ask for the rest. The count beside the buttons says how many were found, **Select all** and **Select none** tick them together, and the first twenty five are listed with the rest one press away. Confirmation runs a few files at a time and says how far it has got.

Below the list, **Send selected to Obsidian** writes the ticked rows into your note. **Copy selected file links** and **Copy selected folder links** copy the ticked rows, one link per line: each folder is copied once, and any ticked file whose folder is not known yet is left out and counted in the status line. **Copy as table rows** puts the same rows on the clipboard in the note's table format, with its header, to paste anywhere.

## Send to Obsidian

With the vault folder and note path set, tick the rows you want and press **Send selected to Obsidian**. The note path is `BreadCrumb/Document locations.md` unless you change it.

The action bar names the note and vault before you send. Afterwards each row says whether it was written, and the bar offers to open the note in Obsidian. The note is created if it is missing, with front matter, a heading and the table header. Rows are always appended, so sending the same document twice leaves two rows with different dates, and BreadCrumb never rewrites rows you already have. The columns are Document name, File path, Source URL, Folder URL and Date processed. A link that failed, or one still Unresolved, has no location to record and is left out with a count. See `docs/obsidian-note.md` for the format and the exact rules.

BreadCrumb holds access to the one folder you picked and writes the one note you named. Nothing is sent anywhere: the note is written on this device.

When an answer cites no files, which is normal, the popup says so plainly and offers to look in the whole chat instead. The markup detail is folded away behind "The answer did cite files?", for the rarer case where extraction has broken. On `copilot.microsoft.com` the popup explains that Copilot there cites web pages rather than files. When no citations are found on a work surface, "Report markup" copies a redacted sample of the response container to the clipboard so a markup change can be diagnosed; "Diagnose this page" does the same for the whole page.

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

A session only exists once the site has been opened in that browser. Until then SharePoint answers 401, and the popup says so: it names each site, offers a link to open it, and a **Check again** button for when you come back. OneDrive for Business counts as its own site, so the `-my` host usually needs opening separately. The options page offers the same two links once a tenant is set.

A refusal is not always about signing in, so each one says what it was:

- **No session yet** on that host, which opening the site fixes. Never said of a host where another file has just been confirmed.
- **No access to that file**, which is what SharePoint means by 403: a site you are not in, or a file in someone else’s OneDrive.
- **No longer there**: moved, renamed, deleted, or a sharing link that has been withdrawn.
- **Not a link to a file**, where the link points at something BreadCrumb cannot look up.

## Development

The parser is the single implementation of link decoding (architectural invariant 1) and is pure: no network, no DOM, no Node built-ins. It carries a fixture corpus covering every row of the link form matrix in `BACKLOG.md`, and the extension has a contract test that feeds the same corpus through its popup model.

No real tenant link, file name or client name enters the repository. Anonymise before committing: the checklist is in `BACKLOG.md`, section 8.

```sh
pnpm test            # every package
pnpm typecheck
```

Work happens directly on `main` until the MVP is declared. Finished stories move to `BACKLOG-completed.md` with `node scripts/complete-story.mjs --sha <commit> BC-0xx`.
