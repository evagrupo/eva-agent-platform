import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import {
  authGroupMembers,
  authGroups,
  authPrincipals,
  authUsers,
  evaMiniAppDeployments,
  evaMiniAppHandoffs,
  evaMiniAppLinks,
  evaMiniAppSessions,
  type DbConnection,
} from "@bb/db";
import {
  isAgentAllowedByPolicy,
  resolveCorePolicy,
} from "../../access-policy.js";
import { listEvaAgentIds } from "../../agents/eva-agent-registry.js";
import { ApiError } from "../../errors.js";
import type { CoreAuthService } from "../../core-auth.js";
import type { CoreAuthContext } from "../../access-policy.js";
import type { ServerRuntimeConfig } from "../../types.js";

export const MINI_APP_HANDOFF_QUERY = "eva_handoff";
export const MINI_APP_SESSION_COOKIE = "eva_app_session";
export const MINI_APP_HANDOFF_TTL_MS = 5 * 60 * 1_000;
export const MINI_APP_SESSION_TTL_MS = 24 * 60 * 60 * 1_000;
export const MINI_APP_MIN_LOOPBACK_PORT = 1_024;

const ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

interface MiniAppServiceDeps {
  config: Pick<
    ServerRuntimeConfig,
    "hostDaemonPort" | "isDevelopment" | "miniAppsPublicDomain" | "serverPort"
  >;
  coreAuth: Pick<CoreAuthService, "resolveSessionId">;
  db: DbConnection;
}

export interface MiniAppDeploymentInput {
  appId: string;
  displayName: string;
  id: string;
  loopbackPort: number;
}

export interface MiniAppLinkInput {
  agentId?: string;
  deploymentId: string;
  expiresInSeconds: number;
  groupId?: string;
  userId?: string;
}

interface MiniAppLinkRow {
  agentId: string | null;
  createdAt: number;
  createdByUserId: string | null;
  deploymentId: string;
  expiresAt: number;
  groupId: string | null;
  id: string;
  revokedAt: number | null;
  userId: string | null;
}

export interface MiniAppLinkSummary extends MiniAppLinkRow {
  url: string;
}

interface GatewayHost {
  deployment: typeof evaMiniAppDeployments.$inferSelect | null;
  deploymentId: string;
}

export interface MiniAppGatewaySession {
  deployment: typeof evaMiniAppDeployments.$inferSelect;
  sessionId: string;
  userId: string;
}

export interface MiniAppHandoffResult {
  expiresAt: number;
  url: string;
}

function hashSecret(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function randomSecret(): string {
  return randomBytes(32).toString("base64url");
}

function parseCookieHeader(
  header: string | null | undefined,
  name: string,
): string | null {
  if (header === null || header === undefined) return null;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    const value = part.slice(separator + 1).trim();
    return value.length > 0 ? value : null;
  }
  return null;
}

function isValidId(value: string): boolean {
  return ID_PATTERN.test(value);
}

function ensureValidId(value: string, field: string): void {
  if (!isValidId(value)) {
    throw new ApiError(
      400,
      "invalid_request",
      `${field} must be a lowercase DNS-safe identifier`,
    );
  }
}

function normalizeHost(value: string | null | undefined): string | null {
  if (
    value === null ||
    value === undefined ||
    value.trim().length === 0 ||
    value.includes(",")
  ) {
    return null;
  }
  return value.trim().toLowerCase().replace(/\.$/u, "");
}

function requestHeadersForLoopback(
  request: Request,
  session: MiniAppGatewaySession,
): Headers {
  const headers = new Headers();
  for (const [name, value] of request.headers) {
    const normalized = name.toLowerCase();
    if (
      HOP_BY_HOP_HEADERS.has(normalized) ||
      normalized === "host" ||
      normalized === "cookie" ||
      normalized === "authorization" ||
      normalized.startsWith("x-forwarded-") ||
      normalized.startsWith("cf-") ||
      normalized.startsWith("sec-websocket-")
    ) {
      continue;
    }
    headers.set(name, value);
  }
  headers.set("x-eva-app-deployment", session.deployment.id);
  headers.set("x-eva-app-user", session.userId);
  return headers;
}

