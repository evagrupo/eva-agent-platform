import { WebSocket as NodeWebSocket } from "ws";
import type { Hono } from "hono";
import type { WSContext, WSMessageReceive } from "hono/ws";
import type { createNodeWebSocket } from "@hono/node-ws";
import { z } from "zod";
import { assertCoreCapability, getCoreAuthContext } from "../access-policy.js";
import { ApiError } from "../errors.js";
import type { AppDeps } from "../types.js";
import {
  createEvaMiniAppService,
  type EvaMiniAppService,
} from "../services/mini-apps/mini-app-service.js";

type UpgradeWebSocket = ReturnType<
  typeof createNodeWebSocket
>["upgradeWebSocket"];

const idSchema = z
  .string()
  .min(1)
  .max(62)
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,60}[a-z0-9])?$/u);

const MAX_PENDING_GATEWAY_WEBSOCKET_MESSAGES = 16;
const MAX_PENDING_GATEWAY_WEBSOCKET_BYTES = 1_048_576;

const deploymentSchema = z
  .object({
    appId: idSchema,
    displayName: z.string().trim().min(1).max(160),
    id: idSchema,
    loopbackPort: z.number().int().min(1).max(65_535),
  })
  .strict();

const linkSchema = z
  .object({
    agentId: idSchema.optional(),
    deploymentId: idSchema,
    expiresInSeconds: z.number().int().min(60).max(86_400),
    groupId: idSchema.optional(),
    userId: idSchema.optional(),
  })
  .strict();

function requireUser(context: object) {
  const authContext = getCoreAuthContext(context);
  if (authContext === null) {
    throw new ApiError(401, "unauthorized", "Unauthorized");
  }
  assertCoreCapability(context, "workspaceBootstrap");
  return authContext;
}

function requireAdmin(context: object) {
  const authContext = requireUser(context);
  if (authContext.role !== "admin") {
    throw new ApiError(403, "policy_denied", "Administrator access required");
  }
  return authContext;
}

async function parseBody<T>(
  context: { req: { json(): Promise<unknown> } },
  schema: z.ZodType<T>,
): Promise<T> {
  const parsed = schema.safeParse(await context.req.json().catch(() => null));
  if (!parsed.success) {
    throw new ApiError(400, "invalid_request", "Invalid mini-app request");
  }
  return parsed.data;
}

function deploymentSummary(deployment: {
  appId: string;
  createdAt: number;
  displayName: string;
  id: string;
  loopbackPort: number;
  revokedAt: number | null;
  updatedAt: number;
}) {
  return {
    appId: deployment.appId,
    createdAt: deployment.createdAt,
    displayName: deployment.displayName,
    id: deployment.id,
    loopbackPort: deployment.loopbackPort,
    revokedAt: deployment.revokedAt,
    updatedAt: deployment.updatedAt,
  };
}

function websocketProtocols(header: string | undefined): string[] {
  if (header === undefined || header.trim().length === 0) return [];
  return header
    .split(",")
    .map((protocol) => protocol.trim())
    .filter((protocol) => protocol.length > 0);
}

function forwardWebSocketMessage(
  socket: WSContext,
  data: Buffer,
  isBinary: boolean,
): void {
  if (socket.readyState !== 1) return;
  if (isBinary) {
    socket.send(new Uint8Array(data));
    return;
  }
  socket.send(data.toString());
}

interface GatewayWebSocketMessage {
  data: Buffer;
  isBinary: boolean;
}

function sendGatewayWebSocketMessage(
  socket: NodeWebSocket,
  message: GatewayWebSocketMessage,
): void {
  socket.send(message.data, { binary: message.isBinary });
}

