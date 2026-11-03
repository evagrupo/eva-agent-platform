import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";
import { registerAgentBrowserRoutes } from "./agent-browser.js";

describe("agent browser forwarding", () => {
  let server: Server | undefined;
  const received: Array<{
    path: string | undefined;
    cookie: string | undefined;
    authorization: string | undefined;
    host: string | undefined;
    origin: string | undefined;
    body: string;
  }> = [];

  afterEach(async () => {
    received.length = 0;
    if (server) {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server?.close(() => resolve()));
      server = undefined;
    }
  });

  async function fixture() {
    server = createServer(async (req, res) => {
      const parts: Buffer[] = [];
      for await (const part of req) parts.push(Buffer.from(part));
      received.push({
        path: req.url,
        cookie: req.headers.cookie,
        authorization: req.headers.authorization,
        host: req.headers.host,
        origin: req.headers.origin,
        body: Buffer.concat(parts).toString(),
      });
      res.setHeader("cache-control", "no-store");
      res.setHeader("content-security-policy", "default-src 'none'");
      if (req.url?.endsWith("/api/unlock")) {
        res.setHeader("set-cookie", [
          "__Host-eva-takeover=viewer; Path=/; Secure; HttpOnly; SameSite=Strict",
          "eva_auth=forbidden; Path=/",
        ]);
        res.end("{}");
      } else if (req.url?.includes("/api/")) {
        res.statusCode = req.headers.cookie ? 200 : 401;
        res.end(req.headers.cookie ? "private frame" : "unauthorized");
      } else res.end("viewer asset");
    });
    await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    const app = new Hono();
    registerAgentBrowserRoutes(app, {
      serverPort: 39886,
      hostDaemonPort: 39887,
      loopbackPort: port,
    });
    return app;
  }

  it("serves prefixed assets and preserves viewer authentication responses", async () => {
    const app = await fixture();
    expect((await app.request("/agent-browser")).headers.get("location")).toBe(
      "/agent-browser/",
    );
    for (const path of ["/", "/viewer.js", "/viewer.css"]) {
      const response = await app.request(`/agent-browser${path}`);
      expect(response.status).toBe(200);
      expect(await response.text()).toBe("viewer asset");
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
    expect((await app.request("/agent-browser/api/frame")).status).toBe(401);
  });

  it("forwards only the viewer cookie and drops platform credentials", async () => {
    const app = await fixture();
    const response = await app.request(
      "https://eva.example.com/agent-browser/api/frame?port=22",
      {
        headers: {
          cookie: "eva_auth=private; __Host-eva-takeover=viewer; other=private",
          authorization: "Bearer platform-secret",
          "x-forwarded-host": "attacker.example",
          origin: "https://eva.example.com",
        },
      },
    );
    expect(response.status).toBe(200);
    expect(received[0]).toMatchObject({
      path: "/agent-browser/api/frame",
      cookie: "__Host-eva-takeover=viewer",
      authorization: undefined,
      origin: "https://eva.example.com",
      body: "",
    });
    expect(received[0]?.host).toMatch(/^127\.0\.0\.1:\d+$/u);
  });

  it("preserves JSON bodies and filters response cookies", async () => {
    const app = await fixture();
    const response = await app.request("/agent-browser/api/unlock", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: "one-time" }),
    });
    expect(received[0]?.body).toBe('{"key":"one-time"}');
    expect(response.headers.getSetCookie()).toEqual([
      "__Host-eva-takeover=viewer; Path=/; Secure; HttpOnly; SameSite=Strict",
    ]);
  });

  it("refuses arbitrary paths, methods, and oversized input without forwarding", async () => {
    const app = await fixture();
    for (const path of ["/config.json", "/tabs", "/json/version", "/api/proxy"]) {
      expect((await app.request(`/agent-browser${path}`)).status).toBe(404);
    }
    expect(
      (await app.request("/agent-browser/api/input", { method: "DELETE" })).status,
    ).toBe(404);
    expect(
      (
        await app.request("/agent-browser/api/input", {
          method: "POST",
          body: "a".repeat(65_537),
        })
      ).status,
    ).toBe(413);
    expect(received).toHaveLength(0);
  });

  it("returns an explicit offline error instead of the platform shell", async () => {
    const app = new Hono();
    registerAgentBrowserRoutes(app, { serverPort: 38990, hostDaemonPort: 38991 });
    const response = await app.request("/agent-browser/");
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Browser viewer port is unavailable",
    });
  });

  it("never forwards to the host daemon's port", async () => {
    const app = new Hono();
    registerAgentBrowserRoutes(app, { serverPort: 38989, hostDaemonPort: 38990 });
    expect((await app.request("/agent-browser/")).status).toBe(503);
  });
});
