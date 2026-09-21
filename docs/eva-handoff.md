# EVA Agent Platform handoff and deployment guide

This document is the handoff package for the EVA Agent Platform fork. It is
written so another developer can continue the work, run it locally, or install
it on the dedicated Linux server without needing undocumented context.

## 1. Project identity

- Repository: `git@github.com:evagrupo/eva-agent-platform.git`
- Product: EVA Agent Platform
- Default branch: `main`
- Upstream source: `git@github.com:get-bb/bb.git`
- Source checkout on the dedicated server: `/opt/eva-agent-platform`
- Persistent production data: `/var/lib/eva-agent-platform`
- Production web listener: `127.0.0.1:38886` behind the chosen proxy or tunnel
- Host daemon: `127.0.0.1:38887`; never expose this port publicly
- Production service: `eva-agent-platform.service`

The fork keeps the underlying BB runtime and package compatibility needed by
the providers and plugins, but the product-facing surface is EVA-branded.
Internal compatibility identifiers may still exist in package names and source
paths. Do not rebrand compatibility identifiers blindly.

## 2. What is already implemented

The current fork contains the following major surfaces:

- Better Auth sessions, secure cookies, controlled owner bootstrap, revocation,
  origin checks, and disabled public signup.
- Default-deny RBAC for users, roles, groups, grants, agents, providers,
  models, reasoning, tools, plugins, terminals, files, projects, threads,
  hosts, environments, realtime, and queued execution.
- EVA agents, skills, managed workspaces, agent instructions, agent threads,
  bounded agent-to-agent collaboration, SDK contracts, CLI commands, and UI.
- Hidden global, role, user, and agent instructions with server-side
  precedence and current-policy checks.
- Protected mini-app gateway with authenticated handoffs, scoped links,
  wildcard-host routing, host-only app cookies, and WebSocket proxying.
- Systemd source deployment, persistent data paths, health/readiness endpoints,
  crash restart behavior, backup/restore guidance, and Cloudflare Tunnel
  routing documentation.
- Git-backed EVA agent workspace synchronization with administrator-only
  configuration, status, initialize, commit, pull/restore, and push actions.

## 3. Important workspace and data boundaries

Agent workspace files live here in production:

```text
/var/lib/eva-agent-platform/eva-agents/<agent-id>/
```

Examples:

```text
/var/lib/eva-agent-platform/eva-agents/orchestrator/
/var/lib/eva-agent-platform/eva-agents/creative/
/var/lib/eva-agent-platform/eva-agents/meta/
/var/lib/eva-agent-platform/eva-agents/google/
```

The platform scaffolds managed files such as `AGENTS.md`, `README.md`,
`.eva-managed`, `bin/README.md`, and `.bb/skills/` in each workspace.

The application source is separate:

```text
/opt/eva-agent-platform/
```

The persistent data directory contains the SQLite database, Better Auth state,
RBAC configuration, threads, queues, plugin state, logs, host identity, and
the service user's home. Git workspace synchronization does not synchronize
those records. A full machine migration needs both a data-directory backup and
the agent workspace repositories.

Never put any of these in an agent workspace repository:

- `.env` files or provider environment files
- API keys, access tokens, passwords, cookies, session files, or private keys
- Codex, Claude, SSH, Cloudflare, or cloud-provider credential directories
- SQLite databases, WAL/SHM files, logs, runtime sockets, or PID files
- `node_modules`, build output, coverage, caches, or generated runtime state
- the EVA source checkout or arbitrary paths outside the managed workspace

The sync service blocks known sensitive paths, scans file contents for
credential-shaped values, rejects symlinks and special files, disables Git
hooks, uses noninteractive Git, and never force-pushes or silently overwrites
local files.

## 4. Local development and verification

Requirements:

- Node.js 22.19 or newer
- pnpm 9.15 or newer
- Git
- Codex/Claude/Pi/Cursor provider credentials only when exercising a provider

