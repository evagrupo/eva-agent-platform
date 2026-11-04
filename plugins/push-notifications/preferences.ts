import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const notificationLevelSchema = z.enum([
  "all",
  "replies",
  "input-only",
  "muted",
]);
export const ownNotificationLevelSchema = z.enum([
  "inherit",
  ...notificationLevelSchema.options,
]);
export const notificationSourceSchema = z.enum([
  "self",
  "parent",
  "ancestor",
  "global",
  "child-default",
  "agent-chat-default",
]);

export const threadNotificationInputsSchema = z
  .object({
    own: ownNotificationLevelSchema,
    ancestorCap: z
      .object({ level: notificationLevelSchema, threadId: z.string().min(1) })
      .strict()
      .nullable(),
  })
  .strict();

export const threadNotificationsSchema = z
  .object({
    own: ownNotificationLevelSchema,
    effective: notificationLevelSchema,
    source: notificationSourceSchema,
  })
  .strict();

export type NotificationLevel = z.infer<typeof notificationLevelSchema>;
export type OwnNotificationLevel = z.infer<typeof ownNotificationLevelSchema>;
export type NotificationSource = z.infer<typeof notificationSourceSchema>;
export type ThreadNotificationInputs = z.infer<
  typeof threadNotificationInputsSchema
>;
export type ThreadNotifications = z.infer<typeof threadNotificationsSchema>;

export interface NotificationDefaults {
  defaultLevel: NotificationLevel;
  childLevel: OwnNotificationLevel;
}

export const UNSET_THREAD_NOTIFICATIONS: ThreadNotificationInputs = {
  own: "inherit",
  ancestorCap: null,
};

export const NOTIFICATION_LEVEL_LABELS: Record<OwnNotificationLevel, string> = {
  inherit: "Same as default",
  all: "All activity",
  replies: "Replies only",
  "input-only": "Needs input only",
  muted: "Muted",
};

export type PushNotificationKind =
  | "pending-interaction"
  | "turn-finished"
  | "thread-error";

export const NOTIFICATION_KINDS_BY_LEVEL: Record<
  NotificationLevel,
  ReadonlySet<PushNotificationKind>
> = {
  all: new Set(["pending-interaction", "thread-error", "turn-finished"]),
  // "turn-finished" here only covers turns that produced assistant text; see
  // LEVELS_REQUIRING_REPLY_TEXT.
  replies: new Set(["pending-interaction", "turn-finished"]),
  "input-only": new Set(["pending-interaction", "thread-error"]),
  muted: new Set(),
};

/** Levels that drop a finished turn unless it ended with assistant text. */
export const LEVELS_REQUIRING_REPLY_TEXT: ReadonlySet<NotificationLevel> =
  new Set(["replies"]);

/**
 * Loudness order used for ancestor caps. "replies" and "input-only" are not
 * strict subsets of each other (replies drops errors, input-only drops
 * replies), so ranking replies between input-only and all is an
 * approximation: a "replies" ancestor caps an "all" descendant to "replies",
 * and an "input-only" ancestor caps a "replies" descendant to "input-only".
 */
const LEVEL_RANK: Record<NotificationLevel, number> = {
  muted: 0,
  "input-only": 1,
  replies: 2,
  all: 3,
};

/** The admin agent's threads behave like ordinary threads. */
const ADMIN_AGENT_ID = "admin";

export const AGENT_CHAT_DEFAULT_LEVEL: NotificationLevel = "replies";

/**
 * An EVA agent chat: a top-level thread assigned to a non-admin agent.
 */
export function isAgentChat(thread: {
  parentThreadId: string | null;
  agentId?: string | null;
}): boolean {
  return (
    thread.parentThreadId === null &&
    typeof thread.agentId === "string" &&
    thread.agentId.length > 0 &&
    thread.agentId !== ADMIN_AGENT_ID
  );
}

function isQuieter(
  candidate: NotificationLevel,
  than: NotificationLevel,
): boolean {
  return LEVEL_RANK[candidate] < LEVEL_RANK[than];
}

export function resolveThreadNotifications(
  stored: ThreadNotificationInputs,
  thread: { parentThreadId: string | null; agentId?: string | null },
  defaults: NotificationDefaults,
): ThreadNotifications {
  const { own, ancestorCap } = stored;
  const base: { level: NotificationLevel; source: NotificationSource } =
    own !== "inherit"
      ? { level: own, source: "self" }
      : thread.parentThreadId !== null && defaults.childLevel !== "inherit"
        ? { level: defaults.childLevel, source: "child-default" }
        : isAgentChat(thread) &&
            !isQuieter(defaults.defaultLevel, AGENT_CHAT_DEFAULT_LEVEL)
          ? { level: AGENT_CHAT_DEFAULT_LEVEL, source: "agent-chat-default" }
          : { level: defaults.defaultLevel, source: "global" };
  if (ancestorCap === null || !isQuieter(ancestorCap.level, base.level)) {
    return { own, effective: base.level, source: base.source };
  }
  return {
    own,
    effective: ancestorCap.level,
    source:
      ancestorCap.threadId === thread.parentThreadId ? "parent" : "ancestor",
  };
}

export function describeNotificationSource(row: ThreadNotifications): string {
  if (row.source === "self") return "set on this thread";
  if (row.source === "parent") return "limited by parent";
  if (row.source === "ancestor") return "limited by an ancestor";
  if (row.source === "child-default") return "child-thread default";
  if (row.source === "agent-chat-default") return "agent chat default";
  return "default";
}

function isUnset(inputs: ThreadNotificationInputs): boolean {
  return inputs.own === "inherit" && inputs.ancestorCap === null;
}

const SDK_THREAD_BATCH_MAX_IDS = 200;

