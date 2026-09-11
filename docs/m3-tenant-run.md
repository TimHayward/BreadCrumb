# M3 tenant run

The authenticated validation code (BC-036 to BC-041) is complete and covered by tests that replay hand-written Graph responses. Token sharing links (`/:x:/s/…`, `/g/`, `/t/`, guest access) resolve automatically once a user is signed in, and the history page can validate every Unresolved entry in one action. What remains needs a real Entra tenant. This document is the protocol for doing that interactively (the user drives the browser and reports; the developer fixes code on `main` as findings arrive) and the record of what was observed. Its tables close spikes S2 and S5 and the open M3 stories.

## B0. Set up (once)

1. Entra admin centre → App registrations → New registration: single tenant, no client secret.
2. Authentication → Add a platform → **Single-page application** → redirect URI `http://localhost:3000/` (add `http://<LAN IP>:3000/` later for the Portainer stack).
3. API permissions → Add → Microsoft Graph → Delegated → `Files.Read.All`, `Sites.Read.All`. Grant admin consent if you can; otherwise each user consents on first sign in.
4. Note the Directory (tenant) ID and Application (client) ID.
5. Start the application locally with both set (PowerShell):
   ```powershell
   $env:AUTH_TENANT_ID = '<tenant guid>'; $env:AUTH_CLIENT_ID = '<client guid>'; pnpm dev
   ```
   The log shows `authenticated validation configured`. Open `http://localhost:3000/`.
   For a diagnosed run add `$env:CLIENT_LOG = 'true'` before `pnpm dev`: the browser then posts its sign in, MSAL and Graph events to the server log, so nobody needs the browser console.

   Troubleshooting sign in:
   - **AADSTS9002326** ("Cross-origin token redemption is permitted only for the 'Single-Page Application' client-type"): the redirect URI is registered under the Web platform. Remove it there and add it under Single-page application (or move it from `web.redirectUris` to `spa.redirectUris` in the manifest).
   - **Popup opens and closes but nothing happens**: an old `validate.js` may be cached; press Ctrl+Shift+R once.
6. In the browser console run `localStorage.setItem('breadcrumb:debug', '1')` so every Graph request and response is logged. Those logs, anonymised, become the replay fixtures under `packages/app/test/fixtures/graph/`.
7. Have test files ready: one in a normal library under `/sites/<Site>/<Lib>/<Folder>/`, one in the default library ("Documents" shown, `Shared Documents` in the URL), one in a subsite, one in OneDrive for Business. Make a `/:x:/s/` sharing link for one, plus `/g/` and `/t/` links if the tenant emits them, and a link created by another user.

## B1. Sign in (BC-036)

- [ ] Before signing in, convert a link: the page behaves exactly as before; the header's "Sign in to Microsoft" is the only difference.
- [ ] Sign in. Header shows "Signed in as …". DevTools → Application → Session Storage holds the MSAL entries; Local Storage and cookies do not. Network tab: only `graph.microsoft.com` requests carry `Authorization`.
- [ ] Close the tab, open the site again: signed out.
- [ ] Sign out with the header button: account label gone, validate controls hidden.

## B2. Token links (BC-038, spike S2)

- [ ] Convert the `/:x:/s/` link. Expected: "Sharing link detected: resolving…", then the page reloads Verified with the path, folder URL and file URL.
- [ ] If it fails with 403: the debug log shows whether `prefer: redeemSharingLink` was sent (it should be). If the message names the permissions, consent is missing. Then try the smallest scope set: restart with `AUTH_SCOPES=Files.Read.All` and repeat.
- [ ] Repeat for `/g/`, `/t/`, a `-my` personal token, a link created by another user, and `guestaccess.aspx` if one exists.

| Link variant | Result (state, HTTP status on `/shares`) | Scopes in use | Notes |
|---|---|---|---|
| `/:x:/s/SiteA/…` | | | |
| `/:x:/g/personal/…` on `-my` | | | |
| `/:x:/t/SiteA/…` | | | |
| Token created by another user | | | |
| `guestaccess.aspx` | | | |
| Smallest scope set that worked | | | |
| Smallest scope set that failed | | | |
| Was `Prefer: redeemSharingLink` needed? | | | |

## B3. Path links (BC-037)

- [ ] Direct file URL with an Inferred library: Validate → Verified, every component "confirmed", "was inferred as" where Graph corrected something.
- [ ] File in a subsite: the validator tries deeper site paths; expect the site path and library corrected.
- [ ] `/:w:/r/…` copy link with `d=`: the document id check line appears.
- [ ] A file that does not exist: "could not find the item", state unchanged.
- [ ] OneDrive for Business direct URL (S2: does `/sites/{host}:/personal/{alias}` resolve by path?). Record below.

| Case | Observed |
|---|---|
| Personal site resolves by path | |
| Subsite retry needed and worked | |
| 403 fallback through `/shares` used | |

## B4. Validate all (BC-038, extension submissions)

- [ ] Submit two token links through the API with `source: extension` (the extension popup, or `curl -X POST http://localhost:3000/api/convert -H 'content-type: application/json' -d '{"link":"…","source":"extension"}'`).
- [ ] Open History signed in → "Validate all Unresolved" → progress line → reload shows them Verified with "upgraded from Unresolved".

## B5. Document ids (spike S5, BC-039)

With a `sourcedoc` GUID from a `Doc.aspx` link to one of the test files, and the site id from B2's debug log, try in the browser console with the same bearer token (copy it from a Graph request in the Network tab; it lives only in this session):

1. `GET https://graph.microsoft.com/v1.0/sites/{siteId}/lists?$select=id,name,system`
2. `GET https://graph.microsoft.com/v1.0/sites/{siteId}/lists/{listId}/items/{guid}/driveItem`
3. If 2 fails: `POST https://graph.microsoft.com/v1.0/search/query` with `{"requests":[{"entityTypes":["driveItem"],"query":{"queryString":"{guid}"}}]}`

| Attempt | Status and shape | Conclusion |
|---|---|---|
| lists → items/{guid}/driveItem | | |
| search/query | | |

If a call works, it is implemented in `graphValidation.ts` for forms `doc-aspx` and `layouts-unique-id` with a replay fixture, and BC-039 closes. Otherwise the written conclusion here closes S5 and the forms stay Unresolved in v1.

## B6. Errors (BC-041)

- [ ] Account without consent (or consent revoked): message names `Files.Read.All` / `Sites.Read.All` and the administrator; state unchanged.
- [ ] Expired sign in: clear the MSAL entries in Session Storage but keep the page open, validate: prompted to sign in again.
- [ ] Throttling only if it happens: button shows "Retry in Ns".

## B7. Close out

1. Anonymise the logged Graph responses (tenant → `contoso`, sites → `SiteA`/`SiteB`, GUIDs regenerated, names neutral) and replace the hand-written fixtures.
2. Set the `AUTH_SCOPES` default and the README to the proven minimum.
3. Evidence under `docs/evidence/m3/`: one Derived, one Inferred and one Unresolved validation with before and after.
4. `node scripts/complete-story.mjs --sha <commit> BC-036 BC-037 BC-038 BC-041` (and BC-039), move S2 and S5 with the findings above.
5. Add `http://<LAN IP>:3000/` to the registration's redirect URIs before the Portainer rehearsal (BC-003).
