import type { ToolCallResponse } from "@bb/domain";
import type { HostDaemonContributedEnvEntry } from "@bb/host-daemon-contract";
import type { ExperimentalPluginProviderEnvContext } from "@get-bb/plugin-sdk";
import type {
  PluginAgentConfigurationContext,
  PluginAgentToolContext,
  PluginAgentToolRecord,
} from "./plugin-api.js";
import type {
  PluginAgentToolContribution,
  PluginMentionResolveResult,
  PluginService,
  PluginSkillRootContribution,
} from "./plugin-service.js";

type PluginAgentContributions = Pick<
  PluginService,
  | "listSkillRootContributions"
  | "listAgentTools"
  | "listInstructionContributions"
  | "findAgentTool"
  | "invokeAgentTool"
  | "resolveMention"
> &
  Partial<
    Pick<
      PluginService,
      | "resolveAgentConfiguration"
      | "resolveProviderEnv"
      | "resolveProviderEnvHealth"
    >
  >;

let contributions: PluginAgentContributions | undefined;

function pluginAllowed(
  allowedPluginIds: ReadonlySet<string> | undefined,
  pluginId: string,
): boolean {
  return (
    allowedPluginIds === undefined ||
    allowedPluginIds.has("*") ||
    allowedPluginIds.has(pluginId)
  );
}

export function setPluginAgentContributions(
  next: PluginAgentContributions | undefined,
): void {
  contributions = next;
}

export function getPluginSkillRootContributions(): PluginSkillRootContribution[] {
  return contributions?.listSkillRootContributions() ?? [];
}

export function listPluginAgentTools(
  allowedPluginIds?: ReadonlySet<string>,
): PluginAgentToolContribution[] {
  return (contributions?.listAgentTools() ?? []).filter((entry) =>
    pluginAllowed(allowedPluginIds, entry.pluginId),
  );
}

export async function resolvePluginAgentConfiguration(args: {
  context: Omit<PluginAgentConfigurationContext, "pluginMetadata">;
  skillIdsByPlugin: ReadonlyMap<string, readonly string[]>;
  allowedPluginIds?: ReadonlySet<string>;
}) {
  const active = contributions;
  if (!active?.resolveAgentConfiguration) {
    const tools = listPluginAgentTools(args.allowedPluginIds);
    return {
      tools,
      selectedSkillIdsByPlugin: new Map<string, ReadonlySet<string>>(),
      dynamicInstructions: [] as Array<{ pluginId: string; text: string }>,
    };
  }
  const resolved = await active.resolveAgentConfiguration(args);
  return {
    tools: resolved.tools.filter((entry) =>
      pluginAllowed(args.allowedPluginIds, entry.pluginId),
    ),
    selectedSkillIdsByPlugin: new Map(
      [...resolved.selectedSkillIdsByPlugin].filter(([pluginId]) =>
        pluginAllowed(args.allowedPluginIds, pluginId),
      ),
    ),
    dynamicInstructions: resolved.dynamicInstructions.filter((entry) =>
      pluginAllowed(args.allowedPluginIds, entry.pluginId),
    ),
  };
}

export function listPluginInstructionContributions(
  allowedPluginIds?: ReadonlySet<string>,
): Array<{
  pluginId: string;
  provider: (ctx: { threadId: string; projectId: string }) => string | null;
}> {
  return (contributions?.listInstructionContributions() ?? []).filter((entry) =>
    pluginAllowed(allowedPluginIds, entry.pluginId),
  );
}

export async function resolvePluginProviderEnv(args: {
  providerId: string;
  context: ExperimentalPluginProviderEnvContext;
  allowedPluginIds?: ReadonlySet<string>;
}): Promise<HostDaemonContributedEnvEntry[]> {
  const active = contributions;
  if (!active?.resolveProviderEnv) return [];
  return (await active.resolveProviderEnv(args)).entries
    .filter((entry) =>
      "plugin" in entry.source
        ? pluginAllowed(args.allowedPluginIds, entry.source.plugin)
        : true,
    )
    .map((entry) => ({
      name: entry.name,
      value: entry.value,
      source: entry.source,
      reason: entry.reason,
    }));
}

export async function resolvePluginProviderEnvHealth(args: {
  providerId: string;
  hostId: string;
  allowedPluginIds?: ReadonlySet<string>;
}) {
  const active = contributions;
  if (!active?.resolveProviderEnvHealth) return null;
  return active.resolveProviderEnvHealth({
    providerId: args.providerId,
    context: {
      hostId: args.hostId,
    },
    allowedPluginIds: args.allowedPluginIds,
  });
}

export function findPluginAgentTool(
  name: string,
  allowedPluginIds?: ReadonlySet<string>,
): { pluginId: string; record: PluginAgentToolRecord } | undefined {
  const tool = contributions?.findAgentTool(name);
  return tool !== undefined && pluginAllowed(allowedPluginIds, tool.pluginId)
    ? tool
    : undefined;
}

export async function resolvePluginMention(args: {
  pluginId: string;
  itemId: string;
}): Promise<PluginMentionResolveResult> {
  const active = contributions;
  if (!active) {
    return {
      ok: false,
      error: "plugin mention resolution is unavailable on this server",
    };
  }
  return active.resolveMention(args);
}

export async function invokePluginAgentTool(
  tool: { pluginId: string; record: PluginAgentToolRecord },
  args: { input: unknown; ctx: PluginAgentToolContext },
): Promise<ToolCallResponse> {
  const active = contributions;
  if (!active) {
    return {
      success: false,
      contentItems: [
        { type: "inputText", text: `Unsupported tool: ${tool.record.name}` },
      ],
    };
  }
  return active.invokeAgentTool({
    pluginId: tool.pluginId,
    record: tool.record,
    input: args.input,
    ctx: args.ctx,
  });
}
