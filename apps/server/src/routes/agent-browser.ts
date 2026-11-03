import type { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";

export const AGENT_BROWSER_PATH = "/agent-browser";
export const AGENT_BROWSER_PORT = 38990;
const browserCookie = "__Host-eva-takeover";
const routes = new Set([
  "GET /",
  "GET /viewer.js",
  "GET /viewer.css",
  "GET /api/status",
  "GET /api/frame",
  "POST /api/unlock",
  "POST /api/input",
  "POST /api/navigate",
  "POST /api/select",
  "POST /api/finish",
]);
const responseHeaders = [
  "content-type",
  "content-security-policy",
  "cache-control",
  "referrer-policy",
  "permissions-policy",
  "x-content-type-options",
  "x-frame-options",
];

export function registerAgentBrowserRoutes(
  app: Hono,
  options: { serverPort: number; hostDaemonPort: number; loopbackPort?: number },
): void {
  const port = options.loopbackPort ?? AGENT_BROWSER_PORT;
  app.get(AGENT_BROWSER_PATH, (context) =>
    context.redirect(`${AGENT_BROWSER_PATH}/`, 307),
  );
  app.use(
    `${AGENT_BROWSER_PATH}/*`,
    bodyLimit({
      maxSize: 65_536,
      onError: (context) => context.json({ error: "Request is too large" }, 413),
    }),
  );
  app.all(`${AGENT_BROWSER_PATH}/*`, async (context) => {
    context.header("cache-control", "no-store");
    context.header("referrer-policy", "no-referrer");
    context.header("x-frame-options", "DENY");
    const path = context.req.path.slice(AGENT_BROWSER_PATH.length);
    if (!routes.has(`${context.req.method} ${path}`)) {
      return context.json({ error: "Not found" }, 404);
    }
    if (port === options.serverPort || port === options.hostDaemonPort) {
      return context.json({ error: "Browser viewer port is unavailable" }, 503);
    }
    const headers = new Headers();
    for (const name of ["origin", "content-type", "sec-fetch-site"]) {
      const value = context.req.header(name);
      if (value !== undefined) headers.set(name, value);
    }
    const cookie = context.req
      .header("cookie")
      ?.split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${browserCookie}=`));
    if (cookie !== undefined) headers.set("cookie", cookie);
    const body =
      context.req.method === "POST"
        ? await context.req.arrayBuffer()
        : undefined;
    try {
      const response = await fetch(
        `http://127.0.0.1:${port}${context.req.path}`,
        {
          method: context.req.method,
          headers,
          body,
          redirect: "manual",
          signal: AbortSignal.timeout(15_000),
        },
      );
      const forwarded = new Headers();
      for (const name of responseHeaders) {
        const value = response.headers.get(name);
        if (value !== null) forwarded.set(name, value);
      }
      for (const value of response.headers.getSetCookie()) {
        if (value.startsWith(`${browserCookie}=`)) {
          forwarded.append("set-cookie", value);
        }
      }
      return new Response(response.body, {
        status: response.status,
        headers: forwarded,
      });
    } catch {
      return context.json(
        { error: "Browser viewer is offline. Ask the agent for a new session." },
        503,
      );
    }
  });
}