export function registerMiniAppRoutes(
  app: Hono,
  service: EvaMiniAppService,
): void {
  app.get("/mini-apps/deployments", (context) => {
    requireAdmin(context);
    return context.json(service.listDeployments().map(deploymentSummary));
  });

  app.post("/mini-apps/deployments", async (context) => {
    const actor = requireAdmin(context);
    const input = await parseBody(context, deploymentSchema);
    const deployment = service.createDeployment(input, actor);
    return context.json(deploymentSummary(deployment), 201);
  });

  app.post("/mini-apps/deployments/:id/revoke", (context) => {
    requireAdmin(context);
    service.revokeDeployment(context.req.param("id"));
    return context.json({ ok: true });
  });

  app.get("/mini-apps/links", (context) => {
    const actor = requireUser(context);
    return context.json(service.listLinks(actor));
  });

  app.post("/mini-apps/links", async (context) => {
    const actor = requireUser(context);
    const input = await parseBody(context, linkSchema);
    const result = service.createLink(input, actor);
    return context.json(
      {
        ...result.link,
        handoff: result.handoff,
        requiresRecipientHandoff: result.handoff === null,
      },
      201,
    );
  });

  app.post("/mini-apps/links/:id/handoff", (context) => {
    const actor = requireUser(context);
    return context.json(service.createHandoff(context.req.param("id"), actor));
  });

  app.post("/mini-apps/links/:id/revoke", (context) => {
    const actor = requireUser(context);
    service.revokeLink(context.req.param("id"), actor);
    return context.json({ ok: true });
  });
}

