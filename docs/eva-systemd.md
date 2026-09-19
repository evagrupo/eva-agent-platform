# EVA dedicated Linux server with systemd

This runbook installs the EVA Agent Platform from a source checkout at
`/opt/eva-agent-platform`. systemd supervises the compiled `bb-app` launcher;
the launcher supervises the co-located HTTP server and host daemon. The unit
starts prebuilt artifacts and never rebuilds during crash recovery.

The repository also provides a one-command source workflow for an interactive
or maintenance shell:

```bash
pnpm start:source
```

That command builds the required app, server, host-daemon, plugin, CLI, and
launcher artifacts, then starts the full stack. The systemd unit deliberately
does not call it.

For explicit, administrator-controlled Git backup and migration of agent
workspaces, see [EVA workspace Git synchronization](eva-workspace-sync.md).

## Install

The commands below assume a Debian-like Linux host with systemd, Node.js
22.19 or newer, pnpm 9.15, and the Codex CLI installed when Codex execution is
needed.

Create the dedicated account and install the checkout as a root-owned,
service-readable tree:

```bash
sudo groupadd --system eva-agent-platform
sudo useradd --system \
  --gid eva-agent-platform \
  --home-dir /var/lib/eva-agent-platform \
  --create-home \
  --shell /usr/sbin/nologin \
  eva-agent-platform
sudo git clone <trusted-eva-source-url> /opt/eva-agent-platform
sudo chown -R root:eva-agent-platform /opt/eva-agent-platform
sudo chmod -R u+rwX,g+rX,o-rwx /opt/eva-agent-platform
cd /opt/eva-agent-platform
sudo pnpm install --frozen-lockfile
sudo pnpm run build
```

If the account or checkout already exists, do not repeat the creation commands;
verify the account, ownership, Node.js version, and lockfile before building.

Install the root-only environment file. It is read by the systemd manager
before the process changes to the service user:

```bash
sudo install -d -o root -g root -m 0755 /etc/eva-agent-platform
sudo install -o root -g root -m 0600 \
  /opt/eva-agent-platform/deploy/systemd/eva-agent-platform.env.example \
  /etc/eva-agent-platform/eva-agent-platform.env
sudoedit /etc/eva-agent-platform/eva-agent-platform.env
sudo chown root:root /etc/eva-agent-platform/eva-agent-platform.env
sudo chmod 0600 /etc/eva-agent-platform/eva-agent-platform.env
```

Set a stable random `BB_AUTH_SECRET`, the first-boot owner email and password,
and the public `BB_EXTERNAL_URL`/`BB_APP_URL` when a reverse proxy is used.
Never commit this file, include it in a source archive, or put its values in a
shell command. Remove `BB_AUTH_OWNER_EMAIL` and `BB_AUTH_OWNER_PASSWORD` after
the first administrator has been created.

Install and enable the unit:

```bash
sudo install -o root -g root -m 0644 \
  /opt/eva-agent-platform/deploy/systemd/eva-agent-platform.service \
  /etc/systemd/system/eva-agent-platform.service
sudo systemctl daemon-reload
sudo systemctl enable --now eva-agent-platform.service
```

The first boot applies the bundled database migrations and performs the
controlled owner bootstrap. The unit creates `/var/lib/eva-agent-platform` via
`StateDirectory`; it is owned by the service account and is the configured
`BB_DATA_DIR`.

## Operate

```bash
sudo systemctl status --no-pager eva-agent-platform.service
sudo systemctl is-active eva-agent-platform.service
sudo journalctl -u eva-agent-platform.service -n 200 --no-pager
sudo journalctl -u eva-agent-platform.service -f
sudo systemctl restart eva-agent-platform.service
sudo systemctl stop eva-agent-platform.service
sudo systemctl start eva-agent-platform.service
```

The launcher also appends child stdout and stderr to:

```text
/var/lib/eva-agent-platform/logs/server-stdio.log
/var/lib/eva-agent-platform/logs/host-daemon-stdio.log
```

