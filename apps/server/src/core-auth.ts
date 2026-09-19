import { randomBytes, randomUUID } from "node:crypto";
import { and, count, eq, gt, sql } from "drizzle-orm";
import { betterAuth } from "better-auth";
import { getSessionCookie } from "better-auth/cookies";
import { hashPassword } from "better-auth/crypto";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import {
  authAccounts,
  authPolicies,
  authPrincipals,
  authSessions,
  authUsers,
  authVerifications,
  type DbConnection,
} from "@bb/db";
import type { ServerRuntimeConfig } from "./types.js";
import {
  defaultAdminPolicy,
  defaultDenyPolicy,
  defaultUserPolicy,
  resolveCoreResourceAccess,
  resolveCorePolicy,
  type CoreAuthContext,
  type CoreRole,
  type CoreStatus,
} from "./access-policy.js";
import {
  listEvaAgentProviderIds,
  listEvaAgentsFromDb,
} from "./agents/eva-agent-registry.js";

const coreAuthSchema = {
  user: authUsers,
  session: authSessions,
  account: authAccounts,
  verification: authVerifications,
};

export interface CoreAuthService {
  readonly required: boolean;
  readonly auth: unknown;
  handle(request: Request): Promise<Response>;
  hasSessionCookie(request: Request): boolean;
  resolveRequest(request: Request): Promise<CoreAuthContext | null>;
  resolveSessionId(sessionId: string): CoreAuthContext | null;
  bootstrapConfiguredOwner(): Promise<boolean>;
  revokeUserSessions(userId: string): void;
  setUserAccess(args: {
    userId: string;
    role?: CoreRole;
    status?: CoreStatus;
    policyId?: string;
  }): boolean;
}

interface CreateCoreAuthServiceArgs {
  db: DbConnection;
  config: Pick<
    ServerRuntimeConfig,
    "appUrl" | "isDevelopment" | "serverPort" | "authRequired"
  >;
  env?: NodeJS.ProcessEnv;
}

function isTokenBearingAuthPath(pathname: string): boolean {
  return (
    pathname.endsWith("/sign-in/email") ||
    pathname.endsWith("/sign-in/social") ||
    pathname.endsWith("/sign-up/email")
  );
}

const AUTH_RESPONSE_SENSITIVE_KEYS = new Set([
  "token",
  "accesstoken",
  "refreshtoken",
  "idtoken",
  "sessiontoken",
  "password",
  "secret",
]);

function sanitizeAuthResponsePayload(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeAuthResponsePayload(entry));
  }
  if (typeof value !== "object" || value === null) return value;
  const sanitized: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    const normalizedKey = key.replace(/[-_]/gu, "").toLowerCase();
    if (AUTH_RESPONSE_SENSITIVE_KEYS.has(normalizedKey)) continue;
    sanitized[key] = sanitizeAuthResponsePayload(entry);
  }
  return sanitized;
}

async function stripAuthResponseToken(
  request: Request,
  response: Response,
): Promise<Response> {
  if (!isTokenBearingAuthPath(new URL(request.url).pathname)) {
    return response;
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return response;
  }
  const body: unknown = await response
    .clone()
    .json()
    .catch(() => null);
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return response;
  }
  const safeBody = sanitizeAuthResponsePayload(body);
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  return new Response(JSON.stringify(safeBody), {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}

function parseBoolean(value: string): boolean | null {
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "y"].includes(normalized)) return true;
  if (["0", "false", "no", "n"].includes(normalized)) return false;
  return null;
}

export function resolveCoreAuthRequired(args: {
  isDevelopment: boolean;
  env?: NodeJS.ProcessEnv;
}): boolean {
  const env = args.env ?? process.env;
  const raw = env.BB_AUTH_REQUIRED;
  if (raw === undefined) {
    if (env.NODE_ENV === "test") return false;
    return !args.isDevelopment;
  }
  const parsed = parseBoolean(raw);
  if (parsed === null) throw new Error("BB_AUTH_REQUIRED must be a boolean");
  if (!parsed && !args.isDevelopment) {
    throw new Error("BB_AUTH_REQUIRED cannot be disabled outside development");
  }
  return parsed;
}

function resolveAuthSecret(args: CreateCoreAuthServiceArgs): string {
  const env = args.env ?? process.env;
  const configured = env.BB_AUTH_SECRET?.trim();
  if (configured) return configured;
  if (env.NODE_ENV === "test") return randomBytes(32).toString("hex");
  if (!args.config.isDevelopment) {
    throw new Error("BB_AUTH_SECRET is required outside development");
  }
  return randomBytes(32).toString("hex");
}

