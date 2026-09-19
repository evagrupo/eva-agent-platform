import { and, asc, eq } from "drizzle-orm";
import {
  evaAgentSkills,
  evaAgentWorkspaces,
  evaAgents,
  type DbConnection,
  type DbQueryConnection,
} from "@bb/db";
import { permissionModeValues, reasoningLevelValues } from "@bb/domain";
import { z } from "zod";
import {
  EVA_AGENT_CATALOG,
  type EvaAgentCatalogEntry,
} from "./eva-agent-catalog.js";

export const EVA_AGENT_WORKSPACE_ROOT = "eva-agents" as const;

const agentIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u);

const reasoningLevelsSchema = z.array(z.enum(reasoningLevelValues)).max(16);
const permissionModesSchema = z.array(z.enum(permissionModeValues)).max(16);
const stringListSchema = z.array(z.string().min(1).max(512)).max(256);

export type EvaAgentSkill = typeof evaAgentSkills.$inferSelect;
export type EvaAgentWorkspace = typeof evaAgentWorkspaces.$inferSelect;

function parseStoredList(
  value: string,
  schema: typeof stringListSchema,
): string[];
function parseStoredList(
  value: string,
  schema: typeof reasoningLevelsSchema,
): (typeof reasoningLevelValues)[number][];
function parseStoredList(
  value: string,
  schema: typeof permissionModesSchema,
): (typeof permissionModeValues)[number][];
function parseStoredList(
  value: string,
  schema: z.ZodType<readonly string[]>,
): string[] {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(value);
  } catch {
    throw new Error("Stored EVA agent configuration is invalid");
  }
  const parsed = schema.safeParse(parsedJson);
  if (!parsed.success)
    throw new Error("Stored EVA agent configuration is invalid");
  return [...parsed.data];
}

function toCatalogEntry(
  row: typeof evaAgents.$inferSelect,
): EvaAgentCatalogEntry {
  const providerIds = parseStoredList(row.providerIdsJson, stringListSchema);
  const reasoningLevels = parseStoredList(
    row.reasoningLevelsJson,
    reasoningLevelsSchema,
  );
  const permissionModes = parseStoredList(
    row.permissionModesJson,
    permissionModesSchema,
  );
  return {
    id: row.id,
    displayName: row.displayName,
    description: row.description,
    icon: row.icon,
    sortOrder: row.sortOrder,
    status: row.status,
    sourceProviderId: row.sourceProviderId,
    providerIds,
    defaultProviderId: row.defaultProviderId,
    defaultModel: row.defaultModel,
    defaultReasoningLevel: row.defaultReasoningLevel,
    defaultPermissionMode: row.defaultPermissionMode,
    fixedExecution: row.fixedExecution,
    reasoningLevels,
    permissionModes,
    instructions: row.instructions,
  };
}

function storedAgent(
  db: DbQueryConnection,
  agentId: string,
): typeof evaAgents.$inferSelect | null {
  return (
    db.select().from(evaAgents).where(eq(evaAgents.id, agentId)).get() ?? null
  );
}

export function getEvaAgentForDb(
  db: DbQueryConnection,
  agentId: string,
): EvaAgentCatalogEntry | null {
  const row = storedAgent(db, agentId);
  return row === null ? null : toCatalogEntry(row);
}

export function listEvaAgentsFromDb(
  db: DbQueryConnection,
): EvaAgentCatalogEntry[] {
  return db
    .select()
    .from(evaAgents)
    .orderBy(asc(evaAgents.sortOrder), asc(evaAgents.id))
    .all()
    .map(toCatalogEntry);
}

export function isKnownEvaAgentIdForDb(
  db: DbQueryConnection,
  agentId: string,
): boolean {
  return storedAgent(db, agentId) !== null;
}

export function evaAgentAllowsProviderForDb(
  db: DbQueryConnection,
  agentId: string,
  providerId: string,
): boolean {
  return (
    getEvaAgentForDb(db, agentId)?.providerIds.includes(providerId) ?? false
  );
}

export function listEvaAgentSkills(
  db: DbQueryConnection,
  agentId: string,
): EvaAgentSkill[] {
  return db
    .select()
    .from(evaAgentSkills)
    .where(eq(evaAgentSkills.agentId, agentId))
    .orderBy(asc(evaAgentSkills.sortOrder), asc(evaAgentSkills.id))
    .all();
}

export function getEvaAgentWorkspace(
  db: DbQueryConnection,
  agentId: string,
): EvaAgentWorkspace | null {
  return (
    db
      .select()
      .from(evaAgentWorkspaces)
      .where(eq(evaAgentWorkspaces.agentId, agentId))
      .get() ?? null
  );
}

function catalogValues(entry: EvaAgentCatalogEntry, now: number) {
  return {
    id: entry.id,
    displayName: entry.displayName,
    description: entry.description,
    icon: entry.icon,
    status: entry.status,
    sourceProviderId: entry.sourceProviderId,
    providerIdsJson: JSON.stringify(entry.providerIds),
    defaultProviderId: entry.defaultProviderId,
    defaultModel: entry.defaultModel,
    defaultReasoningLevel: entry.defaultReasoningLevel,
    defaultPermissionMode: entry.defaultPermissionMode,
    fixedExecution: entry.fixedExecution,
    reasoningLevelsJson: JSON.stringify(entry.reasoningLevels),
    permissionModesJson: JSON.stringify(entry.permissionModes),
    instructions: entry.instructions,
    sortOrder: entry.sortOrder,
    createdAt: now,
    updatedAt: now,
  };
}

export function ensureEvaAgentRegistry(db: DbConnection): void {
  const now = Date.now();
  db.transaction((tx) => {
    for (const entry of EVA_AGENT_CATALOG) {
      tx.insert(evaAgents)
        .values(catalogValues(entry, now))
        .onConflictDoNothing()
        .run();
      tx.insert(evaAgentWorkspaces)
        .values({
          agentId: entry.id,
          workspaceKey: entry.id,
          relativePath: `${EVA_AGENT_WORKSPACE_ROOT}/${entry.id}`,
          status: "managed",
          lastScaffoldedAt: null,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing()
        .run();
    }
  });
}

export function validateEvaAgentId(agentId: string): string {
  const parsed = agentIdSchema.safeParse(agentId);
  if (!parsed.success) throw new Error("Invalid EVA agent id");
  return parsed.data;
}

export function isEvaAgentId(value: string): boolean {
  return agentIdSchema.safeParse(value).success;
}

export function listEvaAgentIds(db: DbQueryConnection): Set<string> {
  return new Set(
    db
      .select({ id: evaAgents.id })
      .from(evaAgents)
      .all()
      .map((row) => row.id),
  );
}

export function listEvaAgentProviderIds(
  db: DbQueryConnection,
): Map<string, readonly string[]> {
  return new Map(
    listEvaAgentsFromDb(db).map((agent) => [agent.id, agent.providerIds]),
  );
}

export function agentWorkspaceRowsForAgent(
  db: DbConnection,
  agentId: string,
): { workspace: EvaAgentWorkspace; skillCount: number } | null {
  const workspace = getEvaAgentWorkspace(db, agentId);
  if (workspace === null) return null;
  const skillCount = db
    .select({ id: evaAgentSkills.id })
    .from(evaAgentSkills)
    .where(and(eq(evaAgentSkills.agentId, agentId)))
    .all().length;
  return { workspace, skillCount };
}