From a fresh checkout:

```bash
pnpm install --frozen-lockfile
pnpm run build
pnpm run test:systemd
```

Focused EVA checks:

```bash
pnpm --filter @bb/server test -- --run test/services/eva-workspace-sync.test.ts
pnpm --filter @bb/app test -- --run src/views/EvaAgentsView.workspace-sync.test.tsx
pnpm exec turbo run typecheck --filter=@bb/server --filter=@bb/app --filter=@bb/db --filter=@bb/sdk --filter=@bb/cli
pnpm exec turbo run build --filter=@bb/server --filter=@bb/app --filter=@bb/sdk --filter=@bb/cli
pnpm exec oxfmt --check apps/server/src/services/eva-workspace-sync.ts apps/server/test/services/eva-workspace-sync.test.ts apps/app/src/views/EvaAgentsView.tsx apps/app/src/views/EvaAgentsView.workspace-sync.test.tsx docs/eva-workspace-sync.md docs/eva-handoff.md
git diff --check
```

For an isolated local production-style launch, use a temporary data directory
and loopback ports. Do not reuse production data:

```bash
pnpm run build
test_data_dir="$(mktemp -d)"
trap 'rm -rf "$test_data_dir"' EXIT
NODE_ENV=production \
BB_AUTH_REQUIRED=true \
BB_AUTH_SECRET="$(openssl rand -hex 32)" \
BB_DATA_DIR="$test_data_dir/data" \
BB_SERVER_BIND_HOST=127.0.0.1 \
BB_SERVER_PORT=39886 \
BB_HOST_DAEMON_PORT=39887 \
BB_APP_URL=http://127.0.0.1:39886 \
BB_EXTERNAL_URL=http://127.0.0.1:39886 \
HOME="$test_data_dir/home" \
node packages/bb-app/dist/bb-app.js start
```

In another shell while it is running:

```bash
curl --fail http://127.0.0.1:39886/health
curl --fail http://127.0.0.1:39886/readyz
```

Stop the process cleanly. Never use `reset`, `clean`, or a broad deletion to
repair a dirty checkout; preserve and inspect existing user changes first.

## 5. Dedicated Linux server installation

The supported physical-server workflow is systemd plus the source checkout.
The unit starts prebuilt artifacts, while the launcher supervises the HTTP
server and host daemon together. It does not rebuild during crash recovery.

Read [eva-systemd.md](eva-systemd.md) before changing the server. The compact
sequence is:

```bash
sudo groupadd --system eva-agent-platform
sudo useradd --system --gid eva-agent-platform \
  --home-dir /var/lib/eva-agent-platform --create-home \
  --shell /usr/sbin/nologin eva-agent-platform
sudo git clone git@github.com:evagrupo/eva-agent-platform.git \
  /opt/eva-agent-platform
sudo chown -R root:eva-agent-platform /opt/eva-agent-platform
sudo chmod -R u+rwX,g+rX,o-rwx /opt/eva-agent-platform
cd /opt/eva-agent-platform
sudo pnpm install --frozen-lockfile
sudo pnpm run build
sudo install -d -o root -g root -m 0755 /etc/eva-agent-platform
sudo install -o root -g root -m 0600 \
  deploy/systemd/eva-agent-platform.env.example \
  /etc/eva-agent-platform/eva-agent-platform.env
sudo install -o root -g root -m 0644 \
  deploy/systemd/eva-agent-platform.service \
  /etc/systemd/system/eva-agent-platform.service
sudo systemctl daemon-reload
sudo systemctl enable --now eva-agent-platform.service
```

The root-only environment file must contain a stable random
`BB_AUTH_SECRET`, the public URL, and first-boot owner values. Do not put real
values in this document, in Git, or in shell history. Remove
`BB_AUTH_OWNER_EMAIL` and `BB_AUTH_OWNER_PASSWORD` immediately after the first
administrator account is created.

