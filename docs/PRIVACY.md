# BreadCrumb privacy policy

Last updated: 25 September 2026

BreadCrumb is a Microsoft Edge extension that turns SharePoint and OneDrive for
Business links into the folder each file sits in. This policy describes every
piece of data it touches.

## The short version

BreadCrumb has no server, no account and no analytics. Nothing it reads is sent
to the developer or to any third party. Everything it keeps stays in your own
browser profile, or in a folder on your own computer that you choose.

## What BreadCrumb reads

**Links on a Copilot page.** When you open the popup on
`m365.cloud.microsoft`, `copilot.cloud.microsoft` or `copilot.microsoft.com`,
BreadCrumb reads the SharePoint and OneDrive for Business links cited in the
answer on screen. It reads nothing else on the page: not the prompt, not the
answer text, not any other content.

**A link you paste.** If you paste a link into the popup yourself, BreadCrumb
reads that link.

From a link it derives the file name, the folder path and the tenant host. That
is the product.

## Where BreadCrumb sends data

**Only to your own tenant, and only if you ask it to.** If you grant access to
your SharePoint host on the options page, BreadCrumb calls that host's own API
(`https://<your-tenant>.sharepoint.com/_api/v2.0/...`) to confirm where a file
lives. The request carries the Microsoft 365 session your browser already has,
exactly as loading the site in a tab would. It is sent to Microsoft, to your own
tenant, over HTTPS.

BreadCrumb makes no other network requests. There is no developer server, no
telemetry endpoint, no crash reporting and no advertising or analytics code of
any kind.

**The extension never reads cookie values.** It does not request the `cookies`
permission and cannot see them. The browser attaches the session itself.

## What BreadCrumb stores, and where

| What | Where | Leaves your device? |
|---|---|---|
| History of resolved links: file name, folder path, link, confidence state, timestamps | `chrome.storage.local` in your browser profile | No |
| Your tenant name, your Obsidian note path, your vault folder's name | `chrome.storage.sync` | Only through Edge profile sync, if you have it turned on, between your own signed-in browsers |
| The handle to the Obsidian vault folder you picked | IndexedDB in your browser profile | No |
| Rows you choose to send: file name, folder path, links, date | The Markdown note in the vault folder you picked | No, it is a file on your computer |

History holds the most recent 2,000 results. You can search, export and delete
it from the History page, clear it entirely from the options page, or remove the
extension, which removes all of it.

## Permissions, and why each one is needed

- `storage` — to keep your settings and the local history described above.
- `clipboardWrite` — to put a link on your clipboard when you press Copy.
- Host access to the three Copilot hosts — to read the file links cited in an
  answer on the page you are looking at.
- Optional host access to `https://*.sharepoint.com/*` — only if you grant it,
  and only so BreadCrumb can confirm a file's location with your own tenant.
  BreadCrumb works without it, showing locations decoded from the link alone.

## Children

BreadCrumb is a workplace tool for Microsoft 365 users. It is not directed at
children and collects nothing from anyone.

## Changes

Any change to this policy will be published in this file, with the date above
updated, before a release that depends on it.

## Contact

Tim Hayward — https://github.com/TimHayward/BreadCrumb/issues
