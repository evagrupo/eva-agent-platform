import { hashPassword } from "better-auth/crypto";
import {
  authAccounts,
  authAgentGrants,
  authPrincipals,
  authUsers,
  createThread,
  getPersonalProject,
  getThread,
  getThreadPluginMetadata,
  insertThreadPluginMetadata,
  type DbConnection,
} from "@bb/db";
import type { PromptInput } from "@bb/domain";
import { describe, expect, it } from "vitest";
import { ensureEvaAgentCanonicalChat } from "../../src/agents/eva-agent-chat.js";
import {
  EVA_CHAT_PLUGIN_ID,
  evaAgentChatContinuationText,
} from "../../src/agents/eva-agent-chat-continuation.js";
import {
  reportNextEnvironmentAttachSuccess,
  waitForQueuedCommand,
} from "../helpers/commands.js";
import { installFakePersonalWorkspaceProvider } from "../helpers/environment-provider.js";
import { seedHostSession, seedPrimaryHost } from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

type Role = "admin" | "user";

async function seedIdentity(
  db: DbConnection,
  args: { userId: string; role: Role },
): Promise<void> {
  const now = new Date();
  db.insert(authUsers)
    .values({
      id: args.userId,
      name: args.userId,
      email: `${args.userId}@eva.test`,
      emailVerified: true,
      image: null,
      createdAt: now,
      updatedAt: now,
    })
    .run();
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
      password: await hashPassword(`${args.userId}-password`),
      createdAt: now,
      updatedAt: now,
    })
    .run();
  db.insert(authPrincipals)
    .values({
      userId: args.userId,
      role: args.role,
      status: "active",
      policyId: args.role,
      revision: 1,
      updatedAt: Date.now(),
    })
    .run();
}

function grantAgent(db: DbConnection, userId: string, agentId: string): void {
  const now = Date.now();
  db.insert(authAgentGrants)
    .values({
      id: `${userId}-${agentId}`,
      userId,
      groupId: null,
      agentId,
      providerIdsJson: '["codex","claude-code"]',
      modelPatternsJson: '["*"]',
      reasoningLevelsJson: '["high","max"]',
      fixedExecution: false,
      permissionMode: "full",
      terminalAccess: "none",
      toolIdsJson: "[]",
      pluginIdsJson: "[]",
      createdAt: now,
      updatedAt: now,
    })
    .run();
}

async function signIn(
  harness: TestAppHarness,
  userId: string,
): Promise<{ cookie: string }> {
  const response = await harness.app.request("/api/auth/sign-in/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: `${userId}@eva.test`,
      password: `${userId}-password`,
    }),
  });
  expect(response.status).toBe(200);
  return { cookie: response.headers.get("set-cookie")!.split(";", 1)[0]! };
}

interface ChatFixture {
  harness: TestAppHarness;
  hostId: string;
  owner: { cookie: string };
  stranger: { cookie: string };
  admin: { cookie: string };
  chatThreadId: string;
}

async function withChatFixture(
  run: (fixture: ChatFixture) => Promise<void>,
): Promise<void> {
  await withTestHarness({ authRequired: true }, async (harness) => {
    await seedIdentity(harness.db, { userId: "chat-owner", role: "user" });
    await seedIdentity(harness.db, { userId: "chat-stranger", role: "user" });
    await seedIdentity(harness.db, { userId: "chat-admin", role: "admin" });
    grantAgent(harness.db, "chat-owner", "people");
    grantAgent(harness.db, "chat-stranger", "people");
    const owner = await signIn(harness, "chat-owner");
    const stranger = await signIn(harness, "chat-stranger");
    const admin = await signIn(harness, "chat-admin");
    const warmup = await harness.app.request("/api/v1/eva/agents", {
      headers: admin,
    });
    expect(warmup.status).toBe(200);
    const { host } = seedHostSession(harness.deps, { id: "eva-chat-host" });
    seedPrimaryHost(harness.deps, host.id);
    installFakePersonalWorkspaceProvider(() => ({
      action: "ready",
      environment: {
        type: "host",
        hostId: host.id,
        path: "/tmp/eva-chat-continuation",
      },
    }));
    const project = getPersonalProject(harness.db)!;
    const chat = createThread(harness.db, harness.hub, {
      projectId: project.id,
      ownerUserId: "chat-owner",
      agentId: "people",
      providerId: "codex",
      status: "idle",
      title: "RR. HH.",
      titleFallback: "RR. HH.",
      visibility: "visible",
    });
    expect(
      ensureEvaAgentCanonicalChat(harness.db, {
        agentId: "people",
        ownerUserId: "chat-owner",
      }),
    ).toBe(chat.id);
    await run({
      harness,
      hostId: host.id,
      owner,
      stranger,
      admin,
      chatThreadId: chat.id,
    });
  });
}

