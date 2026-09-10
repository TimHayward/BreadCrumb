# M3 tenant run checklist

The authenticated validation code (BC-036 to BC-041) is complete and covered by tests that replay hand-written Graph responses. What remains needs a real Entra tenant, so it is a checklist for the person with the test tenant. Record what you see in the table at the end; that evidence closes spikes S2 and S5 and the four open M3 stories.

## Set up (once)

1. Register the public client as described in `README.md` under "Authenticated validation". Redirect URI is the exact origin you will open, with a trailing slash.
2. Set `AUTH_TENANT_ID` and `AUTH_CLIENT_ID` in the Portainer stack (or a local `.env`), redeploy, and check the log line `authenticated validation configured`.
3. Create a few test files in the tenant: one in a normal library under `/sites/<Site>/<Lib>/<Folder>/`, one in a library whose name differs from its URL segment (for example the default library, shown as "Documents" but living at `Shared Documents`), one in a subsite, and one in a OneDrive for Business folder. Make a sharing link (`/:x:/s/…`) for one of them and, if the tenant still emits them, a `/:x:/g/…` or `/:x:/t/…` link.

## BC-036 sign in

- [ ] Before signing in, convert a link: the page works exactly as before, and the only difference is the "Sign in to Microsoft" control in the header.
- [ ] Sign in. The header shows "Signed in as …". In the browser's developer tools, Application → Session Storage holds the MSAL entries; Local Storage and cookies do not. No request to the BreadCrumb server carries the token (check the Network tab: only `graph.microsoft.com` receives `Authorization`).
- [ ] Close the tab and open the site again: signed out (session storage is gone).
- [ ] Sign out with the header button: the account label disappears and every "Validate with Microsoft Graph" button is hidden again.

## BC-037 validate a path

- [ ] Convert a direct file URL whose library boundary the parser marks Inferred (any `/sites/…/Lib/Folder/File.ext` link). Validate. Expect the Verified badge, "upgraded from Inferred", every component marked "confirmed", and "was inferred as …" beneath any component Graph corrected.
- [ ] Convert the subsite file. Validate. Expect the site path corrected to the subsite and the library corrected; both shown as "was inferred as".
- [ ] Convert a `/:w:/r/…` copy link with a `d=` parameter. Validate. Expect the document id check line, ideally "matches".
- [ ] Convert a link to a file that does not exist. Validate. Expect "Graph could not find the item" and the state unchanged.
- [ ] (S2, personal site) Convert the OneDrive for Business direct link. Validate. Record whether `/sites/{host}:/personal/{alias}` resolves.

## BC-038 resolve a sharing token

- [ ] Convert the `/:x:/s/…` link (Unresolved). Validate. Expect a Verified path, folder URL and file URL taken from the returned item.
- [ ] Repeat for `/g/` and `/t/` links if you have them, and for a link created by another user.
- [ ] Repeat with a legacy `guestaccess.aspx` link if the tenant still has one.

## BC-041 errors

- [ ] Remove admin consent (or use an account that has not consented) and validate: the message names `Files.Read.All` / `Sites.Read.All` and says an administrator may need to grant consent. State unchanged.
- [ ] Wait past token expiry (or clear the MSAL entries in session storage, keeping the account) and validate: you are prompted to sign in again.
- [ ] Throttling is hard to provoke; if a 429 appears, check the button shows "Retry in Ns" and re-enables.

## Spikes

| Spike | Question | Observed |
|---|---|---|
| S2 | `/shares` resolves `/s/`, `/g/`, `/t/`, `-my` tokens and guest access? Minimum delegated permission that worked, smallest set that failed? Token from another user? Personal site by path? | |
| S5 | A way to resolve a `sourcedoc` / `UniqueId` GUID to a driveItem? (Try `GET /sites/{siteId}/lists/{listId}/items?$filter=…` or search; record the exact call or a written conclusion that it cannot be done.) | |

## Closing

Run `node scripts/complete-story.mjs --sha <commit> BC-036 BC-037 BC-038 BC-041` (and BC-039 if S5 found a method that was then implemented), add the recording or screenshots of one Derived, one Inferred and one Unresolved validation with before and after states under `docs/evidence/m3/`, and move S2 and S5 with their findings.
