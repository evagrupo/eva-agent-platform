import { access, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { and, count, desc, eq, gte, isNull } from "drizzle-orm";
import {
  evaAgentSkills,
  evaAgentWorkspaces,
  evaAgents,
  threads,
  type DbConnection,
  type DbTransaction,
} from "@bb/db";
import { permissionModeValues, reasoningLevelValues } from "@bb/domain";
import { z } from "zod";
import type { ServerRuntimeConfig } from "../types.js";
import {
  EVA_DEFAULT_MODEL,
  EVA_DEFAULT_PERMISSION_MODE,
  EVA_DEFAULT_PROVIDER_ID,
  EVA_DEFAULT_REASONING_LEVEL,
  type EvaAgentCatalogEntry,
} from "./eva-agent-catalog.js";
import {
  EVA_AGENT_WORKSPACE_ROOT,
  ensureEvaAgentRegistry,
  getEvaAgentForDb,
  getEvaAgentWorkspace,
  listEvaAgentSkills,
  listEvaAgentsFromDb,
  validateEvaAgentId,
  type EvaAgentSkill,
  type EvaAgentWorkspace,
} from "./eva-agent-registry.js";

const skillIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u);

export const evaAgentSkillInputSchema = z
  .object({
    id: skillIdSchema,
    name: z.string().min(1).max(160),
    instructions: z.string().min(1).max(8_192),
  })
  .strict();

export type EvaAgentSkillInput = z.infer<typeof evaAgentSkillInputSchema>;

export interface EvaAgentView {
  id: string;
  displayName: string;
  description: string;
  icon: string;
  status: EvaAgentCatalogEntry["status"];
  sourceProviderId: string | null;
  providerIds: string[];
  defaultProviderId: string | null;
  defaultModel: string;
  defaultReasoningLevel: EvaAgentCatalogEntry["defaultReasoningLevel"];
  defaultPermissionMode: EvaAgentCatalogEntry["defaultPermissionMode"];
  fixedExecution: boolean;
  reasoningLevels: string[];
  permissionModes: string[];
  instructions: string;
  skills: EvaAgentSkill[];
  workspace: {
    workspaceKey: string;
    relativePath: string;
    status: EvaAgentWorkspace["status"];
    lastScaffoldedAt: number | null;
    managedFiles: string[];
  };
  weeklyConversationCount: number;
}

export interface EvaAgentThreadSummary {
  id: string;
  projectId: string;
  agentId: string | null;
  title: string | null;
  status: string;
  visibility: string;
  parentThreadId: string | null;
  createdAt: number;
  updatedAt: number;
  ownerUserId: string | null;
}

export interface CreateEvaAgentInput {
  id: string;
  displayName: string;
  description: string;
  icon: string;
  instructions: string;
  providerId?: string;
  model?: string;
  reasoningLevel?: (typeof reasoningLevelValues)[number];
  permissionMode?: (typeof permissionModeValues)[number];
}

export interface UpdateEvaAgentInput {
  displayName?: string;
  description?: string;
  icon?: string;
  status?: EvaAgentCatalogEntry["status"];
  instructions?: string;
  providerId?: string | null;
  model?: string;
  reasoningLevel?: (typeof reasoningLevelValues)[number];
  permissionMode?: (typeof permissionModeValues)[number];
  skills?: readonly EvaAgentSkillInput[];
}

interface EvaAgentServiceDeps {
  db: DbConnection;
  config: Pick<ServerRuntimeConfig, "dataDir">;
}

const BASE_MANAGED_FILES = [
  "AGENTS.md",
  "README.md",
  ".eva-managed",
  "bin/README.md",
  ".bb/skills/.gitkeep",
] as const;

function workspacePath(deps: EvaAgentServiceDeps, agentId: string): string {
  const root = resolve(deps.config.dataDir, EVA_AGENT_WORKSPACE_ROOT);
  const candidate = resolve(root, agentId);
  if (!candidate.startsWith(`${root}/`)) {
    throw new Error("Invalid EVA agent workspace");
  }
  return candidate;
}

function managedFiles(skills: readonly EvaAgentSkill[]): string[] {
  return [
    ...BASE_MANAGED_FILES,
    ...skills.map((skill) => `.bb/skills/${skill.id}/SKILL.md`),
  ];
}