The production values are normally:

```text
NODE_ENV=production
BB_AUTH_REQUIRED=true
BB_DATA_DIR=/var/lib/eva-agent-platform
BB_SERVER_BIND_HOST=0.0.0.0
BB_SERVER_PORT=38886
BB_HOST_DAEMON_PORT=38887
BB_EXTERNAL_URL=https://agentes.connect.evasalud.app
BB_APP_URL=https://agentes.connect.evasalud.app
BB_MINI_APPS_PUBLIC_DOMAIN=apps.connect.evasalud.app
```

Keep `38887` loopback-only. The public entrypoint is the web listener through
Cloudflare or a trusted reverse proxy.

Check the service after installation:

```bash
sudo systemctl status --no-pager eva-agent-platform.service
sudo systemctl is-active eva-agent-platform.service
sudo journalctl -u eva-agent-platform.service -n 200 --no-pager
curl --fail http://127.0.0.1:38886/readyz
```

The service automatically restarts after a child or launcher failure. A
five-failure burst limit protects against an uncontrolled crash loop; if it is
reached, inspect the journal, fix the cause, then run:

```bash
sudo systemctl reset-failed eva-agent-platform.service
sudo systemctl start eva-agent-platform.service
```

## 6. Domain and Cloudflare Tunnel routing

The intended public routes are:

```text
agentes.connect.evasalud.app       -> http://127.0.0.1:38886
*.apps.connect.evasalud.app        -> http://127.0.0.1:38886
```

Create the two public hostnames on the existing Cloudflare Tunnel. A
tunnel-specific credential or token belongs in `/etc/cloudflared/` with root
ownership and restrictive permissions. Do not install the account-wide
`cert.pem` as the EVA runtime credential and do not put Cloudflare secrets in
the repository.

Example ingress:

```yaml
tunnel: eva-agent-platform
credentials-file: /etc/cloudflared/eva-agent-platform.json
ingress:
  - hostname: agentes.connect.evasalud.app
    service: http://127.0.0.1:38886
  - hostname: "*.apps.connect.evasalud.app"
    service: http://127.0.0.1:38886
  - service: http_status:404
```

Preserve the original `Host`, `Origin`, and WebSocket upgrade headers. Do not
route the host daemon or arbitrary agent-selected ports through Cloudflare.
The wildcard record means a newly registered mini-app hostname does not need a
new DNS record each time. The current mini-app gateway is registry-first: an
administrator registers an already-running loopback port; the platform does
not yet launch arbitrary source code or processes from a workspace.

## 7. Workspace Git synchronization

Workspace sync is configured per agent from the EVA agent UI or CLI. It is
administrator-only by default.

CLI examples:

```bash
bb eva sync configure creative \
  --remote git@github.com:evagrupo/eva-agent-creative.git \
  --branch main
bb eva sync initialize creative
bb eva sync status creative --json
```

Every mutation requires a fresh status fingerprint:

```bash
status="$(bb eva sync status creative --json)"
# Read the returned status.fingerprint and review blockedFiles/changes.
bb eva sync commit creative "Checkpoint creative workspace" \
  --fingerprint <fresh-fingerprint>
bb eva sync push creative --fingerprint <fresh-fingerprint>
```

On another machine, install the same fork, create or restore the same EVA
agent catalog, configure the same private remote, initialize the workspace,
review the status, and use Pull / Restore with explicit confirmation. The
restore path is fast-forward-only and will refuse to overwrite mismatched
local files. Resolve any precondition or conflict manually; never bypass it
with a force push or hard reset.

Configure Git authentication for the `eva-agent-platform` service user using
the provider's normal SSH agent/key or noninteractive credential helper. The
EVA database stores no Git credentials. Remote URLs must not contain embedded
passwords or tokens.

For a full machine move, back up and restore both:

