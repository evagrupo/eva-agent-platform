import { hashPassword } from "better-auth/crypto";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  authAccounts,
  authPrincipals,
  authUsers,
  createThread,
  getPersonalProject,
  type DbConnection,
} from "@bb/db";
import { describe, expect, it } from "vitest";
import {
  EVA_AGENT_TOOL_NAMES,
  handleEvaAgentToolCall,
} from "../../src/agents/eva-agent-tools.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

async function seedIdentity(
  db: DbConnection,
  args: {
    email: string;
    name: string;
    password: string;
    role: "admin" | "user";
    userId: string;
  },
): Promise<void> {
  const now = new Date();
  const password = await hashPassword(args.password);
  db.insert(authUsers)
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
      password,
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
  const cookie = response.headers.get("set-cookie");
  expect(cookie).toEqual(expect.any(String));
  return cookie!.split(";", 1)[0]!;
}

function toolText(
  response: Awaited<ReturnType<typeof handleEvaAgentToolCall>>,
): string {
  const item = response.contentItems[0];
  if (item?.type !== "inputText") throw new Error("Expected text tool output");
  return item.text;
}

describe("EVA agent surface", () => {
  it("persists managed agents and filters their workspace and thread surface by grants", async () => {
    await withTestHarness({ authRequired: true }, async (harness) => {
      await seedIdentity(harness.db, {
        email: "eva-agent-admin@eva.test",
        name: "EVA Agent Admin",
        password: "eva-agent-admin-password",
        role: "admin",
        userId: "eva-agent-admin",
      });
      await seedIdentity(harness.db, {
        email: "eva-agent-user@eva.test",
        name: "EVA Agent User",
        password: "eva-agent-user-password",
        role: "user",
        userId: "eva-agent-user",
      });
      const adminCookie = await signIn(
        harness,
        "eva-agent-admin@eva.test",
        "eva-agent-admin-password",
      );
      const userCookie = await signIn(
        harness,
        "eva-agent-user@eva.test",
        "eva-agent-user-password",
      );
      const adminHeaders = { cookie: adminCookie };
      const userHeaders = { cookie: userCookie };

      const pending = await harness.app.request("/api/v1/eva/agents", {
        headers: userHeaders,
      });
      expect(pending.status).toBe(200);
      expect((await pending.json()).agents).toEqual([]);

      const builtIns = await harness.app.request("/api/v1/eva/agents", {
        headers: adminHeaders,
      });
      expect(builtIns.status).toBe(200);
      const builtInBody = (await builtIns.json()) as {
        agents: Array<{ id: string }>;
      };
      expect(builtInBody.agents).toHaveLength(11);

      const creative = await harness.app.request(
        "/api/v1/eva/agents/creative",
        { headers: adminHeaders },
      );
      expect(creative.status).toBe(200);
      const creativeBody = (await creative.json()) as {
        agent: {
          workspace: { relativePath: string; managedFiles: string[] };
        };
      };
      expect(creativeBody.agent.workspace.relativePath).toBe(
        "eva-agents/creative",
      );
      expect(creativeBody.agent.workspace.managedFiles).toContain("AGENTS.md");
      expect(creativeBody.agent.workspace.relativePath).not.toMatch(
        /^(?:[A-Za-z]:)?[\\/]/u,
      );
      expect(
        await readFile(
          join(harness.config.dataDir, "eva-agents", "creative", "AGENTS.md"),
          "utf8",
        ),
      ).toContain("Creatividad");
      await expect(
        stat(join(harness.config.dataDir, "eva-agents", "creative", ".env")),
      ).rejects.toMatchObject({ code: "ENOENT" });

      const created = await harness.app.request("/api/v1/eva/agents", {
        method: "POST",
        headers: { ...adminHeaders, "content-type": "application/json" },
        body: JSON.stringify({
          id: "growth-review",
          displayName: "Growth review",
          description: "Reviews growth proposals before human approval",
          icon: "SearchCheck",
          instructions: "Review proposals and return bounded recommendations.",
        }),
      });
      expect(created.status).toBe(201);
      const patched = await harness.app.request(
        "/api/v1/eva/agents/growth-review",
        {
          method: "PATCH",
          headers: { ...adminHeaders, "content-type": "application/json" },
          body: JSON.stringify({
            skills: [
              {
                id: "approval-check",
                name: "Approval check",
                instructions: "Identify decisions that require a human.",
              },
            ],
          }),
        },
      );
      expect(patched.status).toBe(200);
      const detail = await harness.app.request(
        "/api/v1/eva/agents/growth-review",
        { headers: adminHeaders },
      );
      expect(detail.status).toBe(200);
      const detailBody = (await detail.json()) as {
        agent: {
          skills: Array<{ id: string }>;
          workspace: { managedFiles: string[] };
        };
      };
      expect(detailBody.agent.skills.map((skill) => skill.id)).toEqual([
        "approval-check",
      ]);
      expect(detailBody.agent.workspace.managedFiles).toContain(
        ".bb/skills/approval-check/SKILL.md",
      );

      expect(
        (
          await harness.app.request("/api/v1/eva/agents/growth-review", {
            headers: userHeaders,
          })
        ).status,
      ).toBe(404);

      const grant = await harness.app.request("/api/v1/access/grants", {
        method: "POST",
        headers: { ...adminHeaders, "content-type": "application/json" },
        body: JSON.stringify({
          id: "growth-review-user",
          userId: "eva-agent-user",
          agentId: "growth-review",
          providerIds: ["codex"],
          modelPatterns: ["gpt-5.6-luna"],
          reasoningLevels: ["max"],
          fixedExecution: true,
          permissionMode: "accept-edits",
          terminalAccess: "none",
          toolIds: [...EVA_AGENT_TOOL_NAMES],
          pluginIds: [],
        }),
      });
      expect(grant.status).toBe(201);

      const grantedList = await harness.app.request("/api/v1/eva/agents", {
        headers: userHeaders,
      });
      expect(grantedList.status).toBe(200);
      const grantedBody = (await grantedList.json()) as {
        agents: Array<{ id: string }>;
      };
      expect(grantedBody.agents.map((agent) => agent.id)).toEqual([
        "growth-review",
      ]);

      const personalProject = getPersonalProject(harness.db);
      expect(personalProject).not.toBeNull();
      const thread = createThread(harness.db, harness.hub, {
        projectId: personalProject!.id,
        ownerUserId: "eva-agent-user",
        agentId: "growth-review",
        providerId: "codex",
        status: "idle",
        title: "Growth review thread",
        titleFallback: "Growth review thread",
        visibility: "visible",
      });
      const threads = await harness.app.request(
        "/api/v1/eva/agents/growth-review/threads",
        { headers: userHeaders },
      );
      expect(threads.status).toBe(200);
      expect((await threads.json()).threads).toEqual([
        expect.objectContaining({
          id: thread.id,
          title: "Growth review thread",
        }),
      ]);
      const threadDetail = await harness.app.request(
        `/api/v1/eva/agents/growth-review/threads/${thread.id}`,
        { headers: userHeaders },
      );
      expect(threadDetail.status).toBe(200);
      expect(
        (
          await harness.app.request("/api/v1/eva/agents/creative/threads", {
            headers: userHeaders,
          })
        ).status,
      ).toBe(404);

      const listed = await handleEvaAgentToolCall(harness.deps, {
        input: {},
        thread,
        tool: "eva_list_agents",
      });
      expect(listed.success).toBe(true);
      expect(JSON.parse(toolText(listed))).toEqual([
        expect.objectContaining({
          id: "growth-review",
          workspace: "eva-agents/growth-review",
        }),
      ]);

      const listedThreads = await handleEvaAgentToolCall(harness.deps, {
        input: { agent: "growth-review" },
        thread,
        tool: "eva_list_agent_threads",
      });
      expect(JSON.parse(toolText(listedThreads))).toEqual([
        expect.objectContaining({ agent: "growth-review", id: thread.id }),
      ]);

      const read = await handleEvaAgentToolCall(harness.deps, {
        input: { threadId: thread.id },
        thread,
        tool: "eva_read_agent_thread",
      });
      expect(read.success).toBe(true);
      expect(JSON.parse(toolText(read))).toMatchObject({
        threadId: thread.id,
        agent: "growth-review",
        output: null,
      });
    });
  });

  it("keeps workspace synchronization administrator-only and validates remotes", async () => {
    await withTestHarness({ authRequired: true }, async (harness) => {
      await seedIdentity(harness.db, {
        email: "eva-sync-admin@eva.test",
        name: "EVA Sync Admin",
        password: "eva-sync-admin-password",
        role: "admin",
        userId: "eva-sync-admin",
      });
      await seedIdentity(harness.db, {
        email: "eva-sync-user@eva.test",
        name: "EVA Sync User",
        password: "eva-sync-user-password",
        role: "user",
        userId: "eva-sync-user",
      });
      const adminHeaders = {
        cookie: await signIn(
          harness,
          "eva-sync-admin@eva.test",
          "eva-sync-admin-password",
        ),
      };
      const userHeaders = {
        cookie: await signIn(
          harness,
          "eva-sync-user@eva.test",
          "eva-sync-user-password",
        ),
      };
      const path = "/api/v1/eva/agents/creative/workspace/sync";
      const blockedConfigure = await harness.app.request(path, {
        method: "PUT",
        headers: { ...userHeaders, "content-type": "application/json" },
        body: JSON.stringify({
          remoteUrl: "https://github.com/example/private.git",
          branch: "main",
        }),
      });
      expect(blockedConfigure.status).toBe(403);
      const blockedStatus = await harness.app.request(path, {
        headers: userHeaders,
      });
      expect(blockedStatus.status).toBe(403);

      const initial = await harness.app.request(path, { headers: adminHeaders });
      expect(initial.status).toBe(200);
      expect((await initial.json()).status.configured).toBe(false);

      const unsafe = await harness.app.request(path, {
        method: "PUT",
        headers: { ...adminHeaders, "content-type": "application/json" },
        body: JSON.stringify({
          remoteUrl: "https://user:token@github.com/example/private.git",
          branch: "main",
        }),
      });
      expect(unsafe.status).toBe(400);
      expect((await unsafe.json()).message).not.toContain("token");

      const configured = await harness.app.request(path, {
        method: "PUT",
        headers: { ...adminHeaders, "content-type": "application/json" },
        body: JSON.stringify({
          remoteUrl: "git@github.com:example/private.git",
          branch: "main",
        }),
      });
      expect(configured.status).toBe(200);
      expect((await configured.json()).status.remoteUrl).toBe(
        "git@github.com:example/private.git",
      );

      const initialized = await harness.app.request(`${path}/initialize`, {
        method: "POST",
        headers: adminHeaders,
      });
      expect(initialized.status).toBe(200);
      const initializedBody = (await initialized.json()) as {
        status: { fingerprint: string | null; state: string };
      };
      expect(initializedBody.status.fingerprint).toEqual(expect.any(String));
      expect(initializedBody.status.state).toBe("changed");

      const committed = await harness.app.request(`${path}/commit`, {
        method: "POST",
        headers: { ...adminHeaders, "content-type": "application/json" },
        body: JSON.stringify({
          message: "Initial workspace checkpoint",
          expectedFingerprint: initializedBody.status.fingerprint,
        }),
      });
      expect(committed.status).toBe(200);
      expect((await committed.json()).status.lastCommitHash).toEqual(
        expect.any(String),
      );

      for (const operation of ["pull", "push"] as const) {
        const response = await harness.app.request(`${path}/${operation}`, {
          method: "POST",
          headers: { ...userHeaders, "content-type": "application/json" },
          body: JSON.stringify({
            expectedFingerprint: "a".repeat(64),
            allowNonEmpty: true,
          }),
        });
        expect(response.status).toBe(403);
      }
    });
  });
});
