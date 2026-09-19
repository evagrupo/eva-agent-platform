import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const unit = await readFile(
  resolve(root, "deploy/systemd/eva-agent-platform.service"),
  "utf8",
);
const envExample = await readFile(
  resolve(root, "deploy/systemd/eva-agent-platform.env.example"),
  "utf8",
);
const docs = await readFile(resolve(root, "docs/eva-systemd.md"), "utf8");
const packageJson = JSON.parse(
  await readFile(resolve(root, "package.json"), "utf8"),
);
const miniAppService = await readFile(
  resolve(root, "apps/server/src/services/mini-apps/mini-app-service.ts"),
  "utf8",
);

for (const required of [
  "Wants=network-online.target",
  "After=network-online.target",
  "User=eva-agent-platform",
  "EnvironmentFile=/etc/eva-agent-platform/eva-agent-platform.env",
  "Environment=NODE_ENV=production",
  "Environment=BB_AUTH_REQUIRED=true",
  "Environment=BB_DATA_DIR=/var/lib/eva-agent-platform",
  "StateDirectory=eva-agent-platform",
  "Restart=always",
  "RestartSec=5s",
  "KillSignal=SIGTERM",
  "PrivateTmp=true",
  "NoNewPrivileges=true",
  "ExecStart=/usr/bin/env node /opt/eva-agent-platform/packages/bb-app/dist/bb-app.js start",
]) {
  assert.match(
    unit,
    new RegExp(`^${required.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}$`, "mu"),
  );
}
assert.doesNotMatch(unit, /pnpm|npm|build/iu);
assert.match(unit, /Environment=BB_SERVER_PORT=38886/u);
assert.match(unit, /Environment=BB_HOST_DAEMON_PORT=38887/u);
assert.doesNotMatch(
  unit,
  /BindToDevice|PrivateNetwork|ProtectHome|ProtectSystem/iu,
);
assert.match(envExample, /BB_AUTH_SECRET=replace-/u);
assert.match(envExample, /BB_MINI_APPS_PUBLIC_DOMAIN=apps\.eva\.example\.com/u);
assert.equal(typeof packageJson.scripts?.["start:source"], "string");
assert.match(packageJson.scripts["start:source"], /build/u);
assert.equal(
  packageJson.scripts?.["test:systemd"],
  "node scripts/validate-eva-systemd.mjs",
);
for (const required of [
  "launcher supervises",
  "journalctl",
  "BB_MINI_APPS_PUBLIC_DOMAIN",
  "*.apps.eva.example.com",
  "credentials-file:",
  "host-only `eva_app_session` cookie",
  "WebSocket",
  "in flight",
  "Deployment adapters",
]) {
  assert.match(
    docs,
    new RegExp(required.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "iu"),
  );
}
assert.match(miniAppService, /127\.0\.0\.1/u);
assert.match(miniAppService, /authorization/u);
assert.match(miniAppService, /MINI_APP_SESSION_COOKIE/u);
assert.match(miniAppService, /loopbackPort/u);

console.log("EVA systemd and mini-app deployment contracts are valid");