1. `/var/lib/eva-agent-platform`, while the service is stopped, for database,
   authentication, RBAC, threads, queues, plugin state, and provider state.
2. The private agent workspace repositories, using the EVA sync controls.

Do not treat workspace Git synchronization as a backup of the full platform.

## 8. Release and rollback procedure

Before a production upgrade:

1. Take a cold backup using the commands in [eva-systemd.md](eva-systemd.md).
2. Record the currently running commit with `git rev-parse HEAD`.
3. Fetch only reviewed commits from `origin`.
4. Stop the service before replacing artifacts.
5. Install the frozen lockfile and build.
6. Start the service and require `/readyz` to return 200.
7. Check the journal, login flow, agent list, workspace status, and WebSocket.

If the build or readiness check fails, stop the service and return to the
recorded commit. Do not delete the persistent data directory. Database
migrations are additive and run during startup.

## 9. Handoff prompt for the next developer

Copy the following prompt into the next development agent:

```text
You are taking over the EVA Agent Platform fork in
/home/yusuf/Developer/eva-agent-platform.

Read these files before changing anything:
- AGENTS.md
- docs/eva-handoff.md
- docs/eva-systemd.md
- docs/eva-workspace-sync.md
- docs/eva-foundation-security.md

The repository is a fork of BB maintained for EVA. Preserve the existing EVA
foundation, authentication, RBAC, agent catalog, mini-app gateway, systemd
packaging, and workspace-sync work. Inspect git status, the current branch,
and the diff first. The checkout may contain unrelated user changes. Never
run git reset --hard, git checkout --, git clean, broad deletion, or any
destructive cleanup.

Before implementation:
- identify the exact user outcome and acceptance criteria;
- inspect the existing server, DB, SDK, CLI, and app contracts;
- keep policy checks authoritative on the server;
- preserve default-deny behavior;
- keep secrets out of source, logs, tests, Git remotes, and handoff text;
- do not deploy, push, modify DNS, or use production credentials unless the
  user explicitly requests that exact external action.

For code changes, update the server contract, SDK, CLI, UI, tests, and docs
as appropriate. Use additive migrations and the existing Drizzle conventions.
For UI work, use the EVA visual language and run the repository's UI finish
checks. For provider or daemon protocol changes, review and increment the
protocol version when compatibility requires it.

For workspace synchronization, operate only under
BB_DATA_DIR/eva-agents/<agent-id>. Never synchronize the EVA source checkout,
database, provider credentials, logs, runtime state, or arbitrary paths. Keep
Git noninteractive and bounded, reject unsafe remotes and secret-like files,
disable hooks, serialize operations, require fresh status fingerprints, and
never use force push, hard reset, clean, or silent overwrite. Restore only
when the exact-file precondition passes.

For server deployment, use the systemd runbook. Keep the web listener on
38886, keep the host daemon on loopback port 38887, use the existing Cloudflare
Tunnel wildcard routes, and use a tunnel-specific credential rather than an
account-wide Cloudflare certificate. Do not put credentials in the checkout.

Validate proportionately with Turbo tests/typechecks/builds, formatter and
git diff checks, credential scans, systemd validation, and an isolated local
launch. Report exact passing and failing checks, including unrelated baseline
failures. Do not claim production readiness or deployment unless it was
actually verified.
```

## 10. Known limitations

- Connectors are capability manifests until real adapters are implemented.
- Mini-app process lifecycle is not automatic; only registered loopback ports
  are proxyable.
- Provider calls already in flight during a crash may require a retry.
- Browser developer-tool deterrence is not a security boundary.
- A Cloudflare Tunnel removes the need for public inbound ports, but a tunnel,
  DNS provider, origin service, or provider outage can still cause downtime.
- Full-suite baseline failures and verify-bb inventory drift must be evaluated
  separately from focused EVA checks before declaring a release.

The handoff is complete only when the next developer has run the relevant
checks, documented any new assumptions, and left the checkout recoverable.
