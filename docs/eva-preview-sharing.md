# EVA preview sharing

EVA's global preview policy is versioned in
[deploy/agent-instructions/AGENTS.md](../deploy/agent-instructions/AGENTS.md).
Install or merge it into `AGENTS.md` directly under the deployment's configured
`BB_DATA_DIR`. The current deployment uses `/var/lib/eva/AGENTS.md`.
Preserve any existing deployment-specific instructions when merging.

The server reads this file when resolving agent runtime instructions, independently
of the selected agent, provider, project, or agent seed directory. New sessions
receive it without rebuilding the frontend, backend, plugins, or agent workspaces.
An already-running provider session may retain its previous instructions until it
is recreated. Do not restart unrelated work solely to update the instructions.

## Preview workflow

Serve the generated site's asset directory, not the HTML file in isolation or the
whole agent workspace. Keep the server and tunnel in persistent terminals or
separate systemd user services. For a static site, the underlying commands are:

```bash
python3 -m http.server 8895 --bind 127.0.0.1 --directory /absolute/path/to/preview
cloudflared tunnel --no-autoupdate --url http://127.0.0.1:8895
```

Choose a free port; the example is not a reserved shared port. Wait for the actual
`https://<generated-name>.trycloudflare.com` URL and verify the page, relative
assets, and downloads over HTTPS before delivering the link. Never replace or
restart EVA's production tunnel to publish a preview.

These temporary Quick Tunnels do not require a BB account, a Cloudflare login, DNS
changes, or an API token. They are public by default and stop working when the
tunnel exits. Use only public-safe assets, or protect private previews with an
authenticated application or cloudflared's supported `--allowed-mail` option for
explicitly authorized recipients. Do not publish private agent data openly.
See [Cloudflare's Quick Tunnel documentation](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/).

Permanent previews require a separately configured named tunnel and stable
hostname; a temporary preview is not a production deployment.
