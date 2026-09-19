# EVA standalone packaging

The repository includes a production Docker path for the EVA-branded
standalone server. The image packages the existing `bb-app` launcher together
with the built EVA web app, core server, built-in plugins, and host daemon. The
launcher starts the server and its co-located host daemon in one container; it
does not require the remote Connect gateway for browser identity.

For a Linux source checkout supervised by systemd, use the [dedicated-server
runbook](eva-systemd.md). It uses the same launcher and persistent state model,
but starts prebuilt artifacts so a crash does not trigger a rebuild.

## Build and run locally

Build without importing any local environment files:

```bash
docker build --tag eva-agent-platform:local .
docker volume create eva-data
docker run --rm --name eva-agent-platform \
  --publish 38886:38886 \
  --volume eva-data:/var/lib/eva \
  --env BB_AUTH_SECRET='replace-with-a-secret-store-value' \
  --env BB_AUTH_OWNER_EMAIL='owner@example.test' \
  --env BB_AUTH_OWNER_PASSWORD='replace-with-a-12-character-password' \
  eva-agent-platform:local
```

The owner variables are consumed only for the controlled first administrator
bootstrap. Keep `BB_AUTH_SECRET` and the owner password in the deployment
secret store; do not put them in a committed compose file, image layer, or
shell history. After the first administrator exists, remove the owner
variables from the runtime configuration.

The database and Better Auth state are stored below `/var/lib/eva`. The
server applies the bundled additive Drizzle migrations before serving the
application. `/health` is a liveness endpoint and `/readyz` returns readiness
after the listener is initialized; the image healthcheck polls `/readyz` on
port `38886`. A reverse proxy should preserve WebSocket upgrades to `/ws`.

## Reverse proxy contract

For a domain such as `https://connect.evasalud.app`, set `BB_APP_URL` to the
public HTTPS origin and terminate TLS at the proxy. Proxy `/` and `/api/*` to
the container on port `38886`, preserve the `Host` and `Origin` headers, and
configure a WebSocket route for `/ws` with a long-lived read timeout. The
server emits secure headers and an HTML content-security policy; the proxy
must not replace them with a weaker policy.

The minimum production contract is:

| Setting                  | Value                                                  |
| ------------------------ | ------------------------------------------------------ |
| `NODE_ENV`               | `production`                                           |
| `BB_AUTH_REQUIRED`       | `true`                                                 |
| `BB_AUTH_SECRET`         | deployment secret, required and stable across restarts |
| `BB_DATA_DIR`            | `/var/lib/eva`                                         |
| `BB_SERVER_BIND_HOST`    | `0.0.0.0` inside the container                         |
| `BB_SERVER_PORT`         | `38886`                                                |
| `BB_HOST_DAEMON_PORT`    | `38887` inside the container                           |
| `BB_APP_URL`             | public HTTPS origin                                    |
| `BB_AUTH_OWNER_EMAIL`    | first-boot owner only                                  |
| `BB_AUTH_OWNER_PASSWORD` | first-boot owner only                                  |

No deployment is performed by this repository change. Coolify can build the
root `Dockerfile`, attach a persistent volume at `/var/lib/eva`, expose
`38886`, and configure the variables above through its encrypted environment
and secret settings.

## Security boundaries

The browser uses the core server's HTTP-only Better Auth cookie. The optional
signed daemon bearer path remains an internal remote-host transport and is not
the browser's identity. Server-side policy, current sessions, ownership,
agent-bound execution tuples, plugin scopes, and connector capability manifests
remain authoritative even when a request bypasses the UI.

The Docker image is intentionally not a deployment of the Connect gateway,
does not contain credentials, and does not disable signup controls. Browser
developer-tool deterrence is not treated as a security boundary.
