import { clientMessageSchema, type PongMessage } from "@bb/domain";
import type { DbConnection } from "@bb/db";
import { parseSocketMessage } from "./decode-payload.js";
import type { ClientRealtimeAccess, NotificationHub } from "./hub.js";
import type { WatchInterestCoordinator } from "./watch-interests.js";
import {
  canAccessRealtimeTarget,
  type CoreAuthContext,
} from "../access-policy.js";
import type { CoreAuthService } from "../core-auth.js";

const PONG_MESSAGE: PongMessage = { type: "pong" };
const clientAuthContexts = new WeakMap<ClientSocket, CoreAuthContext | null>();

interface ClientSocket {
  close(code?: number, reason?: string): void;
  send(data: string): void;
}

export function onClientSocketOpen(
  hub: NotificationHub,
  socket: ClientSocket,
  authContext: CoreAuthContext | null = null,
  access?: ClientRealtimeAccess,
): void {
  clientAuthContexts.set(socket, authContext);
  hub.registerClient(socket, access);
}

export function onClientSocketMessage(
  deps: {
    db?: DbConnection;
    hub: NotificationHub;
    coreAuth?: CoreAuthService;
    watchInterests: Pick<
      WatchInterestCoordinator,
      "subscribe" | "unsubscribe" | "releaseSocket"
    >;
  },
  socket: ClientSocket,
  raw: unknown,
): void {
  let authContext = clientAuthContexts.get(socket) ?? null;
  if (authContext !== null && deps.coreAuth !== undefined) {
    authContext = deps.coreAuth.resolveSessionId(authContext.sessionId);
    if (authContext === null) {
      socket.close(4401, "Unauthorized");
      return;
    }
    clientAuthContexts.set(socket, authContext);
  }
  const parsed = parseSocketMessage(socket, raw, clientMessageSchema);
  if (parsed === null) {
    return;
  }

  switch (parsed.type) {
    case "subscribe":
      if (
        deps.db !== undefined &&
        !canAccessRealtimeTarget(deps.db, authContext, parsed.target)
      ) {
        socket.close(4403, "Forbidden");
        return;
      }
      deps.hub.subscribe(socket, parsed.target);
      deps.watchInterests.subscribe(socket, parsed.target);
      break;
    case "unsubscribe":
      deps.hub.unsubscribe(socket, parsed.target);
      deps.watchInterests.unsubscribe(socket, parsed.target);
      break;
    case "ping":
      socket.send(JSON.stringify(PONG_MESSAGE));
      break;
    default: {
      const _exhaustive: never = parsed;
      throw new Error(`Unhandled client message: ${_exhaustive}`);
    }
  }
}

export function onClientSocketClose(
  deps: {
    hub: NotificationHub;
    watchInterests: Pick<WatchInterestCoordinator, "releaseSocket">;
  },
  socket: ClientSocket,
): void {
  clientAuthContexts.delete(socket);
  deps.watchInterests.releaseSocket(socket);
  deps.hub.unregisterClient(socket);
}