export function registerMiniAppGateway(
  app: Hono,
  service: EvaMiniAppService,
  upgradeWebSocket: UpgradeWebSocket,
): void {
  app.use("*", async (context, next) => {
    if (context.req.header("upgrade")?.toLowerCase() === "websocket") {
      return next();
    }
    const response = await service.handleGatewayRequest(context.req.raw);
    return response ?? next();
  });

  const gatewayWebSocket = upgradeWebSocket(async (context) => {
    const session = service.resolveGatewayWebSocket(context.req.raw);
    if (session === null) {
      throw new ApiError(404, "not_found", "Not found");
    }
    const upstream = new NodeWebSocket(
      service.buildLoopbackWebSocketUrl(context.req.raw, session.deployment),
      websocketProtocols(context.req.header("sec-websocket-protocol")),
      {
        headers: service.requestHeadersForWebSocket(context.req.raw, session),
      },
    );
    let client: WSContext | null = null;
    let upstreamOpened = false;
    let bridgeClosed = false;
    const pendingClientMessages: GatewayWebSocketMessage[] = [];
    const pendingUpstreamMessages: GatewayWebSocketMessage[] = [];
    let pendingClientBytes = 0;
    let pendingUpstreamBytes = 0;
    const clearPendingMessages = (): void => {
      pendingClientMessages.length = 0;
      pendingUpstreamMessages.length = 0;
      pendingClientBytes = 0;
      pendingUpstreamBytes = 0;
    };
    const failBridge = (code: number, reason: string): void => {
      bridgeClosed = true;
      clearPendingMessages();
      client?.close(code, reason);
      upstream.terminate();
    };
    const flushClientMessages = (): void => {
      if (bridgeClosed || upstream.readyState !== NodeWebSocket.OPEN) return;
      const pending = pendingClientMessages.splice(0);
      pendingClientBytes = 0;
      for (const message of pending) {
        if (bridgeClosed || upstream.readyState !== NodeWebSocket.OPEN) {
          clearPendingMessages();
          return;
        }
        try {
          sendGatewayWebSocketMessage(upstream, message);
        } catch {
          failBridge(1011, "Mini-app WebSocket unavailable");
          return;
        }
      }
    };
    const enqueueClientMessage = (message: GatewayWebSocketMessage): void => {
      if (bridgeClosed) return;
      if (upstream.readyState === NodeWebSocket.OPEN) {
        try {
          sendGatewayWebSocketMessage(upstream, message);
        } catch {
          failBridge(1011, "Mini-app WebSocket unavailable");
        }
        return;
      }
      if (upstream.readyState !== NodeWebSocket.CONNECTING) {
        failBridge(1011, "Mini-app WebSocket unavailable");
        return;
      }
      if (
        pendingClientMessages.length >=
          MAX_PENDING_GATEWAY_WEBSOCKET_MESSAGES ||
        pendingClientBytes + message.data.byteLength >
          MAX_PENDING_GATEWAY_WEBSOCKET_BYTES
      ) {
        failBridge(1013, "Mini-app WebSocket backlog exceeded");
        return;
      }
      pendingClientMessages.push(message);
      pendingClientBytes += message.data.byteLength;
    };
    upstream.on("open", () => {
      upstreamOpened = true;
      flushClientMessages();
    });
    upstream.on("message", (data: Buffer, isBinary: boolean) => {
      if (bridgeClosed) return;
      if (client === null) {
        if (
          pendingUpstreamMessages.length >=
            MAX_PENDING_GATEWAY_WEBSOCKET_MESSAGES ||
          pendingUpstreamBytes + data.byteLength >
            MAX_PENDING_GATEWAY_WEBSOCKET_BYTES
        ) {
          failBridge(1013, "Mini-app WebSocket backlog exceeded");
          return;
        }
        pendingUpstreamMessages.push({ data: Buffer.from(data), isBinary });
        pendingUpstreamBytes += data.byteLength;
        return;
      }
      forwardWebSocketMessage(client, data, isBinary);
    });
    upstream.on("close", (code: number, reason: Buffer) => {
      bridgeClosed = true;
      clearPendingMessages();
      client?.close(code === 1000 ? 1000 : 1011, reason.toString());
    });
    upstream.on("error", () => {
      bridgeClosed = true;
      clearPendingMessages();
      client?.close(1011, "Mini-app WebSocket unavailable");
    });
    return {
      onOpen: (_event, socket) => {
        client = socket;
        for (const message of pendingUpstreamMessages) {
          forwardWebSocketMessage(socket, message.data, message.isBinary);
        }
        pendingUpstreamMessages.length = 0;
        pendingUpstreamBytes = 0;
        if (bridgeClosed) {
          socket.close(1011, "Mini-app WebSocket unavailable");
          return;
        }
        if (
          upstream.readyState !== NodeWebSocket.OPEN &&
          upstreamOpened === false
        ) {
          return;
        }
        if (upstream.readyState !== NodeWebSocket.OPEN) {
          socket.close(1011, "Mini-app WebSocket unavailable");
        }
      },
      onMessage: (event: { data: WSMessageReceive }, socket) => {
        if (bridgeClosed) return;
        if (typeof event.data === "string") {
          enqueueClientMessage({
            data: Buffer.from(event.data),
            isBinary: false,
          });
        } else if (event.data instanceof ArrayBuffer) {
          enqueueClientMessage({
            data: Buffer.from(event.data),
            isBinary: true,
          });
        } else if (ArrayBuffer.isView(event.data)) {
          enqueueClientMessage({
            data: Buffer.from(
              event.data.buffer,
              event.data.byteOffset,
              event.data.byteLength,
            ),
            isBinary: true,
          });
        } else if (event.data instanceof Blob) {
          void event.data
            .arrayBuffer()
            .then((data) =>
              enqueueClientMessage({
                data: Buffer.from(data),
                isBinary: true,
              }),
            )
            .catch(() => failBridge(1011, "Mini-app WebSocket unavailable"));
        }
      },
      onClose: () => {
        bridgeClosed = true;
        clearPendingMessages();
        upstream.close();
        client = null;
      },
      onError: () => {
        bridgeClosed = true;
        clearPendingMessages();
        upstream.terminate();
        client = null;
      },
    };
  });
  app.get("*", (context, next) => {
    if (context.req.header("upgrade")?.toLowerCase() !== "websocket") {
      return next();
    }
    const host = context.req.header("host") ?? new URL(context.req.url).host;
    if (service.gatewayHost(host) === null) {
      return next();
    }
    return gatewayWebSocket(context, next);
  });
}

export function createMiniAppService(
  deps: Pick<AppDeps, "config" | "coreAuth" | "db">,
): EvaMiniAppService {
  if (deps.coreAuth === undefined) {
    throw new Error("Mini-app gateway requires core auth");
  }
  return createEvaMiniAppService({
    config: deps.config,
    coreAuth: deps.coreAuth,
    db: deps.db,
  });
}
