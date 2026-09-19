import {
  publicApiRoutes,
  typedRoutes,
  type PublicApiSchema,
} from "@bb/server-contract";
import type { Hono } from "hono";
import { ApiError } from "../errors.js";
import type { AppDeps } from "../types.js";
import {
  assertResourceAccess,
  assertTerminalAccess,
  canAccessTerminal,
  getCoreAuthContext,
  requireAuthorizedThread,
  requireAuthorizedTerminal,
} from "../access-policy.js";

export function registerTerminalRoutes(app: Hono, deps: AppDeps): void {
  const { get, patch, post } = typedRoutes<PublicApiSchema>(app, {
    onValidationError: (msg) => new ApiError(400, "invalid_request", msg),
  });
  const routes = publicApiRoutes.terminals;

  get(routes.list, (context, query) => {
    const thread =
      query.threadId === undefined
        ? null
        : requireAuthorizedThread(deps.db, context, query.threadId, "read");
    if (query.environmentId !== undefined) {
      assertResourceAccess(
        deps.db,
        context,
        "environment",
        query.environmentId,
        "read",
      );
    }
    if (query.hostId !== undefined) {
      assertResourceAccess(deps.db, context, "host", query.hostId, "read");
    }
    assertTerminalAccess(context, "read", thread?.agentId ?? undefined);
    const sessions = deps.terminalSessions.listTerminals({ query });
    const authContext = getCoreAuthContext(context);
    return context.json({
      sessions: sessions.filter((session) =>
        canAccessTerminal(deps.db, authContext, session.id, "read"),
      ),
    });
  });

  post(routes.create, async (context, payload) => {
    const thread =
      payload.target.kind === "thread"
        ? requireAuthorizedThread(
            deps.db,
            context,
            payload.target.threadId,
            "write",
          )
        : null;
    if (payload.target.kind === "environment") {
      assertResourceAccess(
        deps.db,
        context,
        "environment",
        payload.target.environmentId,
        "write",
      );
    }
    if (payload.target.kind === "host_path") {
      assertResourceAccess(
        deps.db,
        context,
        "host",
        payload.target.hostId,
        "write",
      );
    }
    assertTerminalAccess(
      context,
      payload.start?.mode === "command" ? "controlled" : "full",
      thread?.agentId ?? undefined,
    );
    const session = await deps.terminalSessions.createTerminal({ payload });
    return context.json(session, 201);
  });

  get(routes.get, (context) => {
    requireAuthorizedTerminal(
      deps.db,
      context,
      context.req.param("terminalId"),
      "read",
    );
    const session = deps.terminalSessions.getTerminal({
      terminalId: context.req.param("terminalId"),
    });
    return context.json(session);
  });

  patch(routes.update, (context, payload) => {
    requireAuthorizedTerminal(
      deps.db,
      context,
      context.req.param("terminalId"),
      "controlled",
    );
    const session = deps.terminalSessions.renameTerminal({
      payload,
      terminalId: context.req.param("terminalId"),
    });
    return context.json(session);
  });

  post(routes.restart, async (context) => {
    requireAuthorizedTerminal(
      deps.db,
      context,
      context.req.param("terminalId"),
      "full",
    );
    const session = await deps.terminalSessions.restartTerminal({
      terminalId: context.req.param("terminalId"),
    });
    return context.json(session, 201);
  });

  post(routes.close, async (context, payload) => {
    requireAuthorizedTerminal(
      deps.db,
      context,
      context.req.param("terminalId"),
      "controlled",
    );
    const session = await deps.terminalSessions.closeTerminal({
      payload,
      terminalId: context.req.param("terminalId"),
    });
    return context.json(session);
  });

  post(routes.input, (context, payload) => {
    requireAuthorizedTerminal(
      deps.db,
      context,
      context.req.param("terminalId"),
      "full",
    );
    const session = deps.terminalSessions.sendTerminalInput({
      payload,
      terminalId: context.req.param("terminalId"),
    });
    return context.json(session);
  });

  post(routes.resize, (context, payload) => {
    requireAuthorizedTerminal(
      deps.db,
      context,
      context.req.param("terminalId"),
      "controlled",
    );
    const session = deps.terminalSessions.resizeTerminal({
      payload,
      terminalId: context.req.param("terminalId"),
    });
    return context.json(session);
  });

  get(routes.output, async (context, query) => {
    requireAuthorizedTerminal(
      deps.db,
      context,
      context.req.param("terminalId"),
      "read",
    );
    const output = await deps.terminalSessions.readTerminalOutput({
      query,
      terminalId: context.req.param("terminalId"),
    });
    return context.json(output);
  });
}