function policyJson(value: typeof defaultAdminPolicy): string {
  return JSON.stringify(value);
}

const LEGACY_BUILT_IN_USER_POLICY_REVISION = 1;
const LEGACY_BUILT_IN_USER_POLICY_JSON = policyJson(defaultDenyPolicy);

function ensureDefaultPolicies(db: DbConnection): void {
  const now = Date.now();
  db.insert(authPolicies)
    .values([
      {
        id: "admin",
        role: "admin",
        policyJson: policyJson(defaultAdminPolicy),
        revision: 1,
        updatedAt: now,
      },
      {
        id: "user",
        role: "user",
        policyJson: policyJson(defaultUserPolicy),
        revision: 1,
        updatedAt: now,
      },
    ])
    .onConflictDoNothing()
    .run();
  const legacyUserPolicy = db
    .select({
      role: authPolicies.role,
      policyJson: authPolicies.policyJson,
      revision: authPolicies.revision,
    })
    .from(authPolicies)
    .where(eq(authPolicies.id, "user"))
    .get();
  if (
    legacyUserPolicy?.role === "user" &&
    legacyUserPolicy.revision === LEGACY_BUILT_IN_USER_POLICY_REVISION &&
    legacyUserPolicy.policyJson === LEGACY_BUILT_IN_USER_POLICY_JSON
  ) {
    db.update(authPolicies)
      .set({
        policyJson: policyJson(defaultUserPolicy),
        revision: LEGACY_BUILT_IN_USER_POLICY_REVISION + 1,
        updatedAt: now,
      })
      .where(eq(authPolicies.id, "user"))
      .run();
  }
}

function getUser(db: DbConnection, userId: string) {
  return db.select().from(authUsers).where(eq(authUsers.id, userId)).get();
}

function contextForSession(
  db: DbConnection,
  args: { sessionId: string; userId: string },
): CoreAuthContext | null {
  const user = getUser(db, args.userId);
  const resolved = resolveCorePolicy(db, args.userId);
  if (!user || !resolved) return null;
  return {
    userId: user.id,
    email: user.email,
    name: user.name,
    sessionId: args.sessionId,
    role: resolved.role,
    policy: resolved.policy,
    policyRevision: resolved.revision,
    defaultAgentId: resolved.defaultAgentId,
    resourceAccess: resolveCoreResourceAccess(db, args.userId),
    evaAgents: listEvaAgentsFromDb(db),
    evaAgentProviderIds: listEvaAgentProviderIds(db),
  };
}

