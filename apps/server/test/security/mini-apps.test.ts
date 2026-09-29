import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import {
  authAccounts,
  authGroupMembers,
  authGroups,
  authPrincipals,
  authUsers,
  evaMiniAppLinks,
} from "@bb/db";
import { describe, expect, it } from "vitest";
import WebSocket, {
  WebSocketServer,
  type ClientOptions,
  type RawData,
} from "ws";
import {
  startTestServer,
  withTestHarness,
  type TestAppHarness,
} from "../helpers/test-app.js";

const ADMIN_EMAIL = "mini-app-admin@eva.test";
const ADMIN_PASSWORD = "mini-app-admin-password";
const USER_A_EMAIL = "mini-app-user-a@eva.test";
const USER_A_PASSWORD = "mini-app-user-a-password";
const USER_B_EMAIL = "mini-app-user-b@eva.test";
const USER_B_PASSWORD = "mini-app-user-b-password";

async function seedIdentity(
  harness: TestAppHarness,
  args: {
    email: string;
    name: string;
    password: string;
    role: "admin" | "user";
    userId: string;
  },
): Promise<void> {
  const now = new Date();
  harness.db
    .insert(authUsers)
    .values({
      id: args.userId,
      name: args.name,
      email: args.email,
      emailVerified: true,
      image: null,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  harness.db
    .insert(authAccounts)
    .values({
      id: `${args.userId}-account`,
      accountId: args.userId,
      providerId: "credential",
      userId: args.userId,
      accessToken: null,
      refreshToken: null,
      idToken: null,
      accessTokenExpiresAt: null,
      refreshTokenExpiresAt: null,
      scope: null,
      password: await hashPassword(args.password),
      createdAt: now,
      updatedAt: now,
    })
    .run();
  harness.db
    .insert(authPrincipals)
    .values({
      userId: args.userId,
      role: args.role,
      status: "active",
      policyId: args.role === "admin" ? "admin" : "user",
      revision: 1,
      updatedAt: Date.now(),
    })
    .run();
}

async function signIn(
  harness: TestAppHarness,
  email: string,
  password: string,
): Promise<string> {
  const response = await harness.app.request("/api/auth/sign-in/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  expect(response.status).toBe(200);
  return response.headers.get("set-cookie")!.split(";", 1)[0]!;
}

async function startUpstream(): Promise<{ port: number; server: Server }> {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("mini-app-ok");
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  return { port: (server.address() as AddressInfo).port, server };
}

async function stopUpstream(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

interface WebSocketUpstream {
  port: number;
  server: Server;
  socketServer: WebSocketServer;
  sockets: Set<WebSocket>;
}

async function startWebSocketUpstream(
  openDelayMs = 0,
): Promise<WebSocketUpstream> {
  const socketServer = new WebSocketServer({ noServer: true });
  const sockets = new Set<WebSocket>();
  const server = createServer();
  server.on("upgrade", (request, socket, head) => {
    const accept = (): void => {
      socketServer.handleUpgrade(request, socket, head, (client) => {
        sockets.add(client);
        client.once("close", () => sockets.delete(client));
        client.on("message", (data: RawData) => {
          client.send(`echo:${data.toString()}`);
        });
        client.send("upstream-ready");
      });
    };
    if (openDelayMs > 0) {
      setTimeout(accept, openDelayMs);
    } else {
      accept();
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  return {
    port: (server.address() as AddressInfo).port,
    server,
    socketServer,
    sockets,
  };
}

async function stopWebSocketUpstream(
  upstream: WebSocketUpstream,
): Promise<void> {
  for (const socket of upstream.sockets) socket.terminate();
  await new Promise<void>((resolve, reject) => {
    upstream.socketServer.close((error) => (error ? reject(error) : resolve()));
  });
  await stopUpstream(upstream.server);
}

function openWebSocket(
  url: string,
  options: ClientOptions,
): Promise<WebSocket> {
  const socket = new WebSocket(url, options);
  return new Promise((resolve, reject) => {
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });
}

function collectWebSocketMessages(
  socket: WebSocket,
  expected: readonly string[],
): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const messages: string[] = [];
    const onMessage = (data: RawData): void => {
      messages.push(data.toString());
      if (expected.every((message) => messages.includes(message))) {
        socket.off("message", onMessage);
        resolve(messages);
      }
    };
    socket.on("message", onMessage);
    socket.once("error", reject);
  });
}

async function createDeployment(
  harness: TestAppHarness,
  cookie: string,
  port: number,
): Promise<{ id: string }> {
  const response = await harness.app.request("/api/v1/mini-apps/deployments", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({
      appId: "analytics",
      displayName: "Analytics",
      id: "analytics",
      loopbackPort: port,
    }),
  });
  expect(response.status).toBe(201);
  return (await response.json()) as { id: string };
}

describe("EVA mini-app gateway", () => {
  it("allows only an authenticated one-time handoff to an explicitly registered loopback port", async () => {
    await withTestHarness(
      { authRequired: true, miniAppsPublicDomain: "apps.eva.test" },
      async (harness) => {
        await seedIdentity(harness, {
          email: ADMIN_EMAIL,
          name: "Mini-app administrator",
          password: ADMIN_PASSWORD,
          role: "admin",
          userId: "mini-app-admin",
        });
        await seedIdentity(harness, {
          email: USER_A_EMAIL,
          name: "Mini-app user A",
          password: USER_A_PASSWORD,
          role: "user",
          userId: "mini-app-user-a",
        });
        const adminCookie = await signIn(harness, ADMIN_EMAIL, ADMIN_PASSWORD);
        const userCookie = await signIn(harness, USER_A_EMAIL, USER_A_PASSWORD);
        const upstream = await startUpstream();
        try {
          for (const port of [
            harness.config.serverPort,
            harness.config.hostDaemonPort,
          ]) {
            const denied = await harness.app.request(
              "/api/v1/mini-apps/deployments",
              {
                method: "POST",
                headers: {
                  cookie: adminCookie,
                  "content-type": "application/json",
                },
                body: JSON.stringify({
                  appId: `raw-${port}`,
                  displayName: "Raw port",
                  id: `raw-${port}`,
                  loopbackPort: port,
                }),
              },
            );
            expect(denied.status).toBe(400);
          }
          await createDeployment(harness, adminCookie, upstream.port);
          const noSession = await harness.app.request(
            "http://analytics.apps.eva.test/",
          );
          expect(noSession.status, await noSession.text()).toBe(401);
          const unknownApp = await harness.app.request(
            "http://unknown.apps.eva.test/",
          );
          expect(unknownApp.status).toBe(404);

          const linkResponse = await harness.app.request(
            "/api/v1/mini-apps/links",
            {
              method: "POST",
              headers: {
                cookie: userCookie,
                "content-type": "application/json",
              },
              body: JSON.stringify({
                deploymentId: "analytics",
                expiresInSeconds: 600,
              }),
            },
          );
          expect(linkResponse.status).toBe(201);
          const link = (await linkResponse.json()) as {
            handoff: { url: string };
          };
          expect(link.handoff.url).toContain("eva_handoff=");

          const exchange = await harness.app.request(link.handoff.url);
          expect(exchange.status).toBe(303);
          expect(exchange.headers.get("location")).not.toContain("eva_handoff");
          expect(exchange.status, await exchange.text()).toBe(303);
          const appCookie = exchange.headers
            .get("set-cookie")!
            .split(";", 1)[0]!;
          expect(appCookie).toMatch(/^eva_app_session=/u);
          expect(exchange.headers.get("set-cookie")).not.toMatch(/Domain=/iu);
          expect(
            (
              await harness.app.request("http://analytics.apps.eva.test/", {
                headers: { cookie: userCookie },
              })
            ).status,
          ).toBe(401);
          const appResponse = await harness.app.request(
            "http://analytics.apps.eva.test/report",
            {
              headers: { cookie: appCookie },
            },
          );
          expect(appResponse.status).toBe(200);
          await expect(appResponse.text()).resolves.toBe("mini-app-ok");
          expect((await harness.app.request(link.handoff.url)).status).toBe(
            410,
          );
        } finally {
          await stopUpstream(upstream.server);
        }
      },
    );
  });

  it("bridges an authenticated app WebSocket on a registered deployment host", async () => {
    const upstream = await startWebSocketUpstream(100);
    const server = await startTestServer({
      authRequired: true,
      miniAppsPublicDomain: "apps.eva.test",
    });
    let client: WebSocket | null = null;
    try {
      await seedIdentity(server, {
        email: ADMIN_EMAIL,
        name: "Mini-app administrator",
        password: ADMIN_PASSWORD,
        role: "admin",
        userId: "mini-app-admin",
      });
      await seedIdentity(server, {
        email: USER_A_EMAIL,
        name: "Mini-app user A",
        password: USER_A_PASSWORD,
        role: "user",
        userId: "mini-app-user-a",
      });
      const adminCookie = await signIn(server, ADMIN_EMAIL, ADMIN_PASSWORD);
      const userCookie = await signIn(server, USER_A_EMAIL, USER_A_PASSWORD);
      await createDeployment(server, adminCookie, upstream.port);
      const linkResponse = await server.app.request("/api/v1/mini-apps/links", {
        method: "POST",
        headers: {
          cookie: userCookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          deploymentId: "analytics",
          expiresInSeconds: 600,
        }),
      });
      expect(linkResponse.status).toBe(201);
      const link = (await linkResponse.json()) as {
        handoff: { url: string };
      };
      const exchange = await server.app.request(link.handoff.url);
      const appCookie = exchange.headers.get("set-cookie")!.split(";", 1)[0]!;
      const serverPort = new URL(server.baseUrl).port;
      client = await openWebSocket(`ws://127.0.0.1:${serverPort}/ws`, {
        headers: {
          Cookie: appCookie,
          Host: "analytics.apps.eva.test",
        },
      });
      const received = collectWebSocketMessages(client, [
        "upstream-ready",
        "echo:ping",
      ]);
      client.send("ping");
      await expect(received).resolves.toEqual(
        expect.arrayContaining(["upstream-ready", "echo:ping"]),
      );
    } finally {
      client?.terminate();
      await server.close();
      await stopWebSocketUpstream(upstream);
    }
  });

  it("enforces ownership, group and agent scope plus expiration and revocation", async () => {
    await withTestHarness(
      { authRequired: true, miniAppsPublicDomain: "apps.eva.test" },
      async (harness) => {
        await seedIdentity(harness, {
          email: ADMIN_EMAIL,
          name: "Mini-app administrator",
          password: ADMIN_PASSWORD,
          role: "admin",
          userId: "mini-app-admin",
        });
        await seedIdentity(harness, {
          email: USER_A_EMAIL,
          name: "Mini-app user A",
          password: USER_A_PASSWORD,
          role: "user",
          userId: "mini-app-user-a",
        });
        await seedIdentity(harness, {
          email: USER_B_EMAIL,
          name: "Mini-app user B",
          password: USER_B_PASSWORD,
          role: "user",
          userId: "mini-app-user-b",
        });
        harness.db
          .insert(authGroups)
          .values({
            id: "mini-app-group",
            name: "Mini-app group",
            policyId: "user",
            updatedAt: Date.now(),
          })
          .run();
        harness.db
          .insert(authGroupMembers)
          .values({
            userId: "mini-app-user-b",
            groupId: "mini-app-group",
            updatedAt: Date.now(),
          })
          .run();
        const adminCookie = await signIn(harness, ADMIN_EMAIL, ADMIN_PASSWORD);
        const userACookie = await signIn(
          harness,
          USER_A_EMAIL,
          USER_A_PASSWORD,
        );
        const userBCookie = await signIn(
          harness,
          USER_B_EMAIL,
          USER_B_PASSWORD,
        );
        const upstream = await startUpstream();
        try {
          await createDeployment(harness, adminCookie, upstream.port);
          const groupLinkResponse = await harness.app.request(
            "/api/v1/mini-apps/links",
            {
              method: "POST",
              headers: {
                cookie: adminCookie,
                "content-type": "application/json",
              },
              body: JSON.stringify({
                deploymentId: "analytics",
                expiresInSeconds: 600,
                groupId: "mini-app-group",
              }),
            },
          );
          expect(groupLinkResponse.status).toBe(201);
          const groupLink = (await groupLinkResponse.json()) as { id: string };
          expect(
            (
              await harness.app.request(
                `/api/v1/mini-apps/links/${groupLink.id}/handoff`,
                {
                  method: "POST",
                  headers: { cookie: userACookie },
                },
              )
            ).status,
          ).toBe(403);
          const groupHandoff = await harness.app.request(
            `/api/v1/mini-apps/links/${groupLink.id}/handoff`,
            {
              method: "POST",
              headers: { cookie: userBCookie },
            },
          );
          expect(groupHandoff.status).toBe(200);

          const agentLinkResponse = await harness.app.request(
            "/api/v1/mini-apps/links",
            {
              method: "POST",
              headers: {
                cookie: adminCookie,
                "content-type": "application/json",
              },
              body: JSON.stringify({
                agentId: "creative",
                deploymentId: "analytics",
                expiresInSeconds: 600,
                userId: "mini-app-user-a",
              }),
            },
          );
          expect(agentLinkResponse.status).toBe(201);
          const agentLink = (await agentLinkResponse.json()) as { id: string };
          expect(
            (
              await harness.app.request(
                `/api/v1/mini-apps/links/${agentLink.id}/handoff`,
                {
                  method: "POST",
                  headers: { cookie: userACookie },
                },
              )
            ).status,
          ).toBe(403);

          const expiredResponse = await harness.app.request(
            "/api/v1/mini-apps/links",
            {
              method: "POST",
              headers: {
                cookie: userACookie,
                "content-type": "application/json",
              },
              body: JSON.stringify({
                deploymentId: "analytics",
                expiresInSeconds: 600,
              }),
            },
          );
          const expiredLink = (await expiredResponse.json()) as { id: string };
          harness.db
            .update(evaMiniAppLinks)
            .set({ expiresAt: Date.now() - 1 })
            .where(eq(evaMiniAppLinks.id, expiredLink.id))
            .run();
          expect(
            (
              await harness.app.request(
                `/api/v1/mini-apps/links/${expiredLink.id}/handoff`,
                {
                  method: "POST",
                  headers: { cookie: userACookie },
                },
              )
            ).status,
          ).toBe(410);

          const revocableResponse = await harness.app.request(
            "/api/v1/mini-apps/links",
            {
              method: "POST",
              headers: {
                cookie: userACookie,
                "content-type": "application/json",
              },
              body: JSON.stringify({
                deploymentId: "analytics",
                expiresInSeconds: 600,
              }),
            },
          );
          const revocableLink = (await revocableResponse.json()) as {
            handoff: { url: string };
            id: string;
          };
          const exchange = await harness.app.request(revocableLink.handoff.url);
          const appCookie = exchange.headers
            .get("set-cookie")!
            .split(";", 1)[0]!;
          expect(
            (
              await harness.app.request(
                `/api/v1/mini-apps/links/${revocableLink.id}/revoke`,
                {
                  method: "POST",
                  headers: { cookie: userACookie },
                },
              )
            ).status,
          ).toBe(200);
          expect(
            (
              await harness.app.request("http://analytics.apps.eva.test/", {
                headers: { cookie: appCookie },
              })
            ).status,
          ).toBe(410);
        } finally {
          await stopUpstream(upstream.server);
        }
      },
    );
  });
});
