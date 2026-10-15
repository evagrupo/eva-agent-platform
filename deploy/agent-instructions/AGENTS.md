# EVA platform-wide instructions

These rules apply to every EVA agent and provider, including delegated child threads and automation runs. Keep each agent's existing mandate and access boundaries.

## Browser preview delivery

- Whenever presenting a browser-based preview, including a carousel, website, dashboard, or HTML report, run an HTTP server on the preview's execution host and expose it through a Cloudflare Tunnel before handing it to the user.
- Deliver the verified HTTPS tunnel URL as a clickable Markdown link. Do not use a local HTML file path, file:// URL, localhost address, or the built-in raw-file viewer as the preview's only delivery method. File links may still be offered separately for downloads or source inspection.
- Serve the complete preview directory, including its relative images, fonts, CSS, JavaScript, and downloadable files. Fix missing assets before sharing. Never serve an entire agent workspace, repository, home directory, or platform data directory.
- Choose a free, non-platform port and bind the preview server to 127.0.0.1. Never tunnel EVA's host-daemon, database, or management ports. Do not modify the production platform's existing named tunnel, DNS, or credentials to create a temporary preview.
- For a static preview, use `python3 -m http.server <port> --bind 127.0.0.1 --directory <preview-directory>`. For an application, use its documented server command and preserve its asset base paths.
- Start `cloudflared tunnel --no-autoupdate --url http://127.0.0.1:<port>` and use the actual HTTPS URL printed by cloudflared. Quick Tunnels do not require a BB account or Cloudflare login; do not invent a hostname or ask the user to sign in merely to share a public-safe preview.
- Quick Tunnel URLs are public unless access protection is explicitly enabled. Only publish non-sensitive preview content. For private CRM, HR, email, or internal data, use an authenticated preview or `--allowed-mail <authorized-recipient>` when supported. Never expose private content through an unrestricted URL, invent recipients, or use a broad email-domain wildcard without authorization. If the intended recipients are unknown, ask before sharing private content.
- Keep both the HTTP server and cloudflared alive in persistent terminals or uniquely named systemd user services. Record the URL, served directory, port, and process or service identifiers outside the public directory. Reuse a healthy preview when appropriate; do not stop another agent's preview or a production service.
- Verify the local page and the public HTTPS page, then check every referenced local asset and the download links. Inspect the rendered preview when browser tooling is available; exercise the carousel or navigation. A running tunnel alone does not prove the preview works.
- Tell the user the preview is temporary and stops working when its server or tunnel stops. On explicit cleanup, stop only the processes or services recorded for that preview. If serving, tunneling, access protection, or verification fails, report the precise blocker instead of claiming the preview is ready.
