import { hashPassword } from "better-auth/crypto";
import {
  authAccounts,
  authAgentGrants,
  authPrincipals,
  authUsers,
  createThread,
  evaAgentMemories,
  type DbConnection,
} from "@bb/db";
import { createMigratedConnection } from "@bb/db/testing";
import { reasoningLevelValues } from "@bb/domain";
import { describe, expect, it } from "vitest";
import {
  EVA_AGENT_MEMORY_MAX_PER_SCOPE,
  formatEvaAgentMemoryInstructions,
  getEvaAgentMemory,
  listEvaAgentMemories,
  listEvaAgentMemoryTitles,
  looksLikeEvaAgentMemorySecret,
  saveEvaAgentMemory,
  updateEvaAgentMemory,
  type EvaAgentMemoryKind,
  type EvaAgentMemoryScope,
} from "../../src/agents/eva-agent-memories.js";
import { ensureEvaAgentRegistry } from "../../src/agents/eva-agent-registry.js";
import {
  EVA_AGENT_MEMORY_TOOL_NAMES,
  handleEvaAgentToolCall,
} from "../../src/agents/eva-agent-tools.js";
import { ApiError } from "../../src/errors.js";
import { resolveThreadRuntimeCommandConfig } from "../../src/services/threads/thread-runtime-config.js";
import { internalAuthHeaders } from "../helpers/commands.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

const ANA_META: EvaAgentMemoryScope = { agentId: "meta", ownerUserId: "ana" };
const ANA_CRM: EvaAgentMemoryScope = { agentId: "crm", ownerUserId: "ana" };
const LUIS_META: EvaAgentMemoryScope = {
  agentId: "meta",
  ownerUserId: "luis",
};

function insertUser(db: DbConnection, userId: string): void {
  const now = new Date();
  db.insert(authUsers)
    .values({
      id: userId,
      name: userId,
      email: `${userId}@eva.test`,
      emailVerified: true,
      image: null,
      createdAt: now,
      updatedAt: now,
    })
    .run();
}

function withMemoryDb(run: (db: DbConnection) => void): void {
  const db = createMigratedConnection();
  try {
    ensureEvaAgentRegistry(db);
    insertUser(db, "ana");
    insertUser(db, "luis");
    run(db);
  } finally {
    db.$client.close();
  }
}

function insertMemoryRow(
  db: DbConnection,
  scope: EvaAgentMemoryScope,
  values: { id: string; kind: EvaAgentMemoryKind; updatedAt: number },
): void {
  db.insert(evaAgentMemories)
    .values({
      id: values.id,
      agentId: scope.agentId,
      ownerUserId: scope.ownerUserId,
      title: `Memory ${values.id}`,
      body: `Details for ${values.id}`,
      kind: values.kind,
      sourceThreadId: null,
      createdAt: values.updatedAt,
      updatedAt: values.updatedAt,
    })
    .run();
}

function apiErrorCode(run: () => unknown): string | null {
  try {
    run();
  } catch (error) {
    if (error instanceof ApiError) return error.body.code;
    throw error;
  }
  return null;
}