const userMessage: PromptInput = {
  type: "text",
  text: "¿Puedes seguir con el informe?",
  mentions: [],
};

function continueChat(
  harness: TestAppHarness,
  headers: { cookie: string },
  agentId: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return Promise.resolve(
    harness.app.request(`/api/v1/eva/agents/${agentId}/chat/continue`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({
        providerId: "claude-code",
        model: "claude-opus-5",
        reasoningLevel: "high",
        input: [userMessage],
        ...body,
      }),
    }),
  );
}

async function segments(
  harness: TestAppHarness,
  headers: { cookie: string },
  threadId: string,
): Promise<{ status: number; body: unknown }> {
  const response = await harness.app.request(
    `/api/v1/eva/agents/people/chat/segments?threadId=${threadId}`,
    { headers },
  );
  return { status: response.status, body: await response.json() };
}

describe("EVA agent chat continuation", () => {
  it("continues the chat in a hidden successor and repoints the user's chat", async () => {
    await withChatFixture(async ({ harness, owner, chatThreadId }) => {
      const response = await continueChat(harness, owner, "people", {
        fromThreadId: chatThreadId,
      });
      expect(response.status, await response.clone().text()).toBe(201);
      const { threadId } = (await response.json()) as { threadId: string };
      expect(threadId).not.toBe(chatThreadId);

      expect(getThread(harness.db, threadId)).toMatchObject({
        agentId: "people",
        ownerUserId: "chat-owner",
        parentThreadId: null,
        providerId: "claude-code",
        title: "RR. HH.",
      });
      expect(
        getThreadPluginMetadata(harness.db, threadId, EVA_CHAT_PLUGIN_ID),
      ).toEqual({
        metadata: { previousThreadId: chatThreadId },
        corrupt: false,
      });
      expect(
        ensureEvaAgentCanonicalChat(harness.db, {
          agentId: "people",
          ownerUserId: "chat-owner",
        }),
      ).toBe(threadId);
      const chatLookup = await harness.app.request(
        `/api/v1/eva/agents/people/chat?forThreadId=${chatThreadId}`,
        { headers: owner },
      );
      expect(await chatLookup.json()).toEqual({ chatThreadId: threadId });

      await reportNextEnvironmentAttachSuccess(harness, threadId);
      const start = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.start" && command.threadId === threadId,
      );
      if (start.command.type !== "thread.start") {
        throw new Error("Expected thread.start");
      }
      expect(start.command.providerId).toBe("claude-code");
      expect(start.command.input).toEqual([
        {
          type: "text",
          text: evaAgentChatContinuationText(chatThreadId),
          mentions: [],
          visibility: "agent-only",
        },
        userMessage,
      ]);
      expect(evaAgentChatContinuationText(chatThreadId)).toBe(
        `This conversation continues an earlier part of the same chat with this user (thread ${chatThreadId}). Before answering, read it with \`bb thread log ${chatThreadId}\` so you have the full context, including any earlier parts it mentions. Do not mention switching, threads, providers, or models to the user; just continue naturally.`,
      );

      const timeline = await harness.app.request(
        `/api/v1/threads/${threadId}/timeline`,
        { headers: owner },
      );
      expect(timeline.status).toBe(200);
      const timelineBody = JSON.stringify(await timeline.json());
      expect(timelineBody).toContain("¿Puedes seguir con el informe?");
      expect(timelineBody).not.toContain("bb thread log");
      expect(timelineBody).not.toContain("earlier part of the same chat");
    });
  });

  it("lists earlier parts oldest first and points stale parts to the current chat", async () => {
    await withChatFixture(async ({ harness, owner, admin, chatThreadId }) => {
      const first = await continueChat(harness, owner, "people", {
        fromThreadId: chatThreadId,
      });
      expect(first.status, await first.clone().text()).toBe(201);
      const { threadId: secondPart } = (await first.json()) as {
        threadId: string;
      };
      const second = await continueChat(harness, owner, "people", {
        fromThreadId: secondPart,
        providerId: "codex",
        model: "gpt-5.6-luna",
      });
      expect(second.status, await second.clone().text()).toBe(201);
      const { threadId: thirdPart } = (await second.json()) as {
        threadId: string;
      };
      expect(getThread(harness.db, thirdPart)?.providerId).toBe("codex");

      expect(await segments(harness, owner, thirdPart)).toEqual({
        status: 200,
        body: {
          threadIds: [chatThreadId, secondPart],
          latestThreadId: null,
        },
      });
      expect(await segments(harness, owner, chatThreadId)).toEqual({
        status: 200,
        body: { threadIds: [], latestThreadId: thirdPart },
      });
      expect((await segments(harness, admin, thirdPart)).body).toMatchObject({
        threadIds: [chatThreadId, secondPart],
      });
    });
  });

  it("stops the earlier-part chain at another user's conversation", async () => {
    await withChatFixture(async ({ harness, owner, chatThreadId }) => {
      const project = getPersonalProject(harness.db)!;
      const foreign = createThread(harness.db, harness.hub, {
        projectId: project.id,
        ownerUserId: "chat-stranger",
        agentId: "people",
        providerId: "codex",
        status: "idle",
        visibility: "visible",
      });
      insertThreadPluginMetadata(harness.db, {
        threadId: chatThreadId,
        pluginId: EVA_CHAT_PLUGIN_ID,
        metadata: { previousThreadId: foreign.id },
      });

      expect(await segments(harness, owner, chatThreadId)).toEqual({
        status: 200,
        body: { threadIds: [], latestThreadId: null },
      });
    });
  });

  it("rejects other users, the Admin agent, child threads, and mismatched agents", async () => {
    await withChatFixture(
      async ({ harness, owner, stranger, admin, chatThreadId }) => {
        const project = getPersonalProject(harness.db)!;
        const strangerContinue = await continueChat(
          harness,
          stranger,
          "people",
          { fromThreadId: chatThreadId },
        );
        expect(strangerContinue.status).toBe(403);
        expect((await segments(harness, stranger, chatThreadId)).status).toBe(
          403,
        );

        const adminThread = createThread(harness.db, harness.hub, {
          projectId: project.id,
          ownerUserId: "chat-admin",
          agentId: "admin",
          providerId: "codex",
          status: "idle",
          visibility: "visible",
        });
        const adminAgent = await continueChat(harness, admin, "admin", {
          fromThreadId: adminThread.id,
        });
        expect(adminAgent.status).toBe(404);

        const child = createThread(harness.db, harness.hub, {
          projectId: project.id,
          ownerUserId: "chat-owner",
          agentId: "people",
          providerId: "codex",
          status: "idle",
          parentThreadId: chatThreadId,
          visibility: "visible",
        });
        const childContinue = await continueChat(harness, owner, "people", {
          fromThreadId: child.id,
        });
        expect(childContinue.status).toBe(404);
        expect((await segments(harness, owner, child.id)).status).toBe(404);

        grantAgent(harness.db, "chat-owner", "orchestrator");
        const mismatched = await continueChat(harness, owner, "orchestrator", {
          fromThreadId: chatThreadId,
        });
        expect(mismatched.status).toBe(404);

        const invalid = await continueChat(harness, owner, "people", {
          fromThreadId: chatThreadId,
          input: [],
        });
        expect(invalid.status).toBe(400);

        expect(
          ensureEvaAgentCanonicalChat(harness.db, {
            agentId: "people",
            ownerUserId: "chat-owner",
          }),
        ).toBe(chatThreadId);
      },
    );
  });

  it("lets an administrator continue a user's chat for that user", async () => {
    await withChatFixture(async ({ harness, admin, chatThreadId }) => {
      const response = await continueChat(harness, admin, "people", {
        fromThreadId: chatThreadId,
      });
      expect(response.status, await response.clone().text()).toBe(201);
      const { threadId } = (await response.json()) as { threadId: string };
      expect(getThread(harness.db, threadId)?.ownerUserId).toBe("chat-owner");
      expect(
        ensureEvaAgentCanonicalChat(harness.db, {
          agentId: "people",
          ownerUserId: "chat-owner",
        }),
      ).toBe(threadId);
    });
  });
});
