import { z } from "zod";
import type { CreateSdkAreaArgs } from "./common.js";

const managedUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  emailVerified: z.boolean(),
  role: z.enum(["admin", "user"]),
  status: z.enum(["active", "revoked", "disabled"]),
  policyId: z.string(),
  defaultAgentId: z.string().nullable(),
  policyRevision: z.number(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

const managedGrantSchema = z.object({
  id: z.string(),
  userId: z.string().nullable(),
  groupId: z.string().nullable(),
  agentId: z.string(),
  providerIds: z.array(z.string()),
  modelPatterns: z.array(z.string()),
  reasoningLevels: z.array(z.string()),
  fixedExecution: z.boolean(),
  permissionMode: z.string().nullable(),
  terminalAccess: z.string(),
  toolIds: z.array(z.string()),
  pluginIds: z.array(z.string()),
  createdAt: z.number(),
  updatedAt: z.number(),
});

const userAgentsResultSchema = z.object({
  agentIds: z.array(z.string()),
  grants: z.array(managedGrantSchema),
});

const okSchema = z.object({ ok: z.literal(true) });

const createdManagedUserSchema = managedUserSchema.extend({
  generatedPassword: z.string().optional(),
});

const managedUserDetailSchema = managedUserSchema.extend({
  groups: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      policyId: z.string(),
    }),
  ),
  grants: z.array(managedGrantSchema),
});

export type ManagedUser = z.infer<typeof managedUserSchema>;
export type ManagedUserDetail = z.infer<typeof managedUserDetailSchema>;
export type ManagedGrant = z.infer<typeof managedGrantSchema>;
export type UserAgentsResult = z.infer<typeof userAgentsResultSchema>;
export type CreatedManagedUser = ManagedUser & { generatedPassword?: string };

export interface AccessUserCreateInput {
  email: string;
  name: string;
  password?: string;
  role: "admin" | "user";
  policyId: string;
  defaultAgentId?: string | null;
  agentIds?: readonly string[];
  signal?: AbortSignal;
}

export interface AccessUserUpdateInput {
  userId: string;
  email?: string;
  name?: string;
  role?: "admin" | "user";
  status?: "active" | "revoked" | "disabled";
  policyId?: string;
  defaultAgentId?: string | null;
  signal?: AbortSignal;
}

export interface AccessUserIdArgs {
  userId: string;
  signal?: AbortSignal;
}

export interface AccessUserAgentsInput extends AccessUserIdArgs {
  agentIds: readonly string[];
}

export interface AccessArea {
  listUsers(args?: { signal?: AbortSignal }): Promise<ManagedUser[]>;
  getUser(args: AccessUserIdArgs): Promise<ManagedUserDetail>;
  createUser(args: AccessUserCreateInput): Promise<CreatedManagedUser>;
  updateUser(args: AccessUserUpdateInput): Promise<ManagedUser>;
  deleteUser(args: AccessUserIdArgs): Promise<{ ok: true }>;
  setUserAgents(args: AccessUserAgentsInput): Promise<UserAgentsResult>;
}

export function createAccessArea(args: CreateSdkAreaArgs): AccessArea {
  const { transport } = args;

  async function requestParsed<T>(
    path: string,
    schema: { parse(value: unknown): T },
    init?: RequestInit,
  ): Promise<T> {
    const baseUrl = transport.baseUrl.replace(/\/$/u, "");
    const response = await transport.resolve(
      transport.fetch(`${baseUrl}${path}`, init),
    );
    return schema.parse(await response.json());
  }

  const userPath = (userId: string): string =>
    `/api/v1/access/users/${encodeURIComponent(userId)}`;

  return {
    async listUsers(input = {}) {
      return requestParsed("/api/v1/access/users", z.array(managedUserSchema), {
        signal: input.signal,
      });
    },
    async getUser(input) {
      return requestParsed(userPath(input.userId), managedUserDetailSchema, {
        signal: input.signal,
      });
    },
    async createUser(input) {
      const created = await requestParsed(
        "/api/v1/access/users",
        createdManagedUserSchema,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            email: input.email,
            name: input.name,
            ...(input.password === undefined ? {} : { password: input.password }),
            role: input.role,
            policyId: input.policyId,
            ...(input.defaultAgentId === undefined
              ? {}
              : { defaultAgentId: input.defaultAgentId }),
          }),
          signal: input.signal,
        },
      );
      if (input.agentIds !== undefined) {
        await requestParsed(`${userPath(created.id)}/agents`, userAgentsResultSchema, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ agentIds: [...input.agentIds] }),
          signal: input.signal,
        });
      }
      return created;
    },
    async updateUser(input) {
      return requestParsed(userPath(input.userId), managedUserSchema, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...(input.email === undefined ? {} : { email: input.email }),
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.role === undefined ? {} : { role: input.role }),
          ...(input.status === undefined ? {} : { status: input.status }),
          ...(input.policyId === undefined ? {} : { policyId: input.policyId }),
          ...(input.defaultAgentId === undefined
            ? {}
            : { defaultAgentId: input.defaultAgentId }),
        }),
        signal: input.signal,
      });
    },
    async deleteUser(input) {
      return requestParsed(userPath(input.userId), okSchema, {
        method: "DELETE",
        signal: input.signal,
      });
    },
    async setUserAgents(input) {
      return requestParsed(`${userPath(input.userId)}/agents`, userAgentsResultSchema, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agentIds: [...input.agentIds] }),
        signal: input.signal,
      });
    },
  };
}
