import {
  clientMessageSchema,
  realtimeSubscriptionTargetKey,
  type PongMessage,
} from "@bb/domain";
import type { DbConnection } from "@bb/db";
import { parseSocketMessage } from "./decode-payload.js";
import type { ClientRealtimeAccess, NotificationHub } from "./hub.js";
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

/** EVA access checks applied to realtime subscriptions. */
export interface ClientSocketAccessDeps {
  db?: DbConnection;
  coreAuth?: Pick<CoreAuthService, "resolveSessionId">;
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
  hub: NotificationHub,
  socket: ClientSocket,
  raw: unknown,
  accessDeps: ClientSocketAccessDeps = {},
): void {
  let authContext = clientAuthContexts.get(socket) ?? null;
  if (authContext !== null && accessDeps.coreAuth !== undefined) {
    authContext = accessDeps.coreAuth.resolveSessionId(authContext.sessionId);
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
    case "subscribe": {
      const targets =
        parsed.targets ?? (parsed.target ? [parsed.target] : []);
      const db = accessDeps.db;
      if (
        db !== undefined &&
        targets.some(
          (target) => !canAccessRealtimeTarget(db, authContext, target),
        )
      ) {
        socket.close(4403, "Forbidden");
        return;
      }
      for (const target of targets) {
        hub.subscribe(
          socket,
          target,
          parsed.timelineTags === undefined
            ? undefined
            : (parsed.timelineTags[realtimeSubscriptionTargetKey(target)] ??
                null),
        );
      }
      break;
    }
    case "unsubscribe":
      for (const target of parsed.targets ??
        (parsed.target ? [parsed.target] : [])) {
        hub.unsubscribe(socket, target);
      }
      break;
    case "ping":
      socket.send(JSON.stringify(PONG_MESSAGE));
      break;
    case "visibility":
      hub.setClientVisible(socket, parsed.visible);
      break;
    default: {
      const _exhaustive: never = parsed;
      throw new Error(`Unhandled client message: ${_exhaustive}`);
    }
  }
}

export function onClientSocketClose(
  hub: NotificationHub,
  socket: ClientSocket,
): void {
  clientAuthContexts.delete(socket);
  hub.unregisterClient(socket);
}