function responseHeadersFromLoopback(response: Response): Headers {
  const headers = new Headers();
  for (const [name, value] of response.headers) {
    const normalized = name.toLowerCase();
    if (
      HOP_BY_HOP_HEADERS.has(normalized) ||
      normalized === "set-cookie" ||
      normalized.startsWith("x-eva-")
    ) {
      continue;
    }
    headers.set(name, value);
  }
  headers.set("cache-control", "no-store");
  headers.set("x-content-type-options", "nosniff");
  return headers;
}

function linkRow(row: typeof evaMiniAppLinks.$inferSelect): MiniAppLinkRow {
  return {
    agentId: row.agentId,
    createdAt: row.createdAt,
    createdByUserId: row.createdByUserId,
    deploymentId: row.deploymentId,
    expiresAt: row.expiresAt,
    groupId: row.groupId,
    id: row.id,
    revokedAt: row.revokedAt,
    userId: row.userId,
  };
}

export class EvaMiniAppService {
  constructor(private readonly deps: MiniAppServiceDeps) {}

  isConfigured(): boolean {
    return (
      this.deps.config.miniAppsPublicDomain !== undefined &&
      this.deps.config.miniAppsPublicDomain.length > 0
    );
  }

  requireConfigured(): string {
    const domain = this.deps.config.miniAppsPublicDomain;
    if (domain === undefined || domain.length === 0) {
      throw new ApiError(
        409,
        "mini_apps_not_configured",
        "Internal mini-app links are not configured",
      );
    }
    return domain;
  }

  createDeployment(
    input: MiniAppDeploymentInput,
    actor: CoreAuthContext,
  ): typeof evaMiniAppDeployments.$inferSelect {
    this.requireConfigured();
    ensureValidId(input.id, "deployment id");
    ensureValidId(input.appId, "app id");
    if (
      input.displayName.trim().length === 0 ||
      input.displayName.length > 160
    ) {
      throw new ApiError(400, "invalid_request", "displayName is invalid");
    }
    this.validateLoopbackPort(input.loopbackPort);
    const existing = this.deps.db
      .select()
      .from(evaMiniAppDeployments)
      .where(
        or(
          eq(evaMiniAppDeployments.id, input.id),
          eq(evaMiniAppDeployments.appId, input.appId),
        ),
      )
      .get();
    if (existing !== undefined) {
      throw new ApiError(
        409,
        "mini_app_deployment_exists",
        "A mini-app deployment with this identifier already exists",
      );
    }
    const now = Date.now();
    const deployment = {
      id: input.id,
      appId: input.appId,
      displayName: input.displayName.trim(),
      loopbackPort: input.loopbackPort,
      createdByUserId: actor.userId,
      revokedAt: null,
      createdAt: now,
      updatedAt: now,
    } satisfies typeof evaMiniAppDeployments.$inferInsert;
    this.deps.db.insert(evaMiniAppDeployments).values(deployment).run();
    return this.deps.db
      .select()
      .from(evaMiniAppDeployments)
      .where(eq(evaMiniAppDeployments.id, input.id))
      .get()!;
  }