async function seedIdentity(
  db: DbConnection,
  args: { userId: string; role: "admin" | "user"; password: string },
): Promise<void> {
  insertUser(db, args.userId);
  const now = new Date();
  db.insert(authAccounts)
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
  db.insert(authPrincipals)
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

function grantAgent(
  db: DbConnection,
  userId: string,
  agentId: string,
  toolIds: readonly string[],
): void {
  db.insert(authAgentGrants)
    .values({
      id: `${userId}-${agentId}`,
      userId,
      groupId: null,
      agentId,
      providerIdsJson: JSON.stringify(["codex"]),
      modelPatternsJson: JSON.stringify(["*"]),
      reasoningLevelsJson: JSON.stringify([...reasoningLevelValues]),
      fixedExecution: false,
      permissionMode: null,
      terminalAccess: "none",
      toolIdsJson: JSON.stringify(toolIds),
      pluginIdsJson: "[]",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    .run();
}

async function signIn(
  harness: TestAppHarness,
  userId: string,
  password: string,
): Promise<string> {
  const response = await harness.app.request("/api/auth/sign-in/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: `${userId}@eva.test`, password }),
  });
  expect(response.status).toBe(200);
  return response.headers.get("set-cookie")!.split(";", 1)[0]!;
}

function seedWorkspace(harness: TestAppHarness, hostId: string) {
  const { host, session } = seedHostSession(harness.deps, { id: hostId });
  const { project } = seedProjectWithSource(harness.deps, {
    hostId: host.id,
    path: `/tmp/${hostId}`,
  });
  const environment = seedEnvironment(harness.deps, {
    hostId: host.id,
    projectId: project.id,
    path: `/tmp/${hostId}`,
  });
  const thread = (args: {
    ownerUserId: string | null;
    agentId: string;
    parentThreadId?: string;
  }) =>
    createThread(harness.db, harness.hub, {
      projectId: project.id,
      environmentId: environment.id,
      ownerUserId: args.ownerUserId,
      agentId: args.agentId,
      providerId: "codex",
      status: "idle",
      title: `${args.agentId} memory thread`,
      titleFallback: `${args.agentId} memory thread`,
      visibility: "visible",
      ...(args.parentThreadId === undefined
        ? {}
        : { parentThreadId: args.parentThreadId }),
    });
  return { environment, session, thread };
}

function toolResult(
  response: Awaited<ReturnType<typeof handleEvaAgentToolCall>>,
): { success: boolean; body: unknown } {
  const item = response.contentItems[0];
  if (item?.type !== "inputText") throw new Error("Expected text tool output");
  let body: unknown = item.text;
  try {
    body = JSON.parse(item.text);
  } catch {
    body = item.text;
  }
  return { success: response.success, body };
}

describe("EVA agent memory store", () => {
  it("updates a memory with the same normalized title instead of duplicating it", () => {
    withMemoryDb((db) => {
      const created = saveEvaAgentMemory(db, ANA_META, {
        title: "  Prefers   weekly summaries ",
        body: "Send results on Monday mornings.",
        kind: "preference",
        sourceThreadId: "thr_one",
      });
      expect(created.status).toBe("created");
      expect(created.memory.title).toBe("Prefers weekly summaries");
      expect(created.memory.id).toMatch(/^mem_/u);

      const updated = saveEvaAgentMemory(db, ANA_META, {
        title: "prefers WEEKLY summaries!",
        body: "Send results on Monday at 9:00.",
        kind: "preference",
        sourceThreadId: "thr_two",
      });
      expect(updated).toMatchObject({
        status: "updated",
        memory: {
          id: created.memory.id,
          title: "prefers WEEKLY summaries!",
          body: "Send results on Monday at 9:00.",
          sourceThreadId: "thr_two",
        },
      });
      expect(listEvaAgentMemories(db, ANA_META)).toHaveLength(1);

      const otherScope = saveEvaAgentMemory(db, LUIS_META, {
        title: "Prefers weekly summaries",
        body: "Fridays instead.",
        kind: "preference",
        sourceThreadId: null,
      });
      expect(otherScope.status).toBe("created");
      expect(otherScope.memory.id).not.toBe(created.memory.id);

      const second = saveEvaAgentMemory(db, ANA_META, {
        title: "Budget approvals",
        body: "Ask before raising budgets above 500 EUR.",
        kind: "correction",
        sourceThreadId: null,
      });
      expect(
        apiErrorCode(() =>
          saveEvaAgentMemory(db, ANA_META, {
            id: second.memory.id,
            title: "Prefers weekly summaries",
            body: "Conflicting rename",
            kind: "fact",
            sourceThreadId: null,
          }),
        ),
      ).toBe("memory_title_conflict");
      expect(
        apiErrorCode(() =>
          updateEvaAgentMemory(db, ANA_META, second.memory.id, {
            title: "PREFERS weekly summaries",
          }),
        ),
      ).toBe("memory_title_conflict");
      expect(
        apiErrorCode(() =>
          saveEvaAgentMemory(db, LUIS_META, {
            id: second.memory.id,
            title: "Hijacked",
            body: "Another user's memory",
            kind: "fact",
            sourceThreadId: null,
          }),
        ),
      ).toBe("memory_not_found");
      expect(
        updateEvaAgentMemory(db, LUIS_META, second.memory.id, {
          body: "Another user's edit",
        }),
      ).toBeNull();
      expect(getEvaAgentMemory(db, ANA_META, second.memory.id)?.body).toBe(
        "Ask before raising budgets above 500 EUR.",
      );
    });
  });

  it("trims titles and rejects empty or oversized details", () => {
    withMemoryDb((db) => {
      const longTitle = "Campaign naming ".repeat(8);
      const saved = saveEvaAgentMemory(db, ANA_META, {
        title: longTitle,
        body: "Use the brand prefix.",
        kind: "pattern",
        sourceThreadId: null,
      });
      expect(Array.from(saved.memory.title).length).toBeLessThanOrEqual(60);
      expect(longTitle.startsWith(saved.memory.title)).toBe(true);
      expect(
        apiErrorCode(() =>
          saveEvaAgentMemory(db, ANA_META, {
            title: "Too long",
            body: "x".repeat(4_001),
            kind: "fact",
            sourceThreadId: null,
          }),
        ),
      ).toBe("invalid_memory");
      expect(
        apiErrorCode(() =>
          saveEvaAgentMemory(db, ANA_META, {
            title: "  ",
            body: "Details",
            kind: "fact",
            sourceThreadId: null,
          }),
        ),
      ).toBe("invalid_memory");
      expect(
        saveEvaAgentMemory(db, ANA_META, {
          title: "Exactly at the limit",
          body: "y".repeat(4_000),
          kind: "fact",
          sourceThreadId: null,
        }).status,
      ).toBe("created");
    });
  });

  it("keeps at most 200 memories per agent and user, dropping the oldest non-preference first", () => {
    withMemoryDb((db) => {
      for (let index = 0; index < 150; index += 1) {
        insertMemoryRow(db, ANA_META, {
          id: `pref-${index}`,
          kind: "preference",
          updatedAt: index + 1,
        });
      }
      for (let index = 0; index < 50; index += 1) {
        insertMemoryRow(db, ANA_META, {
          id: `fact-${index}`,
          kind: "fact",
          updatedAt: 1_000 + index,
        });
      }
      insertMemoryRow(db, ANA_CRM, { id: "crm-1", kind: "fact", updatedAt: 1 });

      const saved = saveEvaAgentMemory(db, ANA_META, {
        title: "New pattern",
        body: "Short hooks perform better.",
        kind: "pattern",
        sourceThreadId: null,
      });
      const ids = new Set(
        listEvaAgentMemories(db, ANA_META).map((memory) => memory.id),
      );
      expect(ids.size).toBe(EVA_AGENT_MEMORY_MAX_PER_SCOPE);
      expect(ids.has(saved.memory.id)).toBe(true);
      expect(ids.has("fact-0")).toBe(false);
      expect(ids.has("fact-1")).toBe(true);
      expect(ids.has("pref-0")).toBe(true);
      expect(getEvaAgentMemory(db, ANA_CRM, "crm-1")).not.toBeNull();

      for (let index = 0; index < 200; index += 1) {
        insertMemoryRow(db, LUIS_META, {
          id: `luis-pref-${index}`,
          kind: "preference",
          updatedAt: index + 1,
        });
      }
      const fact = saveEvaAgentMemory(db, LUIS_META, {
        title: "Uses the Madrid office",
        body: "Campaigns target Madrid first.",
        kind: "fact",
        sourceThreadId: null,
      });
      const luisIds = new Set(
        listEvaAgentMemories(db, LUIS_META).map((memory) => memory.id),
      );
      expect(luisIds.size).toBe(EVA_AGENT_MEMORY_MAX_PER_SCOPE);
      expect(luisIds.has(fact.memory.id)).toBe(true);
      expect(luisIds.has("luis-pref-0")).toBe(false);
      expect(luisIds.has("luis-pref-1")).toBe(true);
    });
  });

  it("rejects text that looks like a secret without storing it", () => {
    const secrets = [
      "Use sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789 for calls",
      "token ghp_abcdefghijklmnopqrstuvwxyz0123456789",
      "AWS key AKIAIOSFODNN7EXAMPLE",
      "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAA\n-----END OPENSSH PRIVATE KEY-----",
      "password: hunter2!",
      "Contraseña: verano2026",
      "api_key=f3a9c2e1b4d5a6f7",
      "postgres://admin:s3cret@db.example.com/eva",
      "Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456",
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c",
      "The Meta token is EAAGm0PX4ZCpsBAKZCZBaZCZAZBZCxyz1234567890abcdefABCDEF",
      "Kq8ZpW2xYv7RtN4mLs9DfG3hJk6BnC1VxQ0aSe5T",
      "xoxb-123456789012-abcdefghijkl",
    ];
    for (const secret of secrets) {
      expect(looksLikeEvaAgentMemorySecret(secret), secret).toBe(true);
    }
    const ordinary = [
      "Prefers weekly summaries on Monday",
      "Campaign_Summary_Report_2026_Q3_Final_Version",
      "Brief: https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcd/edit",
      "Last deploy was commit a3f9c2e1b4d5a6f7e8d9c0b1a2f3e4d5c6b7a8f9",
      "Password resets are handled by IT",
      "Password: changes every quarter",
      "palabras clave: zapatos deportivos",
      "max_tokens=4000 works best for long reports",
    ];
    for (const text of ordinary) {
      expect(looksLikeEvaAgentMemorySecret(text), text).toBe(false);
    }
    withMemoryDb((db) => {
      expect(
        apiErrorCode(() =>
          saveEvaAgentMemory(db, ANA_META, {
            title: "Meta login",
            body: "password: hunter2!",
            kind: "fact",
            sourceThreadId: null,
          }),
        ),
      ).toBe("memory_secret_rejected");
      expect(
        apiErrorCode(() =>
          saveEvaAgentMemory(db, ANA_META, {
            title: "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
            body: "GitHub",
            kind: "fact",
            sourceThreadId: null,
          }),
        ),
      ).toBe("memory_secret_rejected");
      const saved = saveEvaAgentMemory(db, ANA_META, {
        title: "Meta account",
        body: "Uses the main business account.",
        kind: "fact",
        sourceThreadId: null,
      });
      expect(
        apiErrorCode(() =>
          updateEvaAgentMemory(db, ANA_META, saved.memory.id, {
            body: "api key: AIzaSyA1234567890abcdefghijklmnopqrstuv",
          }),
        ),
      ).toBe("memory_secret_rejected");
      expect(listEvaAgentMemories(db, ANA_META)).toEqual([
        expect.objectContaining({ body: "Uses the main business account." }),
      ]);
    });
  });

  it("lists preferences and corrections first within the instruction budget", () => {
    withMemoryDb((db) => {
      insertMemoryRow(db, ANA_META, {
        id: "fact-new",
        kind: "fact",
        updatedAt: 30,
      });
      insertMemoryRow(db, ANA_META, {
        id: "pref-old",
        kind: "preference",
        updatedAt: 10,
      });
      insertMemoryRow(db, ANA_META, {
        id: "corr-mid",
        kind: "correction",
        updatedAt: 20,
      });
      expect(
        listEvaAgentMemoryTitles(db, ANA_META).titles.map((title) => title.id),
      ).toEqual(["corr-mid", "pref-old", "fact-new"]);

      const empty = formatEvaAgentMemoryInstructions({ titles: [], total: 0 });
      expect(empty).toContain("# What you remember about this user");
      expect(empty).toContain(
        "You have no saved memories about this user yet.",
      );
      expect(empty).toContain("eva_memory_save");

      const many = Array.from({ length: 60 }, (_, index) => ({
        id: `mem_${String(index).padStart(10, "0")}`,
        title: `Remembered item number ${index} with a long title`,
        kind: "fact" as const,
        updatedAt: index,
      }));
      const formatted = formatEvaAgentMemoryInstructions({
        titles: many,
        total: 75,
      });
      const listed = formatted
        .split("\n")
        .filter((line) => line.startsWith("- [fact]"));
      expect(listed.length).toBeGreaterThan(0);
      expect(listed.length).toBeLessThanOrEqual(40);
      expect(listed.join("\n").length).toBeLessThanOrEqual(2_500);
      expect(formatted).toContain(
        `- ${75 - listed.length} older memories are not listed.`,
      );
    });
  });
});

describe("EVA agent memory tools and instructions", () => {
  it("scopes memory tools to the calling agent and the conversation owner", async () => {
    await withTestHarness({ authRequired: true }, async (harness) => {
      await seedIdentity(harness.db, {
        userId: "ana",
        role: "user",
        password: "ana-password",
      });
      await seedIdentity(harness.db, {
        userId: "luis",
        role: "user",
        password: "luis-password",
      });
      for (const userId of ["ana", "luis"]) {
        grantAgent(harness.db, userId, "meta", []);
        grantAgent(harness.db, userId, "crm", ["eva_list_agents"]);
      }
      const { environment, session, thread } = seedWorkspace(
        harness,
        "memory-tools-host",
      );
      const anaMeta = thread({ ownerUserId: "ana", agentId: "meta" });
      const anaCrm = thread({ ownerUserId: "ana", agentId: "crm" });
      const anaDelegatedCrm = thread({
        ownerUserId: "ana",
        agentId: "crm",
        parentThreadId: anaMeta.id,
      });
      const luisMeta = thread({ ownerUserId: "luis", agentId: "meta" });
      const call = async (
        target: typeof anaMeta,
        tool: string,
        input: unknown,
      ) =>
        toolResult(
          await handleEvaAgentToolCall(harness.deps, {
            thread: target,
            tool,
            input,
          }),
        );

      const saved = await call(anaMeta, "eva_memory_save", {
        title: "Prefers Spanish replies",
        details: "Always answer in Spanish, even when briefs are in English.",
        kind: "preference",
      });
      expect(saved).toMatchObject({
        success: true,
        body: { title: "Prefers Spanish replies", status: "created" },
      });
      const memoryId = (saved.body as { id: string }).id;
      expect(getEvaAgentMemory(harness.db, ANA_META, memoryId)).toMatchObject({
        sourceThreadId: anaMeta.id,
      });

      expect(await call(anaMeta, "eva_memory_get", { id: memoryId })).toEqual({
        success: true,
        body: expect.objectContaining({
          id: memoryId,
          kind: "preference",
          details: "Always answer in Spanish, even when briefs are in English.",
        }),
      });
      for (const outsider of [luisMeta, anaCrm]) {
        expect(
          await call(outsider, "eva_memory_get", { id: memoryId }),
        ).toEqual({
          success: false,
          body: "Memory not found",
        });
        expect(
          await call(outsider, "eva_memory_forget", { id: memoryId }),
        ).toEqual({ success: false, body: "Memory not found" });
      }
      expect(
        await call(luisMeta, "eva_memory_save", {
          id: memoryId,
          title: "Overwritten",
          details: "Another user's change",
          kind: "fact",
        }),
      ).toEqual({ success: false, body: "Memory not found" });
      expect(getEvaAgentMemory(harness.db, ANA_META, memoryId)?.title).toBe(
        "Prefers Spanish replies",
      );

      const delegated = await call(anaDelegatedCrm, "eva_memory_save", {
        title: "Lead calls before noon",
        details: "Ana's leads answer calls before noon.",
        kind: "pattern",
      });
      expect(delegated.success).toBe(true);
      const delegatedId = (delegated.body as { id: string }).id;
      expect(getEvaAgentMemory(harness.db, ANA_CRM, delegatedId)).toMatchObject(
        {
          agentId: "crm",
          ownerUserId: "ana",
          sourceThreadId: anaDelegatedCrm.id,
        },
      );
      expect(
        (await call(anaCrm, "eva_memory_get", { id: delegatedId })).success,
      ).toBe(true);
      expect(
        (await call(anaMeta, "eva_memory_get", { id: delegatedId })).success,
      ).toBe(false);

      expect(
        await call(anaMeta, "eva_memory_save", {
          title: "Meta login",
          details: "password: hunter2!",
          kind: "fact",
        }),
      ).toEqual({
        success: false,
        body: expect.stringContaining("looks like it contains a secret"),
      });
      expect(
        (await call(anaMeta, "eva_memory_save", { title: "Missing kind" }))
          .success,
      ).toBe(false);

      const viaRoute = await harness.app.request(
        "/internal/session/tool-call",
        {
          method: "POST",
          headers: internalAuthHeaders(harness, { hostId: environment.hostId }),
          body: JSON.stringify({
            sessionId: session.id,
            threadId: luisMeta.id,
            providerThreadId: "provider-memory",
            turnId: "turn-memory",
            callId: "call-memory",
            tool: "eva_memory_save",
            arguments: {
              title: "Prefers short answers",
              details: "Keep replies under five sentences.",
              kind: "preference",
            },
          }),
        },
      );
      expect(viaRoute.status, await viaRoute.clone().text()).toBe(200);
      expect(listEvaAgentMemories(harness.db, LUIS_META)).toEqual([
        expect.objectContaining({ title: "Prefers short answers" }),
      ]);
      const collaborationViaRoute = await harness.app.request(
        "/internal/session/tool-call",
        {
          method: "POST",
          headers: internalAuthHeaders(harness, {
            hostId: environment.hostId,
          }),
          body: JSON.stringify({
            sessionId: session.id,
            threadId: luisMeta.id,
            providerThreadId: "provider-memory",
            turnId: "turn-memory",
            callId: "call-collaboration",
            tool: "eva_list_agents",
            arguments: {},
          }),
        },
      );
      expect(collaborationViaRoute.status).toBe(403);

      expect(
        await call(anaMeta, "eva_memory_forget", { id: memoryId }),
      ).toEqual({ success: true, body: { id: memoryId, status: "forgotten" } });
      expect(getEvaAgentMemory(harness.db, ANA_META, memoryId)).toBeNull();

      const ownerless = thread({ ownerUserId: null, agentId: "meta" });
      await expect(
        handleEvaAgentToolCall(harness.deps, {
          thread: ownerless,
          tool: "eva_memory_save",
          input: { title: "No owner", details: "None", kind: "fact" },
        }),
      ).rejects.toMatchObject({ status: 403 });
    });
  });

  it("injects the owner's memories into every EVA agent thread's instructions", async () => {
    await withTestHarness({ authRequired: true }, async (harness) => {
      await seedIdentity(harness.db, {
        userId: "ana",
        role: "user",
        password: "ana-password",
      });
      await seedIdentity(harness.db, {
        userId: "luis",
        role: "user",
        password: "luis-password",
      });
      await seedIdentity(harness.db, {
        userId: "root",
        role: "admin",
        password: "root-password",
      });
      grantAgent(harness.db, "ana", "meta", []);
      grantAgent(harness.db, "luis", "meta", ["eva_list_agents"]);
      const { environment, thread } = seedWorkspace(
        harness,
        "memory-runtime-host",
      );
      const runtimeEnvironment = {
        hostId: environment.hostId,
        id: environment.id,
        path: environment.path,
        status: environment.status,
      };
      insertMemoryRow(harness.db, ANA_META, {
        id: "mem_fact000001",
        kind: "fact",
        updatedAt: 30,
      });
      insertMemoryRow(harness.db, ANA_META, {
        id: "mem_pref000001",
        kind: "preference",
        updatedAt: 10,
      });
      insertMemoryRow(harness.db, LUIS_META, {
        id: "mem_luis000001",
        kind: "preference",
        updatedAt: 10,
      });

      const anaConfig = await resolveThreadRuntimeCommandConfig(harness.deps, {
        thread: thread({ ownerUserId: "ana", agentId: "meta" }),
        model: "test-model",
        environment: runtimeEnvironment,
      });
      const anaTools = anaConfig.dynamicTools.map((tool) => tool.name);
      expect(anaTools).toEqual(
        expect.arrayContaining([...EVA_AGENT_MEMORY_TOOL_NAMES]),
      );
      expect(anaTools).not.toContain("eva_list_agents");
      expect(anaConfig.instructions).not.toContain(
        "Any EVA agent may collaborate with the other EVA agents",
      );
      const memorySection = anaConfig.instructions.slice(
        anaConfig.instructions.indexOf("# What you remember about this user"),
      );
      expect(memorySection).toContain(
        "- [preference] Memory mem_pref000001 (id: mem_pref000001)",
      );
      expect(memorySection.indexOf("mem_pref000001")).toBeLessThan(
        memorySection.indexOf("mem_fact000001"),
      );
      expect(memorySection).toContain("eva_memory_get");
      expect(memorySection).toContain(
        "Never mention the memory system to the user unless they ask about it.",
      );
      expect(anaConfig.instructions).not.toContain("mem_luis000001");

      const delegatedConfig = await resolveThreadRuntimeCommandConfig(
        harness.deps,
        {
          thread: thread({ ownerUserId: "luis", agentId: "meta" }),
          model: "test-model",
          environment: runtimeEnvironment,
        },
      );
      expect(delegatedConfig.instructions).toContain("mem_luis000001");
      expect(delegatedConfig.instructions).not.toContain("mem_pref000001");

      const adminConfig = await resolveThreadRuntimeCommandConfig(
        harness.deps,
        {
          thread: thread({ ownerUserId: "root", agentId: "admin" }),
          model: "test-model",
          environment: runtimeEnvironment,
        },
      );
      expect(adminConfig.dynamicTools.map((tool) => tool.name)).toEqual(
        expect.arrayContaining([...EVA_AGENT_MEMORY_TOOL_NAMES]),
      );
      expect(adminConfig.instructions).toContain(
        "# What you remember about this user",
      );
      expect(adminConfig.instructions).toContain(
        "You have no saved memories about this user yet.",
      );
      expect(adminConfig.instructions).toContain("eva_memory_save");
    });
  });
});

describe("EVA agent memory administration", () => {
  it("lets only current administrators list, edit, and delete memories", async () => {
    await withTestHarness({ authRequired: true }, async (harness) => {
      await seedIdentity(harness.db, {
        userId: "root",
        role: "admin",
        password: "root-password",
      });
      await seedIdentity(harness.db, {
        userId: "ana",
        role: "user",
        password: "ana-password",
      });
      grantAgent(harness.db, "ana", "meta", []);
      const adminCookie = await signIn(harness, "root", "root-password");
      const userCookie = await signIn(harness, "ana", "ana-password");
      const memory = saveEvaAgentMemory(harness.db, ANA_META, {
        title: "Prefers carousel ads",
        body: "Carousels outperform single images for Ana.",
        kind: "pattern",
        sourceThreadId: null,
      }).memory;
      saveEvaAgentMemory(harness.db, ANA_CRM, {
        title: "Calls in the morning",
        body: "Prefers morning calls.",
        kind: "preference",
        sourceThreadId: null,
      });
      const listPath = "/api/v1/eva/agents/meta/memories?userId=ana";
      const memoryPath = `/api/v1/eva/agents/meta/memories/${memory.id}`;

      expect((await harness.app.request(listPath)).status).toBe(401);
      expect(
        (
          await harness.app.request(listPath, {
            headers: { cookie: userCookie },
          })
        ).status,
      ).toBe(403);
      for (const method of ["PATCH", "DELETE"]) {
        const denied = await harness.app.request(memoryPath, {
          method,
          headers: { cookie: userCookie, "content-type": "application/json" },
          ...(method === "PATCH"
            ? { body: JSON.stringify({ title: "Changed by user" }) }
            : {}),
        });
        expect(denied.status).toBe(403);
      }

      const listed = await harness.app.request(listPath, {
        headers: { cookie: adminCookie },
      });
      expect(listed.status).toBe(200);
      expect(await listed.json()).toEqual({
        agentId: "meta",
        userId: "ana",
        limit: 200,
        memories: [
          {
            id: memory.id,
            agentId: "meta",
            userId: "ana",
            title: "Prefers carousel ads",
            details: "Carousels outperform single images for Ana.",
            kind: "pattern",
            sourceThreadId: null,
            createdAt: memory.createdAt,
            updatedAt: memory.updatedAt,
          },
        ],
      });
      expect(
        (
          await harness.app.request("/api/v1/eva/agents/meta/memories", {
            headers: { cookie: adminCookie },
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await harness.app.request(
            "/api/v1/eva/agents/meta/memories?userId=nobody",
            { headers: { cookie: adminCookie } },
          )
        ).status,
      ).toBe(404);

      const patched = await harness.app.request(memoryPath, {
        method: "PATCH",
        headers: { cookie: adminCookie, "content-type": "application/json" },
        body: JSON.stringify({
          title: "Prefers carousel ads for launches",
          details: "Use carousels for product launches only.",
        }),
      });
      expect(patched.status).toBe(200);
      expect(await patched.json()).toMatchObject({
        memory: {
          id: memory.id,
          title: "Prefers carousel ads for launches",
          details: "Use carousels for product launches only.",
          kind: "pattern",
        },
      });
      const secret = await harness.app.request(memoryPath, {
        method: "PATCH",
        headers: { cookie: adminCookie, "content-type": "application/json" },
        body: JSON.stringify({ details: "token: abcdef123456" }),
      });
      expect(secret.status).toBe(400);
      expect(
        (
          await harness.app.request(
            `/api/v1/eva/agents/crm/memories/${memory.id}`,
            {
              method: "PATCH",
              headers: {
                cookie: adminCookie,
                "content-type": "application/json",
              },
              body: JSON.stringify({ title: "Wrong agent" }),
            },
          )
        ).status,
      ).toBe(404);
      expect(
        (
          await harness.app.request(
            `/api/v1/eva/agents/crm/memories/${memory.id}`,
            { method: "DELETE", headers: { cookie: adminCookie } },
          )
        ).status,
      ).toBe(404);

      const deleted = await harness.app.request(memoryPath, {
        method: "DELETE",
        headers: { cookie: adminCookie },
      });
      expect(deleted.status).toBe(200);
      expect(await deleted.json()).toEqual({ deleted: true, id: memory.id });
      expect(getEvaAgentMemory(harness.db, ANA_META, memory.id)).toBeNull();
      expect(
        (
          await harness.app.request(memoryPath, {
            method: "DELETE",
            headers: { cookie: adminCookie },
          })
        ).status,
      ).toBe(404);
      expect(listEvaAgentMemories(harness.db, ANA_CRM)).toHaveLength(1);
    });
  });
});
