# HTTPS from a private certificate authority (decision D6)

Microsoft sign in only accepts `https://` redirect URIs (plain `http://` is allowed for `localhost` alone), and the browser features MSAL needs are only available on secure pages. So BreadCrumb must be served over HTTPS for sign in to work anywhere other than the machine it runs on. It also lets the Copilot extension reach the API from other machines without mixed content warnings.

BreadCrumb serves HTTPS itself: no reverse proxy or extra service. It reads a certificate and key from the named volume `breadcrumb-tls` when `TLS_CERT_FILE` and `TLS_KEY_FILE` are set. The certificate comes from a small private certificate authority (CA) whose root is installed on the team's devices.

## 1. Choose the name people will type

Pick a host name for the server, for example `breadcrumb.home.arpa` (`home.arpa` is reserved for home and private networks), and make it resolve to the server's private address:

- on the router's local DNS, or
- in each device's hosts file (`C:\Windows\System32\drivers\etc\hosts`): `192.168.1.20  breadcrumb.home.arpa`.

## 2. Create the CA and a certificate (once, on your admin machine)

Using [mkcert](https://github.com/FiloSottile/mkcert):

```powershell
winget install FiloSottile.mkcert
mkcert -install                                    # creates the CA and trusts it on this machine
mkcert -cert-file cert.pem -key-file key.pem breadcrumb.home.arpa 192.168.1.20 localhost
mkcert -CAROOT                                     # folder holding rootCA.pem and rootCA-key.pem
```

Keep `rootCA-key.pem` private and off the server: anyone holding it can mint certificates your devices trust. Only `rootCA.pem` is shared.

## 3. Trust the CA on every device that uses BreadCrumb

Chrome and Edge on Windows use the Windows certificate store:

```powershell
certutil -addstore -user Root rootCA.pem           # current user; use an elevated prompt without -user for the machine
```

For many devices, push `rootCA.pem` to "Trusted Root Certification Authorities" with Group Policy or Intune instead. Firefox keeps its own store unless `security.enterprise_roots.enabled` is on.

## 4. Put the certificate on the server

Copy both files into the stack's `breadcrumb-tls` volume (the prefix is the stack or project name, `breadcrumb` under Portainer):

```sh
docker run --rm -v breadcrumb_breadcrumb-tls:/tls -v "$PWD":/src alpine sh -c "cp /src/cert.pem /src/key.pem /tls/ && chmod 644 /tls/cert.pem /tls/key.pem"
```

Then set these environment variables on the stack and redeploy:

```
TLS_CERT_FILE=/tls/cert.pem
TLS_KEY_FILE=/tls/key.pem
BREADCRUMB_BIND=192.168.1.20
```

The log line `serving HTTPS` confirms it. The container health check switches to HTTPS on its own.

## 5. Point sign in and the extension at the new address

- Entra admin centre → your app registration → Authentication → Single-page application → add `https://breadcrumb.home.arpa:3000/` (keep `http://localhost:3000/` for local development).
- Stack environment: `AUTH_TENANT_ID` and `AUTH_CLIENT_ID` as for the local run.
- Extension options: API base URL `https://breadcrumb.home.arpa:3000`.

## 6. Check it

```sh
curl --cacert rootCA.pem https://breadcrumb.home.arpa:3000/healthz
```

Open `https://breadcrumb.home.arpa:3000/` in Edge or Chrome on another device: no certificate warning, and "Sign in to Microsoft" completes.

## Renewal

mkcert certificates last a little over two years. Re-run step 2's second command, copy the new files into the volume (step 4) and restart the stack. The CA itself lasts ten years.

## Local development over HTTPS

```powershell
mkcert -cert-file .\data\cert.pem -key-file .\data\key.pem localhost 127.0.0.1
$env:TLS_CERT_FILE = "$PWD\data\cert.pem"; $env:TLS_KEY_FILE = "$PWD\data\key.pem"; pnpm dev
```

`data/` is git-ignored, so the files never reach the repository.