  listDeployments(): (typeof evaMiniAppDeployments.$inferSelect)[] {
    return this.deps.db
      .select()
      .from(evaMiniAppDeployments)
      .all()
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  revokeDeployment(id: string): void {
    const result = this.deps.db
      .update(evaMiniAppDeployments)
      .set({ revokedAt: Date.now(), updatedAt: Date.now() })
      .where(
        and(
          eq(evaMiniAppDeployments.id, id),
          isNull(evaMiniAppDeployments.revokedAt),
        ),
      )
      .run();
    if (result.changes === 0) {
      throw new ApiError(404, "not_found", "Mini-app deployment not found");
    }
  }

  createLink(
    input: MiniAppLinkInput,
    actor: CoreAuthContext,
  ): {
    handoff: MiniAppHandoffResult | null;
    link: MiniAppLinkSummary;
  } {
    this.requireConfigured();
    const deployment = this.requireDeployment(input.deploymentId);
    this.validateLinkLifetime(input.expiresInSeconds);
    if (input.userId !== undefined && input.groupId !== undefined) {
      throw new ApiError(
        400,
        "invalid_request",
        "A mini-app link must target one user or one group",
      );
    }
    const targetUserId =
      input.groupId === undefined ? (input.userId ?? actor.userId) : undefined;
    if (input.groupId !== undefined && actor.role !== "admin") {
      throw new ApiError(
        403,
        "policy_denied",
        "Only administrators can create group mini-app links",
      );
    }
    if (
      targetUserId !== undefined &&
      targetUserId !== actor.userId &&
      actor.role !== "admin"
    ) {
      throw new ApiError(
        403,
        "policy_denied",
        "You can only create a mini-app link for your own session",
      );
    }
    if (input.groupId !== undefined) {
      const group = this.deps.db
        .select({ id: authGroups.id })
        .from(authGroups)
        .where(eq(authGroups.id, input.groupId))
        .get();
      if (group === undefined) {
        throw new ApiError(404, "not_found", "Mini-app link group not found");
      }
    } else {
      const target = this.deps.db
        .select({ id: authUsers.id })
        .from(authUsers)
        .innerJoin(authPrincipals, eq(authPrincipals.userId, authUsers.id))
        .where(
          and(
            eq(authUsers.id, targetUserId!),
            eq(authPrincipals.status, "active"),
          ),
        )
        .get();
      if (target === undefined) {
        throw new ApiError(404, "not_found", "Mini-app link user not found");
      }
    }
    if (input.agentId !== undefined) {
      ensureValidId(input.agentId, "agent id");
      if (!listEvaAgentIds(this.deps.db).has(input.agentId)) {
        throw new ApiError(
          400,
          "invalid_request",
          "The selected mini-app agent is not registered",
        );
      }
      if (targetUserId !== undefined && actor.role !== "admin") {
        this.requireAgentForUser(targetUserId, input.agentId);
      }
    }
    const now = Date.now();
    const row = {
      id: randomUUID(),
      deploymentId: deployment.id,
      createdByUserId: actor.userId,
      userId: targetUserId ?? null,
      groupId: input.groupId ?? null,
      agentId: input.agentId ?? null,
      expiresAt: now + input.expiresInSeconds * 1_000,
      revokedAt: null,
      createdAt: now,
      updatedAt: now,
    } satisfies typeof evaMiniAppLinks.$inferInsert;
    this.deps.db.insert(evaMiniAppLinks).values(row).run();
    const link = this.deps.db
      .select()
      .from(evaMiniAppLinks)
      .where(eq(evaMiniAppLinks.id, row.id))
      .get()!;
    const handoff =
      targetUserId === actor.userId
        ? this.createHandoffForLink(link, actor)
        : null;
    return { handoff, link: this.serializeLink(link) };
  }

  createHandoff(linkId: string, actor: CoreAuthContext): MiniAppHandoffResult {
    const link = this.requireLink(linkId);
    this.requireLinkAccess(link, actor);
    return this.createHandoffForLink(link, actor);
  }

  listLinks(actor: CoreAuthContext): MiniAppLinkSummary[] {
    const groupIds = this.deps.db
      .select({ groupId: authGroupMembers.groupId })
      .from(authGroupMembers)
      .where(eq(authGroupMembers.userId, actor.userId))
      .all()
      .map((row) => row.groupId);
    const where =
      actor.role === "admin"
        ? undefined
        : or(
            eq(evaMiniAppLinks.createdByUserId, actor.userId),
            eq(evaMiniAppLinks.userId, actor.userId),
            ...(groupIds.length > 0
              ? [inArray(evaMiniAppLinks.groupId, groupIds)]
              : []),
          );
    return this.deps.db
      .select()
      .from(evaMiniAppLinks)
      .where(where)
      .all()
      .map((link) => this.serializeLink(link));
  }

  revokeLink(id: string, actor: CoreAuthContext): void {
    const link = this.requireLink(id);
    if (
      actor.role !== "admin" &&
      link.createdByUserId !== actor.userId &&
      link.userId !== actor.userId
    ) {
      throw new ApiError(
        403,
        "policy_denied",
        "You cannot revoke this mini-app link",
      );
    }
    this.deps.db
      .update(evaMiniAppLinks)
      .set({ revokedAt: Date.now(), updatedAt: Date.now() })
      .where(eq(evaMiniAppLinks.id, id))
      .run();
  }

  gatewayHost(hostHeader: string | null | undefined): GatewayHost | null {
    const domain = this.deps.config.miniAppsPublicDomain;
    const host = normalizeHost(hostHeader);
    if (domain === undefined || domain.length === 0 || host === null)
      return null;
    const suffix = `.${domain}`;
    if (!host.endsWith(suffix)) return null;
    const deploymentId = host.slice(0, -suffix.length);
    if (!isValidId(deploymentId) || deploymentId.includes(".")) return null;
    const deployment =
      this.deps.db
        .select()
        .from(evaMiniAppDeployments)
        .where(
          and(
            eq(evaMiniAppDeployments.id, deploymentId),
            isNull(evaMiniAppDeployments.revokedAt),
          ),
        )
        .get() ?? null;
    return { deployment, deploymentId };
  }

  async handleGatewayRequest(request: Request): Promise<Response | null> {
    const host = this.gatewayHost(
      request.headers.get("host") ?? new URL(request.url).host,
    );
    if (host === null) return null;
    if (host.deployment === null) {
      throw new ApiError(
        404,
        "mini_app_not_found",
        "Mini-app deployment not found",
      );
    }
    const url = new URL(request.url);
    const handoffToken = url.searchParams.get(MINI_APP_HANDOFF_QUERY);
    if (handoffToken !== null) {
      const session = this.exchangeHandoff({
        deployment: host.deployment,
        token: handoffToken,
      });
      url.searchParams.delete(MINI_APP_HANDOFF_QUERY);
      return new Response(null, {
        status: 303,
        headers: {
          "cache-control": "no-store",
          location: url.toString(),
          "referrer-policy": "no-referrer",
          "set-cookie": this.sessionCookie(session.token, session.expiresAt),
        },
      });
    }
    const session = this.requireGatewaySession(request, host.deployment);
    return this.proxyToLoopback(request, session);
  }

  resolveGatewayWebSocket(request: Request): MiniAppGatewaySession | null {
    const host = this.gatewayHost(
      request.headers.get("host") ?? new URL(request.url).host,
    );
    if (host === null) return null;
    if (host.deployment === null) {
      throw new ApiError(
        404,
        "mini_app_not_found",
        "Mini-app deployment not found",
      );
    }
    if (new URL(request.url).searchParams.has(MINI_APP_HANDOFF_QUERY)) {
      throw new ApiError(
        400,
        "mini_app_handoff_http_only",
        "Exchange a mini-app link over HTTPS before opening a WebSocket",
      );
    }
    return this.requireGatewaySession(request, host.deployment);
  }

  requestHeadersForWebSocket(
    request: Request,
    session: MiniAppGatewaySession,
  ): Record<string, string> {
    const headers = requestHeadersForLoopback(request, session);
    const result: Record<string, string> = {};
    for (const [name, value] of headers) result[name] = value;
    return result;
  }

  buildLoopbackWebSocketUrl(
    request: Request,
    deployment: typeof evaMiniAppDeployments.$inferSelect,
  ): string {
    const url = new URL(request.url);
    return `ws://127.0.0.1:${deployment.loopbackPort}${url.pathname}${url.search}`;
  }

  sessionCookie(token: string, expiresAt: number): string {
    const maxAge = Math.max(1, Math.floor((expiresAt - Date.now()) / 1_000));
    return [
      `${MINI_APP_SESSION_COOKIE}=${encodeURIComponent(token)}`,
      "Path=/",
      "HttpOnly",
      "SameSite=Lax",
      ...(this.deps.config.isDevelopment ? [] : ["Secure"]),
      `Max-Age=${maxAge}`,
    ].join("; ");
  }

  private requireDeployment(
    id: string,
  ): typeof evaMiniAppDeployments.$inferSelect {
    ensureValidId(id, "deployment id");
    const deployment = this.deps.db
      .select()
      .from(evaMiniAppDeployments)
      .where(
        and(
          eq(evaMiniAppDeployments.id, id),
          isNull(evaMiniAppDeployments.revokedAt),
        ),
      )
      .get();
    if (deployment === undefined) {
      throw new ApiError(
        404,
        "mini_app_not_found",
        "Mini-app deployment not found",
      );
    }
    return deployment;
  }

  private requireLink(id: string): typeof evaMiniAppLinks.$inferSelect {
    const link = this.deps.db
      .select()
      .from(evaMiniAppLinks)
      .where(eq(evaMiniAppLinks.id, id))
      .get();
    if (link === undefined) {
      throw new ApiError(
        404,
        "mini_app_link_not_found",
        "Mini-app link not found",
      );
    }
    return link;
  }

  private validateLoopbackPort(port: number): void {
    if (
      !Number.isInteger(port) ||
      port < MINI_APP_MIN_LOOPBACK_PORT ||
      port > 65_535 ||
      port === this.deps.config.serverPort ||
      port === this.deps.config.hostDaemonPort
    ) {
      throw new ApiError(
        400,
        "invalid_loopback_port",
        "The mini-app port must be an unused allowlisted loopback port",
      );
    }
  }

  private validateLinkLifetime(expiresInSeconds: number): void {
    if (
      !Number.isInteger(expiresInSeconds) ||
      expiresInSeconds < 60 ||
      expiresInSeconds > 86_400
    ) {
      throw new ApiError(
        400,
        "invalid_request",
        "expiresInSeconds must be between 60 and 86400",
      );
    }
  }

  private requireAgentForUser(userId: string, agentId: string): void {
    const resolved = resolveCorePolicy(this.deps.db, userId);
    if (
      resolved === null ||
      !isAgentAllowedByPolicy(
        resolved.policy,
        agentId,
        listEvaAgentIds(this.deps.db),
      )
    ) {
      throw new ApiError(
        403,
        "policy_denied",
        "The selected agent is not allowed for this mini-app link",
      );
    }
  }

  private requireLinkAccess(
    link: typeof evaMiniAppLinks.$inferSelect,
    actor: CoreAuthContext,
  ): void {
    if (link.revokedAt !== null || link.expiresAt <= Date.now()) {
      throw new ApiError(
        410,
        "mini_app_link_expired",
        "This mini-app link has expired or been revoked",
      );
    }
    if (actor.role === "admin") return;
    if (link.userId !== null && link.userId !== actor.userId) {
      throw new ApiError(
        403,
        "policy_denied",
        "This mini-app link is not assigned to your account",
      );
    }
    if (link.groupId !== null) {
      const member = this.deps.db
        .select({ userId: authGroupMembers.userId })
        .from(authGroupMembers)
        .where(
          and(
            eq(authGroupMembers.groupId, link.groupId),
            eq(authGroupMembers.userId, actor.userId),
          ),
        )
        .get();
      if (member === undefined) {
        throw new ApiError(
          403,
          "policy_denied",
          "This mini-app link is not assigned to your group",
        );
      }
    }
    if (
      link.agentId !== null &&
      !isAgentAllowedByPolicy(
        actor.policy,
        link.agentId,
        listEvaAgentIds(this.deps.db),
      )
    ) {
      throw new ApiError(
        403,
        "policy_denied",
        "The linked agent is not allowed by your policy",
      );
    }
  }

  private createHandoffForLink(
    link: typeof evaMiniAppLinks.$inferSelect,
    actor: CoreAuthContext,
  ): MiniAppHandoffResult {
    this.requireLinkAccess(link, actor);
    const token = randomSecret();
    const now = Date.now();
    const expiresAt = Math.min(link.expiresAt, now + MINI_APP_HANDOFF_TTL_MS);
    if (expiresAt <= now) {
      throw new ApiError(
        410,
        "mini_app_link_expired",
        "This mini-app link has expired or been revoked",
      );
    }
    this.deps.db
      .insert(evaMiniAppHandoffs)
      .values({
        id: randomUUID(),
        linkId: link.id,
        userId: actor.userId,
        coreSessionId: actor.sessionId,
        tokenHash: hashSecret(token),
        expiresAt,
        exchangedAt: null,
        createdAt: now,
      })
      .run();
    return { expiresAt, url: this.linkUrl(link.deploymentId, token) };
  }

  private exchangeHandoff(args: {
    deployment: typeof evaMiniAppDeployments.$inferSelect;
    token: string;
  }): { expiresAt: number; token: string } {
    if (args.token.length < 32 || args.token.length > 256) {
      throw new ApiError(
        410,
        "mini_app_link_expired",
        "This mini-app handoff is no longer valid",
      );
    }
    const handoffHash = hashSecret(args.token);
    const now = Date.now();
    return this.deps.db.transaction((tx) => {
      const handoff = tx
        .select()
        .from(evaMiniAppHandoffs)
        .where(eq(evaMiniAppHandoffs.tokenHash, handoffHash))
        .get();
      if (
        handoff === undefined ||
        handoff.expiresAt <= now ||
        handoff.exchangedAt !== null
      ) {
        throw new ApiError(
          410,
          "mini_app_link_expired",
          "This mini-app handoff is no longer valid",
        );
      }
      const link = tx
        .select()
        .from(evaMiniAppLinks)
        .where(eq(evaMiniAppLinks.id, handoff.linkId))
        .get();
      if (
        link === undefined ||
        link.deploymentId !== args.deployment.id ||
        link.revokedAt !== null ||
        link.expiresAt <= now
      ) {
        throw new ApiError(
          410,
          "mini_app_link_expired",
          "This mini-app link has expired or been revoked",
        );
      }
      const authContext = this.deps.coreAuth.resolveSessionId(
        handoff.coreSessionId,
      );
      if (authContext === null || authContext.userId !== handoff.userId) {
        throw new ApiError(
          401,
          "unauthorized",
          "The mini-app handoff session is no longer active",
        );
      }
      this.requireLinkAccess(link, authContext);
      const claimed = tx
        .update(evaMiniAppHandoffs)
        .set({ exchangedAt: now })
        .where(
          and(
            eq(evaMiniAppHandoffs.id, handoff.id),
            isNull(evaMiniAppHandoffs.exchangedAt),
          ),
        )
        .run();
      if (claimed.changes !== 1) {
        throw new ApiError(
          410,
          "mini_app_link_expired",
          "This mini-app handoff has already been used",
        );
      }
      const sessionToken = randomSecret();
      const sessionExpiresAt = Math.min(
        link.expiresAt,
        now + MINI_APP_SESSION_TTL_MS,
      );
      tx.insert(evaMiniAppSessions)
        .values({
          id: randomUUID(),
          linkId: link.id,
          deploymentId: link.deploymentId,
          userId: authContext.userId,
          coreSessionId: authContext.sessionId,
          tokenHash: hashSecret(sessionToken),
          expiresAt: sessionExpiresAt,
          revokedAt: null,
          createdAt: now,
          lastSeenAt: now,
        })
        .run();
      return { expiresAt: sessionExpiresAt, token: sessionToken };
    });
  }

  private requireGatewaySession(
    request: Request,
    deployment: typeof evaMiniAppDeployments.$inferSelect,
  ): MiniAppGatewaySession {
    const token = parseCookieHeader(
      request.headers.get("cookie"),
      MINI_APP_SESSION_COOKIE,
    );
    if (token === null) {
      throw new ApiError(
        401,
        "mini_app_authentication_required",
        "Open a current mini-app link to continue",
      );
    }
    let decodedToken: string;
    try {
      decodedToken = decodeURIComponent(token);
    } catch {
      throw new ApiError(
        401,
        "mini_app_authentication_required",
        "Open a current mini-app link to continue",
      );
    }
    const row = this.deps.db
      .select()
      .from(evaMiniAppSessions)
      .where(eq(evaMiniAppSessions.tokenHash, hashSecret(decodedToken)))
      .get();
    const now = Date.now();
    if (
      row === undefined ||
      row.deploymentId !== deployment.id ||
      row.revokedAt !== null ||
      row.expiresAt <= now
    ) {
      throw new ApiError(
        401,
        "mini_app_authentication_required",
        "Open a current mini-app link to continue",
      );
    }
    const authContext = this.deps.coreAuth.resolveSessionId(row.coreSessionId);
    if (authContext === null || authContext.userId !== row.userId) {
      throw new ApiError(
        401,
        "mini_app_authentication_required",
        "Your EVA session is no longer active",
      );
    }
    const link = this.requireLink(row.linkId);
    this.requireLinkAccess(link, authContext);
    this.deps.db
      .update(evaMiniAppSessions)
      .set({ lastSeenAt: now })
      .where(eq(evaMiniAppSessions.id, row.id))
      .run();
    return { deployment, sessionId: row.id, userId: row.userId };
  }

  private async proxyToLoopback(
    request: Request,
    session: MiniAppGatewaySession,
  ): Promise<Response> {
    const url = new URL(request.url);
    const target = `http://127.0.0.1:${session.deployment.loopbackPort}${url.pathname}${url.search}`;
    const init: RequestInit & { duplex?: "half" } = {
      method: request.method,
      headers: requestHeadersForLoopback(request, session),
      redirect: "manual",
      signal: request.signal,
    };
    if (
      request.body !== null &&
      request.method !== "GET" &&
      request.method !== "HEAD"
    ) {
      init.body = request.body;
      init.duplex = "half";
    }
    let response: Response;
    try {
      response = await fetch(target, init);
    } catch {
      throw new ApiError(
        502,
        "mini_app_unavailable",
        "The mini-app is unavailable",
        true,
      );
    }
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeadersFromLoopback(response),
    });
  }

  private serializeLink(
    row: typeof evaMiniAppLinks.$inferSelect,
  ): MiniAppLinkSummary {
    return {
      ...linkRow(row),
      url: this.linkUrl(row.deploymentId, null),
    };
  }

  private linkUrl(deploymentId: string, token: string | null): string {
    const domain = this.requireConfigured();
    const protocol = this.deps.config.isDevelopment ? "http" : "https";
    const url = new URL(`${protocol}://${deploymentId}.${domain}/`);
    if (token !== null) url.searchParams.set(MINI_APP_HANDOFF_QUERY, token);
    return url.toString();
  }
}

export function createEvaMiniAppService(
  args: MiniAppServiceDeps,
): EvaMiniAppService {
  return new EvaMiniAppService(args);
}