function skillFile(skill: EvaAgentSkill, agent: EvaAgentCatalogEntry): string {
  return `# ${skill.name}\n\nUse this skill for ${agent.displayName}.\n\n${skill.instructions.trim()}\n`;
}

function agentReadme(agent: EvaAgentCatalogEntry): string {
  return `# ${agent.displayName}\n\n${agent.description}\n\nThis workspace is managed by EVA.\n`;
}

async function scaffoldAgent(
  deps: EvaAgentServiceDeps,
  agent: EvaAgentCatalogEntry,
  skills: readonly EvaAgentSkill[],
  overwriteManaged: boolean,
): Promise<void> {
  const root = workspacePath(deps, agent.id);
  const exists = async (path: string): Promise<boolean> => {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  };
  await mkdir(join(root, ".bb", "skills"), { recursive: true });
  await mkdir(join(root, "bin"), { recursive: true });
  const managedFilesToWrite: Array<[string, string]> = [
    [
      join(root, "AGENTS.md"),
      `# ${agent.displayName}\n\n${agent.instructions.trim()}\n`,
    ],
    [join(root, "README.md"), agentReadme(agent)],
    [join(root, ".eva-managed"), "Managed EVA agent workspace.\n"],
    [
      join(root, "bin", "README.md"),
      "Put reviewed, agent-specific helpers here. EVA does not install or copy executables.\n",
    ],
    [join(root, ".bb", "skills", ".gitkeep"), ""],
  ];
  for (const [filePath, contents] of managedFilesToWrite) {
    if (overwriteManaged || !(await exists(filePath))) {
      await writeFile(filePath, contents, "utf8");
    }
  }
  const skillIds = new Set(skills.map((skill) => skill.id));
  if (overwriteManaged) {
    for (const entry of await readdir(join(root, ".bb", "skills"), {
      withFileTypes: true,
    })) {
      if (!entry.isDirectory() || skillIds.has(entry.name)) continue;
      const skillRoot = join(root, ".bb", "skills", entry.name);
      if (await exists(join(skillRoot, ".eva-managed"))) {
        await rm(skillRoot, { recursive: true, force: true });
      }
    }
  }
  for (const skill of skills) {
    const skillRoot = join(root, ".bb", "skills", skill.id);
    await mkdir(skillRoot, { recursive: true });
    const skillPath = join(skillRoot, "SKILL.md");
    if (overwriteManaged || !(await exists(skillPath))) {
      await writeFile(skillPath, skillFile(skill, agent), "utf8");
    }
    const managedMarker = join(skillRoot, ".eva-managed");
    if (overwriteManaged || !(await exists(managedMarker))) {
      await writeFile(managedMarker, "Managed EVA agent skill.\n", "utf8");
    }
  }
}

function weeklyConversationCount(db: DbConnection, agentId: string): number {
  return (
    db
      .select({ value: count() })
      .from(threads)
      .where(
        and(
          eq(threads.agentId, agentId),
          gte(threads.createdAt, Date.now() - 7 * 24 * 60 * 60 * 1_000),
          isNull(threads.deletedAt),
        ),
      )
      .get()?.value ?? 0
  );
}

function toView(
  deps: EvaAgentServiceDeps,
  agent: EvaAgentCatalogEntry,
): EvaAgentView {
  const skills = listEvaAgentSkills(deps.db, agent.id);
  const workspace = getEvaAgentWorkspace(deps.db, agent.id);
  if (workspace === null) throw new Error("EVA agent workspace is missing");
  return {
    ...agent,
    providerIds: [...agent.providerIds],
    reasoningLevels: [...agent.reasoningLevels],
    permissionModes: [...agent.permissionModes],
    skills,
    workspace: {
      workspaceKey: workspace.workspaceKey,
      relativePath: workspace.relativePath,
      status: workspace.status,
      lastScaffoldedAt: workspace.lastScaffoldedAt,
      managedFiles: managedFiles(skills),
    },
    weeklyConversationCount: weeklyConversationCount(deps.db, agent.id),
  };
}

