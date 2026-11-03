import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import {
  createEvaAgentMemoryId,
  evaAgentMemories,
  type DbConnection,
  type DbQueryConnection,
} from "@bb/db";
import { ApiError } from "../errors.js";

export const EVA_AGENT_MEMORY_KINDS = [
  "preference",
  "correction",
  "pattern",
  "fact",
] as const;
export type EvaAgentMemoryKind = (typeof EVA_AGENT_MEMORY_KINDS)[number];

export const EVA_AGENT_MEMORY_TITLE_MAX_CHARS = 60;
export const EVA_AGENT_MEMORY_BODY_MAX_CHARS = 4_000;
export const EVA_AGENT_MEMORY_MAX_PER_SCOPE = 200;
export const EVA_AGENT_MEMORY_INSTRUCTION_MAX_TITLES = 40;
export const EVA_AGENT_MEMORY_INSTRUCTION_MAX_CHARS = 2_500;

export interface EvaAgentMemoryScope {
  agentId: string;
  ownerUserId: string;
}

export interface EvaAgentMemory {
  id: string;
  agentId: string;
  ownerUserId: string;
  title: string;
  body: string;
  kind: EvaAgentMemoryKind;
  sourceThreadId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface EvaAgentMemoryTitle {
  id: string;
  title: string;
  kind: EvaAgentMemoryKind;
  updatedAt: number;
}

export interface EvaAgentMemoryTitleList {
  titles: EvaAgentMemoryTitle[];
  total: number;
}

export interface SaveEvaAgentMemoryInput {
  id?: string;
  title: string;
  body: string;
  kind: EvaAgentMemoryKind;
  sourceThreadId: string | null;
}

export interface UpdateEvaAgentMemoryInput {
  title?: string;
  body?: string;
  kind?: EvaAgentMemoryKind;
}

export interface SaveEvaAgentMemoryResult {
  memory: EvaAgentMemory;
  status: "created" | "updated";
}

const SECRET_PATTERNS: readonly RegExp[] = [
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----/u,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/u,
  /\bgh[pousr]_[A-Za-z0-9]{30,}/u,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/u,
  /\bglpat-[A-Za-z0-9_-]{20,}/u,
  /\bsk-(?:ant-|proj-|live-|test-)?[A-Za-z0-9_-]{20,}/u,
  /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}/u,
  /\bxox[abeprs]-[A-Za-z0-9-]{10,}/u,
  /\bAIza[0-9A-Za-z_-]{35}\b/u,
  /\bEAA[A-Za-z0-9]{40,}/u,
  /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/u,
  /\bbearer\s+[A-Za-z0-9._~+/-]{16,}=*/iu,
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/?#@]+:[^\s/?#@]+@/iu,
];

const SECRET_ASSIGNMENT_PATTERN =
  /\b(?:password|passwd|passphrase|pwd|secret|client[_ -]?secret|api[_ -]?key|access[_ -]?key|secret[_ -]?key|private[_ -]?key|access[_ -]?token|auth[_ -]?token|refresh[_ -]?token|token|credentials?|contrase(?:ñ|n)a|clave|senha)["']?\s*(?:[:=]|=>)\s*["']?([^\s"']{6,})/giu;

const OPAQUE_TOKEN_PATTERN = /[A-Za-z0-9_+=-]{32,}/gu;

function shannonEntropy(value: string): number {
  const counts = new Map<string, number>();
  for (const char of value) counts.set(char, (counts.get(char) ?? 0) + 1);
  let entropy = 0;
  for (const count of counts.values()) {
    const probability = count / value.length;
    entropy -= probability * Math.log2(probability);
  }
  return entropy;
}

function hasSecretAssignment(text: string): boolean {
  for (const match of text.matchAll(SECRET_ASSIGNMENT_PATTERN)) {
    const value = match[1] ?? "";
    if (value.length >= 12 || /[^\p{L}]/u.test(value)) return true;
  }
  return false;
}