The web server listens on `0.0.0.0:38886`. The host-daemon local API remains
on `127.0.0.1:38887`; do not publish or firewall-open port `38887`. Expose
only the web port, or expose only the reverse proxy's HTTPS port when the
proxy is on the same machine.

The unit uses `PrivateTmp`, a private umask, `NoNewPrivileges`, kernel and
control-group read protections, SUID/SGID and realtime restrictions, and a
restricted address-family set. It intentionally does not use `ProtectHome`,
`ProtectSystem`, `PrivateUsers`, or a read-only machine filesystem: Codex
sessions, plugin data, provider processes, and authorized workspace paths must
remain usable by the dedicated user.

## Reverse proxy

Set `BB_EXTERNAL_URL` and `BB_APP_URL` to the same public HTTPS origin, then
proxy the web listener. A minimal nginx configuration uses the following
headers and keeps WebSocket upgrades alive:

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    '' close;
}

server {
    listen 443 ssl;
    server_name eva.example.com;

    location / {
        proxy_pass http://127.0.0.1:38886;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header Origin $http_origin;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_read_timeout 1h;
    }
}
```

Terminate TLS at the proxy, preserve the `Host` and `Origin` headers, and
allow only the proxy or the chosen HTTPS ingress through the firewall. Confirm
the local readiness endpoint after the proxy is configured:

```bash
curl --fail http://127.0.0.1:38886/readyz
```

## Internal mini-app links

Set `BB_MINI_APPS_PUBLIC_DOMAIN` to a dedicated subdomain below the public
origin, for example:

```text
BB_MINI_APPS_PUBLIC_DOMAIN=apps.eva.example.com
```

Use one Cloudflare Tunnel wildcard ingress to the EVA web listener. This is a
configuration example only; do not place tunnel credentials in the checkout:

```yaml
tunnel: eva-agent-platform
credentials-file: /etc/cloudflared/eva-agent-platform.json
ingress:
  - hostname: eva.example.com
    service: http://127.0.0.1:38886
  - hostname: "*.apps.eva.example.com"
    service: http://127.0.0.1:38886
  - service: http_status:404
```

Create the wildcard DNS route in the Cloudflare account so
`*.apps.eva.example.com` resolves to that tunnel. The tunnel and firewall must
reach only `127.0.0.1:38886`; never publish `38887` or an agent-selected host
port. If nginx is between the tunnel and EVA, preserve the original `Host` and
WebSocket `Upgrade` headers and use the reverse-proxy rule above. EVA uses the
original `Host` to select exactly one registered deployment label and does not
trust an arbitrary `X-Forwarded-Host` from a direct client. Restrict the web
listener so only the chosen proxy or tunnel can reach it.

The contract is intentionally registry-first rather than an arbitrary code
hosting API:

- An administrator registers a deployment through
  `POST /api/v1/mini-apps/deployments` with an app/deployment id and a
  loopback port. The port must be an explicit non-server, non-host-daemon
  allowlist entry. Unknown ids, raw ports, and the host-daemon port return a
  denial; the registry does not accept filesystem paths, commands, or source
  archives.
- A user or administrator creates a scoped link with
  `POST /api/v1/mini-apps/links`. Links are scoped to a user or group and can
  carry an EVA agent constraint. Group recipients mint their own handoff with
  `POST /api/v1/mini-apps/links/:id/handoff`, so the current authenticated EVA
  session is checked before opening the link.
- The returned handoff is single-use, short-lived, audience-bound to the
  deployment hostname, and stored only as a hash. Exchange removes the query
  token and sets a host-only `eva_app_session` cookie. The main Better Auth
  cookie is never set on or shared with app subdomains. App sessions are
  revocable through the link and expire with the link; current EVA session and
  agent/group policy are rechecked on every request.
- HTTP and WebSocket requests are forwarded only to the registered
  `127.0.0.1` port. Cookies, authorization headers, Cloudflare headers, and
  proxy headers are not forwarded to the app. WebSocket upgrades work on the
  same deployment hostname after the HTTP handoff exchange.

Deployment adapters and process lifecycle management for arbitrary agent code
are follow-up work. Connector manifests remain descriptive and non-executable
until real adapters exist.

## Persistent data and provider credentials

`/var/lib/eva-agent-platform` contains the SQLite database, Better Auth state,
managed configuration, plugin files, host identity, durable queues, logs, and
the service user's home. The service user must own this directory. Do not put
the data directory on an ephemeral filesystem.

For the default Codex provider, log in as the same service user that runs the
host daemon so its sessions are available to provider processes:

```bash
sudo -u eva-agent-platform env \
  HOME=/var/lib/eva-agent-platform \
  PATH=/usr/local/bin:/usr/bin:/bin \
  codex login
