# EVA AI Agents Cloudflare Tunnel

This checkout serves the EVA Agent Platform through the named Cloudflare
Tunnel hostname `ai-agents.evasalud.app`.

## Local origin

The repository runbook reserves `38886` for the production web listener and
`38887` for the private host daemon. Those ports were already occupied in this
workspace, so the running checkout instance uses:

```text
web origin:   http://127.0.0.1:39886
host daemon:  127.0.0.1:39887 (private; never tunnel this port)
health:       http://127.0.0.1:39886/health
readiness:    http://127.0.0.1:39886/readyz
```

The current checkout instance is detached and supervised by the compiled
`packages/bb-app/dist/bb-app.js start` launcher. Its isolated runtime data is
under `/tmp/eva-agent-platform-runtime-v2/data`, and its launcher log is
`/tmp/eva-agent-platform-runtime-v2/logs/app.log`. For a restart, reuse stable
production auth values from the deployment secret store rather than generating
a new `BB_AUTH_SECRET` for an existing data directory.

The health and readiness endpoints must return HTTP 200 before starting the
tunnel. A successful manual check of the UI is:

```bash
curl --fail http://127.0.0.1:39886/health
curl --fail http://127.0.0.1:39886/readyz
curl --fail --head http://127.0.0.1:39886/
```

## Named tunnel configuration

Use the secret-free template at
[`deploy/cloudflared/ai-agents.evasalud.app.config.yml.example`](../deploy/cloudflared/ai-agents.evasalud.app.config.yml.example).
It deliberately contains placeholders rather than an invented tunnel ID or
credential path.

Install the populated configuration and the existing tunnel-specific JSON
credential with restrictive permissions. Keep both outside the checkout:

```bash
sudo install -d -m 0750 /etc/cloudflared
sudo install -o root -g root -m 0600 \
  /secure/source/<existing-tunnel-credentials>.json \
  /etc/cloudflared/<existing-tunnel-credentials>.json
sudo install -o root -g root -m 0600 \
  deploy/cloudflared/ai-agents.evasalud.app.config.yml.example \
  /etc/cloudflared/ai-agents.evasalud.app.config.yml
sudoedit /etc/cloudflared/ai-agents.evasalud.app.config.yml
```

Replace only the two marked placeholders with the real existing tunnel ID or
name and the matching credential filename. The ingress must remain restricted
to `http://127.0.0.1:39886`; never point it at `39887`.

Validate the ingress configuration before starting the connector:

```bash
cloudflared tunnel \
  --config /etc/cloudflared/ai-agents.evasalud.app.config.yml \
  ingress validate
cloudflared tunnel \
  --config /etc/cloudflared/ai-agents.evasalud.app.config.yml \
  ingress rule \
  https://ai-agents.evasalud.app/readyz
```

Start the named tunnel with the configured ID or name:

```bash
sudo cloudflared tunnel \
  --config /etc/cloudflared/ai-agents.evasalud.app.config.yml \
  run \
  <existing-tunnel-id-or-name>
```

Create or verify the DNS route in the Cloudflare account before claiming the
public hostname works. If the account uses command-line DNS management, the
operator needs permission to manage the `evasalud.app` zone and may use:

```bash
cloudflared tunnel route dns <existing-tunnel-id-or-name> ai-agents.evasalud.app
```

Do not use that command with the placeholders. A dashboard-created hostname
route is equivalent when command-line DNS credentials are unavailable.

## Public verification

After the connector is running and DNS resolves to the named tunnel, verify
the public origin independently:

```bash
dig +short ai-agents.evasalud.app
curl --fail --max-time 20 https://ai-agents.evasalud.app/readyz
curl --fail --max-time 20 https://ai-agents.evasalud.app/
```

Do not report the hostname as live based only on local health checks or a
successful ingress syntax check. It is live only after DNS resolution,
connector status, and an HTTPS request to the hostname all succeed.

## Current access requirement

This workspace has no Cloudflare certificate, API token, tunnel JSON, existing
config, or DNS route available locally. To finish the public setup, an operator
must provide access to the `evasalud.app` Cloudflare zone and the existing
named tunnel, plus place its tunnel-specific credential JSON on the host (or
provide the approved service-token workflow). Do not send the credential value
in chat or commit it.