function hasOpaqueToken(text: string): boolean {
  for (const match of text.matchAll(OPAQUE_TOKEN_PATTERN)) {
    const token = match[0];
    const isUrlPathSegment = text[match.index - 1] === "/";
    if (
      !isUrlPathSegment &&
      /[0-9]/u.test(token) &&
      /[A-Za-z]/u.test(token) &&
      shannonEntropy(token) >= 4.6
    ) {
      return true;
    }
  }
  return false;
}

export function looksLikeEvaAgentMemorySecret(text: string): boolean {
  return (
    SECRET_PATTERNS.some((pattern) => pattern.test(text)) ||
    hasSecretAssignment(text) ||
    hasOpaqueToken(text)
  );
}

function characters(value: string): string[] {
  return Array.from(value);
}

export function normalizeEvaAgentMemoryTitle(title: string): string {
  const compact = title.replace(/\s+/gu, " ").trim();
  const chars = characters(compact);
  if (chars.length <= EVA_AGENT_MEMORY_TITLE_MAX_CHARS) return compact;
  return chars.slice(0, EVA_AGENT_MEMORY_TITLE_MAX_CHARS).join("").trimEnd();
}

export function evaAgentMemoryTitleKey(title: string): string {
  return normalizeEvaAgentMemoryTitle(title)
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function invalid(message: string): never {
  throw new ApiError(400, "invalid_memory", message);
}

function prepareTitle(title: string): string {
  const normalized = normalizeEvaAgentMemoryTitle(title);
  if (evaAgentMemoryTitleKey(normalized) === "") {
    invalid("A memory needs a short title");
  }
  return normalized;
}

function prepareBody(body: string): string {
  const trimmed = body.trim();
  if (trimmed.length === 0) invalid("A memory needs details");
  if (characters(trimmed).length > EVA_AGENT_MEMORY_BODY_MAX_CHARS) {
    invalid(
      `Memory details must be at most ${EVA_AGENT_MEMORY_BODY_MAX_CHARS} characters; summarize them`,
    );
  }
  return trimmed;
}

function assertNoSecret(...texts: string[]): void {
  if (texts.some(looksLikeEvaAgentMemorySecret)) {
    throw new ApiError(
      400,
      "memory_secret_rejected",
      "This memory looks like it contains a secret (API key, token, password, or private key). Never store credentials in memory.",
    );
  }
}

function inScope(scope: EvaAgentMemoryScope) {
  return and(
    eq(evaAgentMemories.agentId, scope.agentId),
    eq(evaAgentMemories.ownerUserId, scope.ownerUserId),
  );
}

const titleColumns = {
  id: evaAgentMemories.id,
  title: evaAgentMemories.title,
  kind: evaAgentMemories.kind,
  updatedAt: evaAgentMemories.updatedAt,
};

export function listEvaAgentMemories(
  db: DbQueryConnection,
  scope: EvaAgentMemoryScope,
): EvaAgentMemory[] {
  return db
    .select()
    .from(evaAgentMemories)
    .where(inScope(scope))
    .orderBy(
      desc(evaAgentMemories.updatedAt),
      desc(evaAgentMemories.createdAt),
      asc(evaAgentMemories.id),
    )
    .all();
}

export function countEvaAgentMemories(
  db: DbQueryConnection,
  scope: EvaAgentMemoryScope,
): number {
  return (
    db
      .select({ count: sql<number>`count(*)` })
      .from(evaAgentMemories)
      .where(inScope(scope))
      .get()?.count ?? 0
  );
}

export function listEvaAgentMemoryTitles(
  db: DbQueryConnection,
  scope: EvaAgentMemoryScope,
  limit: number = EVA_AGENT_MEMORY_INSTRUCTION_MAX_TITLES,
): EvaAgentMemoryTitleList {
  const titles = db
    .select(titleColumns)
    .from(evaAgentMemories)
    .where(inScope(scope))
    .orderBy(
      sql`CASE WHEN ${evaAgentMemories.kind} IN ('preference', 'correction') THEN 0 ELSE 1 END`,
      desc(evaAgentMemories.updatedAt),
      desc(evaAgentMemories.createdAt),
      asc(evaAgentMemories.id),
    )
    .limit(limit)
    .all();
  return {
    titles,
    total:
      titles.length < limit ? titles.length : countEvaAgentMemories(db, scope),
  };
}

export function getEvaAgentMemory(
  db: DbQueryConnection,
  scope: EvaAgentMemoryScope,
  id: string,
): EvaAgentMemory | null {
  return (
    db
      .select()
      .from(evaAgentMemories)
      .where(and(eq(evaAgentMemories.id, id), inScope(scope)))
      .get() ?? null
  );
}

export function findEvaAgentMemoryScope(
  db: DbQueryConnection,
  agentId: string,
  id: string,
): EvaAgentMemoryScope | null {
  const row = db
    .select({
      agentId: evaAgentMemories.agentId,
      ownerUserId: evaAgentMemories.ownerUserId,
    })
    .from(evaAgentMemories)
    .where(
      and(eq(evaAgentMemories.id, id), eq(evaAgentMemories.agentId, agentId)),
    )
    .get();
  return row ?? null;
}

function findByTitleKey(
  db: DbQueryConnection,
  scope: EvaAgentMemoryScope,
  titleKey: string,
  excludeId: string | null,
): EvaAgentMemoryTitle | null {
  return (
    db
      .select(titleColumns)
      .from(evaAgentMemories)
      .where(
        excludeId === null
          ? inScope(scope)
          : and(inScope(scope), ne(evaAgentMemories.id, excludeId)),
      )
      .orderBy(desc(evaAgentMemories.updatedAt), asc(evaAgentMemories.id))
      .all()
      .find(
        (candidate) => evaAgentMemoryTitleKey(candidate.title) === titleKey,
      ) ?? null
  );
}

function pruneScope(
  db: DbQueryConnection,
  scope: EvaAgentMemoryScope,
  keepId: string,
): void {
  const excess =
    countEvaAgentMemories(db, scope) - EVA_AGENT_MEMORY_MAX_PER_SCOPE;
  if (excess <= 0) return;
  const victims = db
    .select({ id: evaAgentMemories.id })
    .from(evaAgentMemories)
    .where(and(inScope(scope), ne(evaAgentMemories.id, keepId)))
    .orderBy(
      sql`CASE WHEN ${evaAgentMemories.kind} = 'preference' THEN 1 ELSE 0 END`,
      asc(evaAgentMemories.updatedAt),
      asc(evaAgentMemories.createdAt),
      asc(evaAgentMemories.id),
    )
    .limit(excess)
    .all()
    .map((row) => row.id);
  if (victims.length === 0) return;
  db.delete(evaAgentMemories)
    .where(and(inScope(scope), inArray(evaAgentMemories.id, victims)))
    .run();
}

function duplicateTitle(existing: EvaAgentMemoryTitle): never {
  throw new ApiError(
    409,
    "memory_title_conflict",
    `Another memory already uses this title (id: ${existing.id}); update that memory instead`,
  );
}

function memoryNotFound(): never {
  throw new ApiError(404, "memory_not_found", "Memory not found");
}

export function saveEvaAgentMemory(
  db: DbConnection,
  scope: EvaAgentMemoryScope,
  input: SaveEvaAgentMemoryInput,
): SaveEvaAgentMemoryResult {
  const title = prepareTitle(input.title);
  const body = prepareBody(input.body);
  assertNoSecret(title, body);
  const titleKey = evaAgentMemoryTitleKey(title);
  return db.transaction((tx) => {
    const now = Date.now();
    let targetId: string | null;
    if (input.id === undefined) {
      targetId = findByTitleKey(tx, scope, titleKey, null)?.id ?? null;
    } else {
      if (getEvaAgentMemory(tx, scope, input.id) === null) memoryNotFound();
      const conflict = findByTitleKey(tx, scope, titleKey, input.id);
      if (conflict !== null) duplicateTitle(conflict);
      targetId = input.id;
    }
    if (targetId !== null) {
      tx.update(evaAgentMemories)
        .set({
          title,
          body,
          kind: input.kind,
          sourceThreadId: input.sourceThreadId,
          updatedAt: now,
        })
        .where(and(eq(evaAgentMemories.id, targetId), inScope(scope)))
        .run();
      const memory = getEvaAgentMemory(tx, scope, targetId);
      if (memory === null) memoryNotFound();
      return { memory, status: "updated" };
    }
    const id = createEvaAgentMemoryId();
    tx.insert(evaAgentMemories)
      .values({
        id,
        agentId: scope.agentId,
        ownerUserId: scope.ownerUserId,
        title,
        body,
        kind: input.kind,
        sourceThreadId: input.sourceThreadId,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    pruneScope(tx, scope, id);
    const memory = getEvaAgentMemory(tx, scope, id);
    if (memory === null) memoryNotFound();
    return { memory, status: "created" };
  });
}

export function updateEvaAgentMemory(
  db: DbConnection,
  scope: EvaAgentMemoryScope,
  id: string,
  input: UpdateEvaAgentMemoryInput,
): EvaAgentMemory | null {
  return db.transaction((tx) => {
    const current = getEvaAgentMemory(tx, scope, id);
    if (current === null) return null;
    const title =
      input.title === undefined ? current.title : prepareTitle(input.title);
    const body =
      input.body === undefined ? current.body : prepareBody(input.body);
    assertNoSecret(title, body);
    const conflict = findByTitleKey(
      tx,
      scope,
      evaAgentMemoryTitleKey(title),
      id,
    );
    if (conflict !== null) duplicateTitle(conflict);
    tx.update(evaAgentMemories)
      .set({
        title,
        body,
        kind: input.kind ?? current.kind,
        updatedAt: Date.now(),
      })
      .where(and(eq(evaAgentMemories.id, id), inScope(scope)))
      .run();
    return getEvaAgentMemory(tx, scope, id);
  });
}

export function forgetEvaAgentMemory(
  db: DbQueryConnection,
  scope: EvaAgentMemoryScope,
  id: string,
): boolean {
  return (
    db
      .delete(evaAgentMemories)
      .where(and(eq(evaAgentMemories.id, id), inScope(scope)))
      .run().changes > 0
  );
}

const MEMORY_GUIDANCE = [
  "How to use your memory:",
  "- When a remembered item is relevant to the request, open its details with `eva_memory_get` before relying on it.",
  "- Save a memory with `eva_memory_save` whenever the user states a preference, corrects you, or you discover that something was wrong or that an approach works well. Use kind `preference`, `correction`, `pattern`, or `fact`.",
  "- Keep titles under 60 characters and put the specifics in the details.",
  "- Update an existing memory (pass its id or reuse its title) instead of creating a duplicate, and remove outdated or wrong memories with `eva_memory_forget`.",
  "- Never store passwords, API keys, tokens, or other secrets, and never store other people's private data.",
  "- Never mention the memory system to the user unless they ask about it.",
].join("\n");

export function formatEvaAgentMemoryInstructions(
  memories: EvaAgentMemoryTitleList,
): string {
  const header = "# What you remember about this user";
  if (memories.titles.length === 0) {
    return [
      header,
      "You have no saved memories about this user yet. Save what you learn so that you get better with every conversation.",
      MEMORY_GUIDANCE,
    ].join("\n\n");
  }
  const lines: string[] = [];
  let usedChars = 0;
  for (const memory of memories.titles.slice(
    0,
    EVA_AGENT_MEMORY_INSTRUCTION_MAX_TITLES,
  )) {
    const line = `- [${memory.kind}] ${memory.title.replace(/\s+/gu, " ")} (id: ${memory.id})`;
    if (usedChars + line.length + 1 > EVA_AGENT_MEMORY_INSTRUCTION_MAX_CHARS) {
      break;
    }
    lines.push(line);
    usedChars += line.length + 1;
  }
  const hidden = memories.total - lines.length;
  if (hidden > 0) {
    lines.push(
      `- ${hidden} older ${hidden === 1 ? "memory is" : "memories are"} not listed.`,
    );
  }
  return [
    header,
    "These are the titles of your saved memories about this user, preferences and corrections first, then the most recent. They persist across conversations.",
    lines.join("\n"),
    MEMORY_GUIDANCE,
  ].join("\n\n");
}