export function createCoreAuthService(
  args: CreateCoreAuthServiceArgs,
): CoreAuthService {
  const env = args.env ?? process.env;
  const required =
    args.config.authRequired ??
    resolveCoreAuthRequired({ isDevelopment: args.config.isDevelopment, env });
  ensureDefaultPolicies(args.db);
  const baseURL =
    args.config.appUrl ?? `http://127.0.0.1:${args.config.serverPort}`;
  const secureCookies = !args.config.isDevelopment;
  const auth = betterAuth({
    baseURL,
    basePath: "/api/auth",
    secret: resolveAuthSecret(args),
    database: drizzleAdapter(args.db, {
      provider: "sqlite",
      schema: coreAuthSchema,
    }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      requireEmailVerification: true,
      revokeSessionsOnPasswordReset: true,
    },
    advanced: {
      useSecureCookies: secureCookies,
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: "lax",
        secure: secureCookies,
      },
    },
    trustedOrigins: [baseURL],
    telemetry: {
      enabled: false,
    },
  });

  return {
    required,
    auth,
    async handle(request: Request): Promise<Response> {
      return stripAuthResponseToken(request, await auth.handler(request));
    },
    hasSessionCookie(request: Request): boolean {
      return getSessionCookie(request) !== null;
    },
    async resolveRequest(request: Request): Promise<CoreAuthContext | null> {
      try {
        const session = await auth.api.getSession({ headers: request.headers });
        if (!session) return null;
        return contextForSession(args.db, {
          sessionId: session.session.id,
          userId: session.user.id,
        });
      } catch {
        return null;
      }
    },
    resolveSessionId(sessionId: string): CoreAuthContext | null {
      const session = args.db
        .select({ id: authSessions.id, userId: authSessions.userId })
        .from(authSessions)
        .where(
          and(
            eq(authSessions.id, sessionId),
            gt(authSessions.expiresAt, new Date()),
          ),
        )
        .get();
      return session === undefined
        ? null
        : contextForSession(args.db, {
            sessionId: session.id,
            userId: session.userId,
          });
    },
    async bootstrapConfiguredOwner(): Promise<boolean> {
      const principalCount =
        args.db.select({ value: count() }).from(authPrincipals).get()?.value ??
        0;
      if (principalCount > 0) return false;
      const email = env.BB_AUTH_OWNER_EMAIL?.trim().toLowerCase();
      const password = env.BB_AUTH_OWNER_PASSWORD;
      if ((email === undefined) !== (password === undefined)) {
        throw new Error(
          "BB_AUTH_OWNER_EMAIL and BB_AUTH_OWNER_PASSWORD must be configured together",
        );
      }
      if (email === undefined || password === undefined) {
        if (required) {
          throw new Error(
            "The first core-auth boot requires BB_AUTH_OWNER_EMAIL and BB_AUTH_OWNER_PASSWORD",
          );
        }
        return false;
      }
      if (
        !email.includes("@") ||
        password.length < 12 ||
        password.length > 128
      ) {
        throw new Error(
          "BB_AUTH_OWNER_EMAIL must be an email and BB_AUTH_OWNER_PASSWORD must contain 12 to 128 characters",
        );
      }
      const existingUsers = args.db
        .select({ id: authUsers.id })
        .from(authUsers)
        .where(sql`lower(${authUsers.email}) = ${email}`)
        .all();
      if (existingUsers.length > 1) {
        throw new Error(
          "The configured core-auth owner email matches multiple users",
        );
      }
      const existing = existingUsers[0];
      const userId = existing?.id ?? randomUUID();
      const existingCredentialAccount = existing
        ? args.db
            .select({ id: authAccounts.id })
            .from(authAccounts)
            .where(
              and(
                eq(authAccounts.userId, userId),
                eq(authAccounts.providerId, "credential"),
              ),
            )
            .get()
        : undefined;
      const now = new Date();
      const passwordHash = await hashPassword(password);
      args.db.transaction((tx) => {
        if (!existing) {
          tx.insert(authUsers)
            .values({
              id: userId,
              name: email,
              email,
              emailVerified: true,
              image: null,
              createdAt: now,
              updatedAt: now,
            })
            .run();
        } else {
          tx.update(authUsers)
            .set({ email, emailVerified: true, updatedAt: now })
            .where(eq(authUsers.id, userId))
            .run();
        }
        if (existingCredentialAccount) {
          tx.update(authAccounts)
            .set({ password: passwordHash, updatedAt: now })
            .where(eq(authAccounts.id, existingCredentialAccount.id))
            .run();
        } else {
          tx.insert(authAccounts)
            .values({
              id: randomUUID(),
              accountId: userId,
              providerId: "credential",
              userId,
              accessToken: null,
              refreshToken: null,
              idToken: null,
              accessTokenExpiresAt: null,
              refreshTokenExpiresAt: null,
              scope: null,
              password: passwordHash,
              createdAt: now,
              updatedAt: now,
            })
            .run();
        }
        tx.insert(authPrincipals)
          .values({
            userId,
            role: "admin",
            status: "active",
            policyId: "admin",
            revision: 1,
            updatedAt: Date.now(),
          })
          .onConflictDoNothing()
          .run();
      });
      return true;
    },
    revokeUserSessions(userId: string): void {
      args.db.delete(authSessions).where(eq(authSessions.userId, userId)).run();
    },
    setUserAccess(access): boolean {
      const existing = args.db
        .select({ userId: authPrincipals.userId })
        .from(authPrincipals)
        .where(eq(authPrincipals.userId, access.userId))
        .get();
      if (!existing) return false;
      const next = args.db
        .update(authPrincipals)
        .set({
          ...(access.role === undefined ? {} : { role: access.role }),
          ...(access.status === undefined ? {} : { status: access.status }),
          ...(access.policyId === undefined
            ? {}
            : { policyId: access.policyId }),
          revision: sql`${authPrincipals.revision} + 1`,
          updatedAt: Date.now(),
        })
        .where(eq(authPrincipals.userId, access.userId))
        .returning({ userId: authPrincipals.userId })
        .get();
      if (!next) return false;
      if (access.status === "revoked" || access.status === "disabled") {
        args.db
          .delete(authSessions)
          .where(eq(authSessions.userId, access.userId))
          .run();
      }
      return true;
    },
  };
}