function replaceSkills(
  db: DbConnection | DbTransaction,
  agentId: string,
  skills: readonly EvaAgentSkillInput[],
  now: number,
): void {
  db.delete(evaAgentSkills).where(eq(evaAgentSkills.agentId, agentId)).run();
  for (const [index, skill] of skills.entries()) {
    db.insert(evaAgentSkills)
      .values({
        agentId,
        id: skill.id,
        name: skill.name.trim(),
        instructions: skill.instructions.trim(),
        sortOrder: index,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }
}

export function createEvaAgentService(deps: EvaAgentServiceDeps) {
  ensureEvaAgentRegistry(deps.db);

  return {
    async initialize(): Promise<void> {
      for (const agent of listEvaAgentsFromDb(deps.db)) {
        const skills = listEvaAgentSkills(deps.db, agent.id);
        try {
          await scaffoldAgent(deps, agent, skills, false);
          const now = Date.now();
          deps.db
            .update(evaAgentWorkspaces)
            .set({
              lastScaffoldedAt: now,
              status: "managed",
              updatedAt: now,
            })
            .where(eq(evaAgentWorkspaces.agentId, agent.id))
            .run();
        } catch {
          deps.db
            .update(evaAgentWorkspaces)
            .set({ status: "error", updatedAt: Date.now() })
            .where(eq(evaAgentWorkspaces.agentId, agent.id))
            .run();
        }
      }
    },
    list(): EvaAgentView[] {
      return listEvaAgentsFromDb(deps.db).map((agent) => toView(deps, agent));
    },
    get(agentId: string): EvaAgentView | null {
      const agent = getEvaAgentForDb(deps.db, agentId);
      return agent === null ? null : toView(deps, agent);
    },
    async scaffold(agentId: string): Promise<EvaAgentView | null> {
      const agent = getEvaAgentForDb(deps.db, agentId);
      if (agent === null) return null;
      const skills = listEvaAgentSkills(deps.db, agentId);
      try {
        await scaffoldAgent(deps, agent, skills, true);
      } catch (error) {
        deps.db
          .update(evaAgentWorkspaces)
          .set({ status: "error", updatedAt: Date.now() })
          .where(eq(evaAgentWorkspaces.agentId, agentId))
          .run();
        throw error;
      }
      const now = Date.now();
      deps.db
        .update(evaAgentWorkspaces)
        .set({ lastScaffoldedAt: now, status: "managed", updatedAt: now })
        .where(eq(evaAgentWorkspaces.agentId, agentId))
        .run();
      return toView(deps, agent);
    },
    listThreads(agentId: string): EvaAgentThreadSummary[] {
      return deps.db
        .select({
          id: threads.id,
          projectId: threads.projectId,
          agentId: threads.agentId,
          title: threads.title,
          status: threads.status,
          visibility: threads.visibility,
          parentThreadId: threads.parentThreadId,
          createdAt: threads.createdAt,
          updatedAt: threads.updatedAt,
          ownerUserId: threads.ownerUserId,
        })
        .from(threads)
        .where(and(eq(threads.agentId, agentId), isNull(threads.deletedAt)))
        .orderBy(desc(threads.updatedAt), desc(threads.id))
        .limit(50)
        .all();
    },
    async create(input: CreateEvaAgentInput): Promise<EvaAgentView> {
      const id = validateEvaAgentId(input.id.trim());
      const now = Date.now();
      const providerId = input.providerId?.trim() || EVA_DEFAULT_PROVIDER_ID;
      const agent: EvaAgentCatalogEntry = {
        id,
        displayName: input.displayName.trim(),
        description: input.description.trim(),
        icon: input.icon.trim(),
        sortOrder:
          Math.max(
            0,
            ...listEvaAgentsFromDb(deps.db).map((entry) => entry.sortOrder),
          ) + 1,
        status: "draft",
        sourceProviderId: providerId,
        providerIds: [providerId],
        defaultProviderId: providerId,
        defaultModel: input.model?.trim() || EVA_DEFAULT_MODEL,
        defaultReasoningLevel:
          input.reasoningLevel ?? EVA_DEFAULT_REASONING_LEVEL,
        defaultPermissionMode:
          input.permissionMode ?? EVA_DEFAULT_PERMISSION_MODE,
        fixedExecution: false,
        reasoningLevels: reasoningLevelValues,
        permissionModes: permissionModeValues,
        instructions: input.instructions.trim(),
      };
      deps.db.transaction((tx) => {
        tx.insert(evaAgents)
          .values({
            id: agent.id,
            displayName: agent.displayName,
            description: agent.description,
            icon: agent.icon,
            status: agent.status,
            sourceProviderId: agent.sourceProviderId,
            providerIdsJson: JSON.stringify(agent.providerIds),
            defaultProviderId: agent.defaultProviderId,
            defaultModel: agent.defaultModel,
            defaultReasoningLevel: agent.defaultReasoningLevel,
            defaultPermissionMode: agent.defaultPermissionMode,
            fixedExecution: agent.fixedExecution,
            reasoningLevelsJson: JSON.stringify(agent.reasoningLevels),
            permissionModesJson: JSON.stringify(agent.permissionModes),
            instructions: agent.instructions,
            sortOrder: agent.sortOrder,
            createdAt: now,
            updatedAt: now,
          })
          .run();
        tx.insert(evaAgentWorkspaces)
          .values({
            agentId: agent.id,
            workspaceKey: agent.id,
            relativePath: `${EVA_AGENT_WORKSPACE_ROOT}/${agent.id}`,
            status: "managed",
            lastScaffoldedAt: null,
            createdAt: now,
            updatedAt: now,
          })
          .run();
      });
      await scaffoldAgent(deps, agent, [], false);
      deps.db
        .update(evaAgentWorkspaces)
        .set({
          lastScaffoldedAt: Date.now(),
          status: "managed",
          updatedAt: Date.now(),
        })
        .where(eq(evaAgentWorkspaces.agentId, agent.id))
        .run();
      return toView(deps, agent);
    },
    async update(
      agentId: string,
      input: UpdateEvaAgentInput,
    ): Promise<EvaAgentView | null> {
      const current = getEvaAgentForDb(deps.db, agentId);
      if (current === null) return null;
      const now = Date.now();
      const providerId =
        input.providerId === undefined
          ? current.defaultProviderId
          : input.providerId?.trim() || null;
      const next: EvaAgentCatalogEntry = {
        ...current,
        displayName: input.displayName?.trim() ?? current.displayName,
        description: input.description?.trim() ?? current.description,
        icon: input.icon?.trim() ?? current.icon,
        status: input.status ?? current.status,
        sourceProviderId: providerId,
        providerIds:
          providerId === null ? [...current.providerIds] : [providerId],
        defaultProviderId: providerId,
        defaultModel: input.model?.trim() ?? current.defaultModel,
        defaultReasoningLevel:
          input.reasoningLevel ?? current.defaultReasoningLevel,
        defaultPermissionMode:
          input.permissionMode ?? current.defaultPermissionMode,
        instructions: input.instructions?.trim() ?? current.instructions,
      };
      deps.db.transaction((tx) => {
        tx.update(evaAgents)
          .set({
            displayName: next.displayName,
            description: next.description,
            icon: next.icon,
            status: next.status,
            sourceProviderId: next.sourceProviderId,
            providerIdsJson: JSON.stringify(next.providerIds),
            defaultProviderId: next.defaultProviderId,
            defaultModel: next.defaultModel,
            defaultReasoningLevel: next.defaultReasoningLevel,
            defaultPermissionMode: next.defaultPermissionMode,
            instructions: next.instructions,
            updatedAt: now,
          })
          .where(eq(evaAgents.id, agentId))
          .run();
        if (input.skills !== undefined)
          replaceSkills(tx, agentId, input.skills, now);
      });
      const skills = listEvaAgentSkills(deps.db, agentId);
      await scaffoldAgent(deps, next, skills, true);
      deps.db
        .update(evaAgentWorkspaces)
        .set({
          lastScaffoldedAt: Date.now(),
          status: "managed",
          updatedAt: Date.now(),
        })
        .where(eq(evaAgentWorkspaces.agentId, agentId))
        .run();
      return toView(deps, next);
    },
    workspacePath(agentId: string): string | null {
      return getEvaAgentWorkspace(deps.db, agentId) === null
        ? null
        : workspacePath(deps, agentId);
    },
  };
}

export type EvaAgentService = ReturnType<typeof createEvaAgentService>;
