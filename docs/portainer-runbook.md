# Portainer runbook (spike S7, story BC-003)

This is the exact click path for deploying BreadCrumb as a Portainer Git stack, followed by the observations spike S7 needs. Fill in the observation table when the rehearsal has been done on the real Portainer host; that closes S7, BC-003 and the Portainer path of BC-004.

## Before you start

- The Portainer host has outbound access to `github.com` and can build images (Docker standalone environment; Portainer builds from the repository when the compose file uses `build:`).
- Decide the private interface address the application should listen on, for example `192.168.1.20`. It must not be a public interface (backlog risks R4, R5).
- The application is reachable with no authentication. Confirm the network is the boundary.

## Create the stack

1. Portainer → **Environments** → pick the host → **Stacks** → **Add stack**.
2. **Name:** `breadcrumb`.
3. **Build method:** **Repository**.
4. **Repository URL:** `https://github.com/TimHayward/BreadCrumb`.
5. **Repository reference:** `refs/heads/main`.
6. **Compose path:** `compose.yaml`.
7. **Authentication:** off for a public repository. For a private repository, enable it and use a fine-grained personal access token with read access to the repository only. Note whether Portainer stored it (observation 4).
8. **Environment variables** (Advanced mode is easiest, one per line):
   ```
   BREADCRUMB_BIND=192.168.1.20
   BREADCRUMB_PUBLISH_PORT=3000
   LOG_LEVEL=info
   LOG_REDACT_LINKS=false
   ```
   Nothing else is needed. Do not edit the compose file; the same file must work unchanged locally and here (invariant 13).
9. **GitOps updates:** leave off for v1. Redeploys are manual.
10. **Deploy the stack.** The first deploy builds the image and takes a few minutes.

## Verify the deployment

1. **Stacks → breadcrumb** shows one container `breadcrumb-breadcrumb-1` with state **healthy** (the compose health check calls `/healthz`).
2. Open `http://192.168.1.20:3000/healthz` from another machine on the private network. Expect `{"status":"ok","database":"/data/breadcrumb.sqlite"}`.
3. Open `http://192.168.1.20:3000/`, paste the worked example from `docs/worked-example.md`, convert. Expect the Derived badge and the expected path, folder URL and file URL.
4. Open **History**. The conversion is listed. Note its entry number and timestamp.
5. **Volumes** lists `breadcrumb_breadcrumb-data`. Open it: it is a named volume, not a bind mount, and the Browse view (if the host has the volume browser) shows `breadcrumb.sqlite`, `breadcrumb.sqlite-wal` and `breadcrumb.sqlite-shm`.

## Rehearse a redeploy (BC-003, BC-004 Portainer path)

1. Push any commit to `main`.
2. **Stacks → breadcrumb → Editor / Git → Pull and redeploy** (leave "Re-pull image" off; the image is built, not pulled).
3. Wait for the container to be healthy again. Confirm it is a new container (the start time changed).
4. Open **History**. The entry from before the redeploy is present with the same timestamp and values.

## Rehearse stack removal (BC-004)

1. **Stacks → breadcrumb → Delete this stack**. Portainer asks whether to remove volumes: **do not** tick it. Record what the dialogue offered (observation 2).
2. **Volumes**: `breadcrumb_breadcrumb-data` is still present.
3. Re-create the stack with the same name and settings as above. The history entry is present again.

## Observations to record (closes S7)

| # | Question | Observed |
|---|---|---|
| 1 | How are environment variables supplied to a Git stack, and do they survive "Pull and redeploy"? | |
| 2 | Does "Pull and redeploy" preserve the named volume? Does deleting the stack offer to keep volumes, and does keeping them work? | |
| 3 | Does the stack build the image from the repository, and how long does the first build take on this host? | |
| 4 | Does a private repository need stored credentials, and where does Portainer keep them? | |
| 5 | Anything in the compose file that Portainer rejected or warned about. | |

When the table is filled in, move S7 and BC-003 to `BACKLOG-completed.md` with the commit that records the observations, and add the screenshots for the M1 boundary under `docs/evidence/m1/`.