```

Keep provider credentials under that user's home or in the root-only
EnvironmentFile, according to the provider's documented credential model. Do
not copy a developer's home directory or credential files into the checkout or
data directory. If a provider needs a machine-local binary, install it for the
service user's PATH and verify it as that user.

## Backups and restore

Take a cold backup so SQLite, Better Auth state, and durable queues are
consistent:

```bash
stamp=$(date -u +%Y%m%dT%H%M%SZ)
sudo systemctl stop eva-agent-platform.service
sudo install -d -o root -g root -m 0700 /var/backups/eva-agent-platform
sudo tar --xattrs --acls --numeric-owner \
  -C /var/lib \
  -czf "/var/backups/eva-agent-platform/data-$stamp.tar.gz" \
  eva-agent-platform
sudo cp --preserve=mode,ownership \
  /etc/eva-agent-platform/eva-agent-platform.env \
  "/var/backups/eva-agent-platform/env-$stamp"
sudo systemctl start eva-agent-platform.service
```

Store the environment-file backup separately with the same root-only access.
Test restores on another host before relying on them. To restore, stop the
unit, move the existing data directory aside, extract the archive under
`/var/lib`, restore `eva-agent-platform:eva-agent-platform` ownership and
`0700` directory permissions, verify the environment file is `0600`, and start
the unit. Never overwrite a live database while the launcher is running.

## Recovery semantics

- A server or host-daemon child failure is handled by the existing launcher;
  it restarts the affected child while the launcher remains active.
- A launcher failure or host reboot is handled by systemd. `Restart=always`
  retries after five seconds, with a five-failure burst limit over ten minutes
  to avoid an uncontrolled crash loop. An intentional `systemctl stop` remains
  stopped.
- Threads, queued messages, migrations, and other durable SQLite state survive
  process restarts and host reboots.
- A provider call already in flight when a child or host disappears may not
  have a durable provider acknowledgement. The affected turn can require a
  retry; this deployment does not claim exactly-once provider execution.
- If the start limit is reached, inspect the journal, fix the cause, then run
  `sudo systemctl reset-failed eva-agent-platform.service` followed by
  `sudo systemctl start eva-agent-platform.service`.

## Safe source release and upgrade

Use a reviewed commit or tag and keep the previous commit recorded for
rollback. The service is stopped before replacing compiled artifacts:

```bash
cd /opt/eva-agent-platform
previous=$(sudo git rev-parse HEAD)
sudo systemctl stop eva-agent-platform.service
sudo git fetch --ff-only origin
sudo git checkout <reviewed-commit-or-tag>
sudo pnpm install --frozen-lockfile
sudo pnpm run build
sudo test -f packages/bb-app/dist/bb-app.js
sudo test -f packages/bb-app/server/dist/index.js
sudo systemctl daemon-reload
sudo systemctl start eva-agent-platform.service
sudo systemctl status --no-pager eva-agent-platform.service
curl --fail http://127.0.0.1:38886/readyz
```

If the build or health check fails, keep the service stopped, return to
`$previous`, reinstall the locked dependencies, rebuild, and start only after
the readiness check passes. Take a data backup before schema-affecting
releases. The database migrations are additive and run at startup; do not
delete the data directory as an upgrade step.