function chunk<T>(items: readonly T[]): T[][] {
  const chunks: T[][] = [];
  for (let start = 0; start < items.length; start += SDK_THREAD_BATCH_MAX_IDS) {
    chunks.push(items.slice(start, start + SDK_THREAD_BATCH_MAX_IDS));
  }
  return chunks;
}

const NOTIFICATIONS_METADATA_KEY = "notifications";

const storedNotificationsMetadataSchema = z.object({
  [NOTIFICATIONS_METADATA_KEY]: z
    .object({ own: notificationLevelSchema })
    .strict(),
});

export function parseStoredNotificationLevel(
  metadata: unknown,
): NotificationLevel | null {
  const parsed = storedNotificationsMetadataSchema.safeParse(metadata);
  return parsed.success ? parsed.data[NOTIFICATIONS_METADATA_KEY].own : null;
}

interface ResolvedThreadInputs {
  inputs: ThreadNotificationInputs;
  parentThreadId: string | null;
}

export interface NotificationPreferences {
  list(
    threadIds: readonly string[],
  ): Promise<Record<string, ThreadNotificationInputs>>;
  get(threadId: string): Promise<ThreadNotifications>;
  set(
    threadId: string,
    level: OwnNotificationLevel,
  ): Promise<ThreadNotificationInputs>;
  effectiveLevel(thread: {
    id: string;
    parentThreadId: string | null;
    agentId?: string | null;
  }): Promise<NotificationLevel>;
  publishSubtree(threadId: string): Promise<void>;
}

export function createNotificationPreferences(args: {
  bb: BbPluginApi;
  getDefaults(): Promise<NotificationDefaults>;
  publish(threadIds: readonly string[]): void;
}): NotificationPreferences {
  const { bb, getDefaults, publish } = args;

  async function readOwnLevels(
    threadIds: readonly string[],
  ): Promise<Map<string, NotificationLevel>> {
    const levels = new Map<string, NotificationLevel>();
    for (const batch of chunk(threadIds)) {
      const { threads } = await bb.sdk.threads.experimental_listPluginMetadata({
        threadIds: batch,
      });
      for (const { threadId, metadata } of threads) {
        const level = parseStoredNotificationLevel(metadata);
        if (level !== null) levels.set(threadId, level);
      }
    }
    return levels;
  }

  async function resolveInputs(
    threadIds: readonly string[],
  ): Promise<Map<string, ResolvedThreadInputs>> {
    const ancestry: { threadId: string; ancestorIds: string[] }[] = [];
    for (const batch of chunk(threadIds)) {
      const { threads } = await bb.sdk.threads.experimental_listAncestors({
        threadIds: batch,
      });
      ancestry.push(...threads);
    }
    const levels = await readOwnLevels([
      ...new Set(
        ancestry.flatMap(({ threadId, ancestorIds }) => [
          threadId,
          ...ancestorIds,
        ]),
      ),
    ]);
    const resolved = new Map<string, ResolvedThreadInputs>();
    for (const { threadId, ancestorIds } of ancestry) {
      let ancestorCap: ThreadNotificationInputs["ancestorCap"] = null;
      for (const ancestorId of ancestorIds) {
        const level = levels.get(ancestorId);
        if (
          level !== undefined &&
          (ancestorCap === null || isQuieter(level, ancestorCap.level))
        ) {
          ancestorCap = { level, threadId: ancestorId };
        }
      }
      resolved.set(threadId, {
        inputs: { own: levels.get(threadId) ?? "inherit", ancestorCap },
        parentThreadId: ancestorIds[0] ?? null,
      });
    }
    return resolved;
  }

  async function requireInputs(
    threadId: string,
  ): Promise<ResolvedThreadInputs> {
    const resolved = (await resolveInputs([threadId])).get(threadId);
    if (resolved === undefined) throw new Error("Thread not found");
    return resolved;
  }

  async function publishSubtree(threadId: string): Promise<void> {
    const { threads } = await bb.sdk.threads.experimental_listDescendants({
      threadIds: [threadId],
    });
    publish([threadId, ...(threads[0]?.descendantIds ?? [])]);
  }

  return {
    async list(threadIds) {
      const result: Record<string, ThreadNotificationInputs> = {};
      for (const [threadId, { inputs }] of await resolveInputs(threadIds)) {
        if (!isUnset(inputs)) result[threadId] = inputs;
      }
      return result;
    },
    async get(threadId) {
      const [{ inputs, parentThreadId }, defaults] = await Promise.all([
        requireInputs(threadId),
        getDefaults(),
      ]);
      const agentId = await bb.sdk.threads
        .get({ threadId })
        .then((thread) => thread.agentId ?? null)
        .catch(() => null);
      return resolveThreadNotifications(
        inputs,
        { parentThreadId, agentId },
        defaults,
      );
    },
    async set(threadId, level) {
      await requireInputs(threadId);
      await bb.sdk.threads.updatePluginMetadata(
        level === "inherit"
          ? { threadId, remove: [NOTIFICATIONS_METADATA_KEY] }
          : { threadId, set: { [NOTIFICATIONS_METADATA_KEY]: { own: level } } },
      );
      await publishSubtree(threadId);
      return (await requireInputs(threadId)).inputs;
    },
    async effectiveLevel(thread) {
      const [resolved, defaults] = await Promise.all([
        resolveInputs([thread.id]),
        getDefaults(),
      ]);
      return resolveThreadNotifications(
        resolved.get(thread.id)?.inputs ?? UNSET_THREAD_NOTIFICATIONS,
        { parentThreadId: thread.parentThreadId, agentId: thread.agentId },
        defaults,
      ).effective;
    },
    async publishSubtree(threadId) {
      await publishSubtree(threadId);
    },
  };
}
