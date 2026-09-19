import type { PromptInput } from "@bb/domain";
import type { DbConnection } from "@bb/db";
import { ApiError } from "../../errors.js";
import { assertPluginAllowedForUser } from "../../access-policy.js";
import { resolvePluginMention } from "./plugin-agent-contributions.js";

type PluginMentionResource = Extract<
  Extract<PromptInput, { type: "text" }>["mentions"][number]["resource"],
  { kind: "plugin" }
>;

export interface PluginMentionAuthorization {
  db?: DbConnection;
  ownerUserId?: string | null;
  allowedPluginIds?: ReadonlySet<string>;
  agentId?: string;
}

function collectPluginMentionResources(
  input: readonly PromptInput[],
): PluginMentionResource[] {
  const seen = new Set<string>();
  const resources: PluginMentionResource[] = [];
  for (const item of input) {
    if (item.type !== "text") continue;
    for (const mention of item.mentions) {
      const resource = mention.resource;
      if (resource.kind !== "plugin") continue;
      const key = `${resource.pluginId}::${resource.itemId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      resources.push(resource);
    }
  }
  return resources;
}

export async function resolvePluginMentionContextInputs(
  input: readonly PromptInput[],
  authorization?: PluginMentionAuthorization,
): Promise<PromptInput[]> {
  const resources = collectPluginMentionResources(input);
  if (resources.length === 0) return [];
  const contextInputs: PromptInput[] = [];
  for (const resource of resources) {
    if (authorization?.allowedPluginIds !== undefined) {
      const allowed =
        authorization.allowedPluginIds.has("*") ||
        authorization.allowedPluginIds.has(resource.pluginId);
      if (!allowed) {
        throw new ApiError(
          403,
          "policy_denied",
          `Plugin "${resource.pluginId}" is not allowed by policy`,
        );
      }
    }
    if (
      authorization?.db !== undefined &&
      authorization.ownerUserId !== undefined &&
      authorization.ownerUserId !== null
    ) {
      assertPluginAllowedForUser(
        authorization.db,
        authorization.ownerUserId,
        resource.pluginId,
        authorization.agentId,
      );
    }
    const result = await resolvePluginMention({
      pluginId: resource.pluginId,
      itemId: resource.itemId,
    });
    if (!result.ok) {
      throw new ApiError(
        422,
        "plugin_mention_resolve_failed",
        `Could not resolve @${resource.label} (plugin "${resource.pluginId}"): ${result.error}`,
      );
    }
    contextInputs.push({
      type: "text",
      text: `Context for @${resource.label} (resolved by plugin "${resource.pluginId}"):\n\n${result.context}`,
      mentions: [],
      visibility: "agent-only",
    });
    for (const image of result.images) {
      if (image.context?.trim()) {
        contextInputs.push({
          type: "text",
          text: image.context,
          mentions: [],
          visibility: "agent-only",
        });
      }
      contextInputs.push({
        ...(image.type === "image"
          ? { type: "image" as const, url: image.url }
          : { type: "localImage" as const, path: image.path }),
        visibility: "agent-only",
      });
    }
  }
  return contextInputs;
}
