# The Obsidian note BreadCrumb writes

BreadCrumb appends one row per document to a Markdown table in a note in your vault (story BC-068, decisions D12, D19 and D26). The note is ordinary Markdown: you can read, edit, move and keep it with no BreadCrumb involved.

## Where it writes

- **Vault folder:** chosen once on the extension's options page. The browser asks you to allow access, and BreadCrumb can then read and write that folder only.
- **Note path:** relative to the vault folder, `BreadCrumb/Document locations.md` by default. Missing folders are created, and `.md` is added if you leave it off.
- Nothing else in the vault is read or written, and nothing leaves the device.

## The table

| Column | Holds |
|---|---|
| Document name | The file name, or the folder name for a folder. |
| File path | The decoded, human readable path inside the site: `/sites/SiteA/Shared Documents/Folder/Report.pdf`. |
| Source URL | The link BreadCrumb was given, as Copilot cited it. |
| Folder URL | The address of the containing folder, which opens it in SharePoint. |
| Date processed | When the row was written, as local `YYYY-MM-DD HH:mm`. |

URLs are written bare rather than as Markdown links: Obsidian makes them clickable in reading view, and they stay selectable as text. A pipe in any value is escaped as `\|` and newlines become spaces, so a row can never break the table.

## What a new note looks like

```markdown
---
created: 2026-09-19
tags:
  - breadcrumb
---

## Document locations

| Document name | File path | Source URL | Folder URL | Date processed |
| --- | --- | --- | --- | --- |
| Report.pdf | /sites/SiteA/Shared Documents/Folder/Report.pdf | https://contoso.sharepoint.com/sites/SiteA/Lib/Folder/Report.pdf | https://contoso.sharepoint.com/sites/SiteA/Lib/Folder | 2026-09-19 14:05 |
```

## The rules it follows

- **Always appends.** A document sent twice gets two rows, told apart by their date. BreadCrumb never reads the existing rows to match, update or skip (decision D12), so it never rewrites anything you already have.
- **Creates what is missing.** No note: it is created with the front matter, heading and header above. A note with other content but no table: the heading and table are added at the end, and your content is left alone. A note that already has the table: rows go into it.
- **Refuses a table it does not recognise.** If the header row has been renamed or reordered, BreadCrumb writes nothing and says which columns it found. Point it at another note, or make the columns match.
- **Writes only on a button press** (decision D26). Nothing is written automatically.
- **Leaves out what it cannot describe.** A link that failed to convert, or one still Unresolved, has no location to record, so it is skipped and counted in the message.
- **Whole file at a time.** The note is read and written back in one step, so a failure leaves it untouched. Close the note in Obsidian, or expect Obsidian to reload it, if you are editing it at the same moment.
