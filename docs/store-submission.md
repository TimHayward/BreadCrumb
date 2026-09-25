# Edge Add-ons submission

Every answer Partner Center asks for, in the order the dashboard asks for it, so
it can be pasted straight in. The section headings match the pages in the left
hand navigation.

Source:
[Publish a Microsoft Edge extension](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension)
and the
[developer policies](https://learn.microsoft.com/en-us/legal/microsoft-edge/extensions/developer-policies).

> Partner Center warns that anything incomplete, misleading or inaccurate on the
> Privacy page counts as a policy violation and can delay or fail certification.
> Every answer below is written to be literally true of the code as built.

---

## Packages

Upload `release/breadcrumb-extension-<version>.zip`, built with `pnpm build` and
zipped with `node scripts/package-extension.mjs`.

The package is Manifest V3, has no background service worker, and contains 14
files, every one of them named by the manifest. `name` and `description` are read
out of the manifest and become the extension name and short description in the
listing; neither can be edited in Partner Center.

---

## Availability

- **Visibility**: `Public`.
- **Markets**: all, which is the default and includes markets added later.

---

## Properties

| Field | Answer |
|---|---|
| Category | Productivity |
| Website | `https://github.com/TimHayward/BreadCrumb` |
| Support contact detail | `https://github.com/TimHayward/BreadCrumb/issues` |
| Mature content | Leave unticked |

The privacy policy URL is **not** on this page. It is the last section of the
Privacy page.

---

## Privacy

Five sections, in this order.

### 1. Single Purpose Description

```
BreadCrumb has one purpose: to show where a SharePoint or OneDrive for Business file is located. It takes a file link, either one cited in a Microsoft Copilot answer or one the user pastes into the popup, and resolves it to the folder that file sits in, which the user can then copy or record. Every feature serves that purpose: the popup lists the locations, the history page keeps the ones already found, and the optional Obsidian output writes them into the user's own notes.
```

### 2. Permission justification

Partner Center lists the permissions it found in the manifest and gives each one
a text box. Five boxes are expected.

**`storage`**

```
Stores the user's own settings (tenant name, Obsidian note path and vault folder name) and the local history of file locations already resolved, so a folder found once does not have to be found again. All of it stays in the browser profile; none of it is transmitted anywhere.
```

**`clipboardWrite`**

```
The extension's main action is putting a file link or a folder link on the clipboard. This permission is what the Copy buttons in the popup and on the history page use.
```

**`https://m365.cloud.microsoft/*`**, **`https://copilot.cloud.microsoft/*`**, **`https://copilot.microsoft.com/*`**

Same text in each of the three boxes:

```
This is one of the three Microsoft Copilot pages BreadCrumb works on. A content script reads the SharePoint and OneDrive for Business file links cited in the answer on screen, so the extension can resolve them to folder locations. It reads only those file links: not the prompt, not the answer text, and nothing else on the page. No other site is matched.
```

**`https://*.sharepoint.com/*`** (this is declared as `optional_host_permissions`, so it may appear in its own box or not at all; if there is no box for it, say this in the Notes for certification instead)

```
Optional and requested at runtime, never at install. If the user grants it on the options page for their own tenant, BreadCrumb calls that tenant's own SharePoint API (https://<tenant>.sharepoint.com/_api/v2.0/shares/.../driveItem) to confirm exactly where a file lives, using the Microsoft 365 session the browser already has. The extension does not read cookie values and does not request the cookies permission. Without this grant the extension still works, showing locations decoded from the link alone; confirmation is what the grant adds. It is a wildcard because SharePoint tenant hostnames are specific to each organisation and cannot be known in advance; each user grants only their own.
```

### 3. Are you using remote code?

This is a pair of option buttons, not a text box.

**Select: `No, I am not using remote code`**

Verified against the built bundles: every `<script>` and `<link>` in the three
HTML pages is a relative path to a packaged file, there is no `eval`, no
`new Function` and no dynamic `import()`, no `@import` or `url()` in the CSS, and
no `content_security_policy` or `web_accessible_resources` in the manifest. The
only absolute URLs in the bundles are the SVG namespace string, a bare `https://`
used for building a URL, and the `contoso.sharepoint.com` example placeholder.
The SharePoint calls fetch JSON, which is parsed as data and never executed.

### 4. Data usage

Two sets of checkboxes.

**"What user data do you plan to collect from users now or in the future?"**

| Checkbox | Tick? | Why |
|---|---|---|
| Personally identifiable information | No | BreadCrumb does not gather anyone's identity. See the note below on OneDrive paths. |
| Health information | No | Never touched. |
| Financial and payment information | No | Never touched. No payments, no paid tier. |
| Authentication information | No | No password, token or cookie value is ever read. The browser attaches the SharePoint session itself; the extension does not request the `cookies` permission and cannot see credentials. |
| Personal communications | No | The content script reads file links only. It does not read the prompt, the answer text, or any message. |
| Location | No | No geolocation, no IP handling. |
| Web history | No | The local history holds file links the user resolved, not pages the user visited. Nothing records browsing. |
| User activity | No | No click, scroll, keystroke or network monitoring of any kind. |
| **Website content** | **Yes** | This one is accurate and must be ticked. The content script reads hyperlinks from the Copilot page, and "hyperlinks" is named in this category. |

**"I certify that the following disclosures are true"**

Tick all of them. Each is true: BreadCrumb does not sell user data, does not
transfer it for any purpose unrelated to its single purpose, does not use it to
determine creditworthiness or for lending, and its handling matches the privacy
policy below.

**The one judgement call, so it is not a surprise if a reviewer raises it.**
A OneDrive for Business path contains the account name, for example
`/personal/ada_contoso_com/Documents/...`, which is an email address in another
form. BreadCrumb displays and stores that path because it *is* the file's
location, not to identify anyone, and it never leaves the device. That is why
"Personally identifiable information" is not ticked: the category asks what the
extension collects *from users*, and BreadCrumb collects no identity. The
privacy policy says this explicitly so the two are consistent.

### 5. Privacy Policy URL

```
https://github.com/TimHayward/BreadCrumb/blob/main/docs/PRIVACY.md
```

Checked: returns HTTP 200 publicly, signed out.

---

## Store listings

One row per language in the package. BreadCrumb has no `_locales` folder, so
there is a single row.

| Field | Answer |
|---|---|
| Extension name | Read from the manifest: `BreadCrumb`. Read-only here. |
| Short description | Read from the manifest, 96 characters. Read-only here; to change it, change the manifest and re-upload. |
| Description | The block below. 2,501 characters, against a minimum of 250 and a maximum of 10,000. |
| Extension logo | `docs/store/logo-300.png`, 300 x 300, which is the recommended size. |
| Screenshots | `docs/store/screenshot-1.png`, `-2.png`, `-3.png`. All 1280 x 800, one of the two permitted sizes. Up to six are allowed. There is no caption field: each image carries its own wording. |
| Small promotional tile | Optional, 440 x 280. Not supplied. |
| Large promotional tile | Optional, 1400 x 560. Not supplied. |
| YouTube video URL | Not supplied. |
| Search terms | Below. Not shown to users. |

There is a **Generate with AI** button under the Description box. Do not use it:
the description below is written to be accurate, and an AI-generated one would
have to be checked line by line against the code anyway.

**Description** (paste as-is; names no browser other than the store's own)

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

**Search terms** (maximum seven terms, 21 words in total, 30 characters each)

```
SharePoint
OneDrive
Copilot
file location
folder path
Microsoft 365
Obsidian
```

---

## Submit: Notes for certification

The **Submit your extension** page asks two things.

### "Does a tester need credentials, accounts, or any other info to test your extension?"

**Select: `Yes, I need to provide credentials, accounts, or other info for testers`**

Not because of credentials. There are none, and there is no test account to
supply. Select Yes because choosing No greys the notes box out and fills it with
"No Certification Notes required", and BreadCrumb genuinely has information a
tester needs: its citation reading is conditional on the tester's own Microsoft
365 account, and the optional note output depends on another product. Those are
two of the three examples the page itself gives.

### Notes for certification (under 2,000 characters)

The text below is 1985 characters. Partner Center warns that a submission with
no certification notes may be flagged or failed, so this goes in every time,
including on updates.

```
No credentials are needed and there is no test account to supply. The information below is the "other info" a tester needs, because some functionality is conditional on the tester's own Microsoft 365 account.

TESTING WITH NO ACCOUNT AT ALL

1. Install, then click the BreadCrumb toolbar button on any ordinary web page. The popup shows the "Paste a link to find its folder" view.
2. Click "Paste a link" and paste this example:
https://contoso.sharepoint.com/sites/Finance/Shared%20Documents/2026/Quarterly%20Review.docx
3. Press Convert. BreadCrumb decodes the link locally and lists the document with its readable folder path, the folder link and a confidence state. The Copy buttons put those links on the clipboard.
4. Click "History" in the popup to see the result recorded, and to search, export and delete it.

That needs no sign-in and makes no network request: decoding happens in the browser.

CONDITIONAL FUNCTIONALITY

Reading citations automatically requires the tester to be signed in to a Microsoft 365 work or school account and viewing a Microsoft Copilot answer that cites SharePoint or OneDrive for Business files. Without that, the popup shows the paste view above, which exercises the same resolution code.

Confirming a location against a live tenant is optional. The extension declares https://*.sharepoint.com/* as an OPTIONAL host permission and requests it only when a user grants it, on the options page, for their own organisation's hostname. Everything above works without it. A tester with such an account can enable it by signing in to that tenant's SharePoint in a tab, then granting access on the options page.

DEPENDENCIES ON OTHER PRODUCTS

Microsoft 365 work or school, for the two features above.
Obsidian, only for the optional "send to note" action, which appends a Markdown table row to a note in a vault folder the user picks. Nothing else depends on it.

The extension has no login of its own, no paid tier, and no hidden or locked features.
```

---

## Policy checks

| Policy | How BreadCrumb meets it |
|---|---|
| Single purpose | Stated on the Privacy page; every surface serves it. |
| Minimum permissions | Two API permissions, three host permissions matching exactly the pages it works on, and the SharePoint one optional and granted per tenant at runtime. |
| No obfuscated code | Bundled by esbuild with minification off; comments intact; source public. |
| No remote code | Verified against the built bundles, not just the source. |
| Testable by the reviewer | The notes above give a path needing no account. |
| Accurate privacy disclosures | Each data-usage checkbox reasoned through above, and the privacy policy says the same things. |
| No other browser named in metadata | The listing text names none. |
| Dependencies on other software disclosed | The Obsidian output needs Obsidian, and the description says so and says it is optional. |
| Content and imagery | Screenshots are the real built UI against a fictional `contoso` tenant. No real tenant data appears. |
