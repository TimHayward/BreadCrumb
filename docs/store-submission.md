# Edge Add-ons submission

Everything Partner Center asks for, written out so it can be pasted in. Sources:
[Publish an extension](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension)
and the [Microsoft Edge Add-ons store policies](https://learn.microsoft.com/en-us/microsoft-edge/extensions/store-policies/developer-policies).

## Package

- Built with `pnpm build`, zipped with `node scripts/package-extension.mjs`.
- The zip is `release/breadcrumb-extension-<version>.zip`. Upload that file.
- Manifest V3, no background service worker.
- Permissions: `storage`, `clipboardWrite`. Host permissions: the three Copilot
  hosts. Optional host permission: `https://*.sharepoint.com/*`.

## Store listing

**Display name**

```
BreadCrumb
```

**Short description** (the manifest `description`, 96 characters)

```
Turns SharePoint and OneDrive citations in Copilot responses into folder locations you can copy.
```

**Description** (paste as-is; plain text, no other browser named)

```
Copilot tells you which file an answer came from, but not where that file lives. BreadCrumb closes that gap.

Open a Microsoft Copilot answer that cites files from SharePoint or OneDrive for Business, click BreadCrumb, and every cited document is listed with the folder it actually sits in, written as a readable path. One click copies the file link; one click copies the folder link; you can copy a whole selection at once.

A link that never went through Copilot works too. Paste a link from a Teams message or an email into the popup, press Convert, and BreadCrumb works out where that file lives. That works on any page, not only a Copilot one.

HOW IT WORKS

BreadCrumb decodes the link itself, in your browser. That alone is often enough to place a file. If you grant access to your own SharePoint host on the options page, BreadCrumb also asks your tenant to confirm the location, using the Microsoft 365 session your browser already has. There is nothing to sign in to, nothing to register, and no password is ever seen.

Each result says how confident it is and why: Verified when your tenant confirmed it, Derived when the link itself carried enough, Inferred when part of the path had to be judged, and Unresolved when it could not be placed. You are told which, every time.

IT REMEMBERS WHAT YOU FIND

Every result is kept on this device, so a folder found once does not have to be found again. The History page lets you search it, filter by confidence or by how the link arrived, copy or open a folder, delete anything you like, and export what you see as CSV or JSON.

SEND IT TO OBSIDIAN

If you keep notes in Obsidian, BreadCrumb can append what it finds to a Markdown table in a note in your own vault: document name, readable folder path, the file link, the folder link and the date. You choose the vault folder and the note path. The note is a file on your own computer. Obsidian is optional and is not needed for anything else.

PRIVACY

BreadCrumb has no server, no account, no sign-in and no analytics. It makes no network request other than to your own tenant's SharePoint host, and only when you have granted that. Nothing it reads is sent to the developer or to anyone else. History and settings live in your browser profile; removing the extension removes them.

WHAT YOU NEED

A Microsoft 365 work or school account. Personal (consumer) OneDrive links are recognised and reported as unsupported.

BreadCrumb is free and open source: https://github.com/TimHayward/BreadCrumb
```

**Category**: Productivity

**Language**: English (United Kingdom)

**Privacy policy URL**

```
https://github.com/TimHayward/BreadCrumb/blob/main/docs/PRIVACY.md
```

**Website**

```
https://github.com/TimHayward/BreadCrumb
```

**Support contact**

```
https://github.com/TimHayward/BreadCrumb/issues
```

**Store logo**: `docs/store/logo-300.png` (300 x 300 PNG)

**Screenshots** (1280 x 800 PNG)

| File | Caption to type |
|---|---|
| `docs/store/screenshot-1.png` | Find where a cited file actually lives |
| `docs/store/screenshot-2.png` | A link from Teams or email works too |
| `docs/store/screenshot-3.png` | Everything you have resolved, kept on your device |

## Properties: single purpose

```
BreadCrumb has one purpose: to show where a SharePoint or OneDrive for Business file is located. It takes a file link, either one cited in a Microsoft Copilot answer or one the user pastes, and resolves it to the folder that file sits in, which the user can then copy or record. Every feature serves that purpose: the popup lists the locations, the history page keeps the ones already found, and the Obsidian output writes them into the user's own notes.
```

## Privacy: permission justifications

One per permission, where Partner Center asks why the extension needs it.

**storage**

```
Stores the user's own settings (tenant name, Obsidian note path and vault folder name) and the local history of file locations already resolved, so a folder found once does not have to be found again. All of it stays in the browser profile; none of it is transmitted anywhere.
```

**clipboardWrite**

```
The product's main action is putting a file link or a folder link on the clipboard. This permission is what the Copy buttons in the popup and on the history page use.
```

**host permission: the three Copilot hosts**
(`https://m365.cloud.microsoft/*`, `https://copilot.cloud.microsoft/*`, `https://copilot.microsoft.com/*`)

```
These are the Microsoft Copilot pages BreadCrumb works on. A content script reads the SharePoint and OneDrive file links cited in the answer on screen so the extension can resolve them to folder locations. It reads only those file links: not the prompt, not the answer text, and nothing else on the page. No other site is matched.
```

**optional host permission: https://\*.sharepoint.com/\***

```
Optional and requested at runtime, never at install. If the user grants it on the options page for their own tenant, BreadCrumb calls that tenant's own SharePoint API (https://<tenant>.sharepoint.com/_api/v2.0/shares/.../driveItem) to confirm exactly where a file lives, using the Microsoft 365 session the browser already has. The extension does not read cookie values and does not request the cookies permission. Without this grant the extension still works, showing locations decoded from the link alone; confirmation is what the grant adds. It is a wildcard because SharePoint tenant hostnames are specific to each organisation and unknowable in advance; each user grants only their own.
```

## Privacy: remote code

```
No remote code. All code is included in the package. There are no remotely hosted scripts, no CDN references, no eval and no dynamically fetched or generated code. The only network requests the extension makes are JSON requests to the user's own SharePoint host.
```

## Privacy: data collection and use

- Personally identifiable information collected: **none**.
- Data transmitted to the developer or a third party: **none**. There is no
  server, no telemetry and no analytics.
- Personal or sensitive user data handled: **file names and folder paths from
  the user's own tenant**, read in order to display them. They stay on the
  device, in the browser profile and, if the user chooses, in a file in their
  own Obsidian vault.
- Data is not sold, not shared, and not used for anything beyond the single
  purpose above.
- Certification: the extension's data handling matches the published privacy
  policy at the URL above.

## Notes for certification (store policy: testability)

```
BreadCrumb can be tested without a Microsoft 365 tenant.

No account or credentials are needed to see what the extension does:

1. Install, then click the BreadCrumb toolbar button on any ordinary web page.
   The popup shows the "Paste a link to find its folder" view.
2. Click "Paste a link" and paste this example:
   https://contoso.sharepoint.com/sites/Finance/Shared%20Documents/2026/Quarterly%20Review.docx
3. Press Convert. BreadCrumb decodes the link in the browser and lists the
   document with its readable folder path, the folder link, and its confidence
   state. The Copy buttons put those links on the clipboard.
4. Click "History" in the popup to see the result recorded, searchable,
   exportable and deletable.

That path exercises the product and needs no sign-in, because decoding happens
locally in the browser.

Confirming a location against a live tenant is the one part that needs a
Microsoft 365 work or school account, because it uses the browser's existing
SharePoint session. It is optional: the extension asks for access to
https://*.sharepoint.com/* only when a user grants it on the options page for
their own organisation, and everything above works without it. A reviewer with
a work or school account can enable it by signing in to that tenant's
SharePoint in a tab and granting access on the options page. No credentials
from the developer are involved at any point.

The extension has no login of its own and no paid tier.
```

## Policy checks

| Policy | How BreadCrumb meets it |
|---|---|
| Single purpose | Stated above; every surface serves it. |
| Minimum permissions | Two API permissions, three host permissions matching the pages it works on, and the SharePoint one optional and per-tenant. |
| No obfuscated code | Bundled by esbuild, minification off; source is public. |
| Remote code | None. |
| Testable by the reviewer | The certification notes give a credential-free test path. |
| No other browser named in metadata | The listing text names no browser but Microsoft Edge's own store context. |
| Dependencies on other software disclosed | The Obsidian output needs Obsidian, and the listing says so and says it is optional. |
| Content and imagery | Screenshots are the real built UI with a fictional `contoso` tenant; no real tenant data appears. |
