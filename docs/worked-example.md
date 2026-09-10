# Worked example

This is the single link that is retained verbatim in the repository. The brief already publishes it, so it is the one exception to the anonymisation rule in `BACKLOG.md` section 8. It is the canonical fixture for link form matrix row 1 (BC-007, BC-009, BC-023) and the conversion demonstrated at the M1 boundary.

## Input

```
https://848.sharepoint.com/sites/848Technical/Projects/Forms/AllItems.aspx?id=%2Fsites%2F848Technical%2FProjects%2FProjects%20WIP%2FDeloitte%2FDeloitte%20%2D%20Digital%20Development%20Environment%2FSMR%20SIID%20029%20%2D%20Development%20Environment%20for%20Digital%20team%2Epdf&parent=%2Fsites%2F848Technical%2FProjects%2FProjects%20WIP%2FDeloitte%2FDeloitte%20%2D%20Digital%20Development%20Environment
```

## Expected output

State: **Derived**. Form: `library-view`. The library is Derived because the decoded `id` starts with `/sites/848Technical/Projects/`, the library segment taken from the page path before `/Forms/`.

| Field | Value |
|---|---|
| Path | `/sites/848Technical/Projects/Projects WIP/Deloitte/Deloitte - Digital Development Environment/SMR SIID 029 - Development Environment for Digital team.pdf` |
| Folder URL | `https://848.sharepoint.com/sites/848Technical/Projects/Projects%20WIP/Deloitte/Deloitte%20-%20Digital%20Development%20Environment` |
| File URL | `https://848.sharepoint.com/sites/848Technical/Projects/Projects%20WIP/Deloitte/Deloitte%20-%20Digital%20Development%20Environment/SMR%20SIID%20029%20-%20Development%20Environment%20for%20Digital%20team.pdf` |

| Component | Value | Flag |
|---|---|---|
| Tenant | `848` | Derived |
| Host | `848.sharepoint.com` | Derived |
| Site path | `/sites/848Technical` | Derived |
| Document library | `Projects` | Derived (from page path) |
| Folder chain | `Projects WIP` → `Deloitte` → `Deloitte - Digital Development Environment` | Derived |
| File name | `SMR SIID 029 - Development Environment for Digital team.pdf` | Derived |

The `parent` parameter decodes to `/sites/848Technical/Projects/Projects WIP/Deloitte/Deloitte - Digital Development Environment`, which is the parent of `id` and confirms the folder.
