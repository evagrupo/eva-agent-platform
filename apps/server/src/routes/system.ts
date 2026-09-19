import {
  setMachineEnvironmentVariable,
  deleteMachineEnvironmentVariable,
} from "../services/machines/environment-storage.js";
import {
  machineEnvironmentView,
  replaceMachineEnvironment,
} from "../services/machines/environment-settings.js";
import { getGateAuthKind } from "../request-context.js";
import { serverAccessStatus } from "../services/machines/server-access.js";
import {
  getAppSettings,
  getAppKeybindingOverrides,
  getExperiments,
  getStoredFaviconColor,
  getStoredThemeId,
  hasActiveThreadAttention,
  setAppSettings,
  setAppKeybindingOverrides,
  setExperiments,
  setStoredAppearance,
} from "@bb/db";
import {
  applyAppKeybindingOverrides,
  appSettingsSchema,
  customThemeNameSchema,
  isBuiltInThemeId,
  PERSONAL_PROJECT_ID,
  resolveCodeTheme,
  type AppKeybindingOverrides,
  type AppTheme,
} from "@bb/domain";
import {
  publicApiRoutes,
  typedRoutes,
  type PublicApiSchema,
  type SystemEnvironmentProvider,
} from "@bb/server-contract";
import type { Hono } from "hono";
import {
  hashedAssetCacheControl,
  pluginImageResponse,
} from "./plugin-image-response.js";
import { effectivePort } from "../browser-request-guard.js";
import {
  getEnvironmentProvider,
  listEnvironmentCompositions,
  listEnvironmentProviders,
} from "../services/plugins/plugin-environment-provider-registry.js";
import {
  getMachineProvider,
  listMachineProviders,
} from "../services/plugins/plugin-machine-provider-registry.js";
import type { ServerAppDeps, ServerRuntimeConfig } from "../types.js";
import type { PluginService } from "../services/plugins/plugin-service.js";
import { ApiError } from "../errors.js";
import {
  resolveVoiceTranscriptionEnabled,
  transcribeVoiceInput,
} from "../services/ai/voice-transcription.js";
import {
  listSystemProviderInfos,
  resolveSystemExecutionOptions,
} from "../services/system/execution-options.js";
import { getProviderStates } from "../services/system/provider-states.js";
import { getProviderUsageLimits } from "../services/system/usage-limits.js";
import {
  listCustomThemeNames,
  readCustomThemeCss,
  resolveAppTheme,
  resolveCustomThemeCssPath,
  resolveThemeRootPath,
} from "../services/system/custom-themes.js";
import {
  installGlobalCliSkills,
  listInstallableMachineIds,
  readGlobalCliSkillStatus,
} from "../services/skills/global-skill-install.js";
import { DEFAULT_APP_KEYBINDINGS } from "../services/system/app-keybindings.js";
import { resolvePrimaryHostId } from "../services/hosts/primary-host.js";
import {
  environmentProviderMatchesContext,
  environmentProviderAcceptsEmptyInputs,
} from "../services/environments/provider-availability.js";
import { environmentProviderMachineAvailability } from "../services/environments/provider-machine-availability.js";
import { machineProviderAcceptsEmptyInputs } from "../services/machines/provider-availability.js";
import { requirePublicProject } from "../services/lib/entity-lookup.js";
import {
  assertCoreCapability,
  assertResourceAccess,
  canAccessResource,
  isAgentAllowedByPolicy,
  isModelAllowedByPolicyForAgent,
  isProviderAllowedByPolicy,
  isProviderAllowedByPolicyForAgent,
  permissionCeilingForPolicyForAgent,
  reasoningLevelsAllowedByPolicyForAgent,
  getCoreAuthContext,
  isPluginAllowedByPolicy,
  allowedPluginIdsForContext,
} from "../access-policy.js";
import type { AvailableModel, PermissionMode } from "@bb/domain";

const LEADING_ENVIRONMENT_PROVIDER_IDS: readonly string[] = [
  "project-checkout",
  "git-worktree",
];

const permissionModeRank: Record<PermissionMode, number> = {
  "accept-edits": 0,
  auto: 1,
  full: 2,
};

function lowerPermissionMode(
  left: PermissionMode,
  right: PermissionMode,
): PermissionMode {
  return permissionModeRank[left] <= permissionModeRank[right] ? left : right;
}

interface SystemConfigRequest {
  url: string;
  header(name: string): string | undefined;
}

function firstForwardedValue(value: string | undefined): string | undefined {
  return value?.split(",", 1)[0]?.trim() || undefined;
}

function providerLogoUrl(
  kind: "environment" | "machine",
  id: string,
  hash: string,
): string {
  return `/api/v1/system/providers/${encodeURIComponent(`${kind}:${id}`)}/logo?h=${hash}`;
}

function resolveSystemServerUrl(
  request: SystemConfigRequest,
  config: Pick<
    ServerRuntimeConfig,
    "appUrl" | "devAppPort" | "isDevelopment" | "serverPort"
  >,
): string {
  if (config.appUrl !== undefined) return config.appUrl.replace(/\/+$/u, "");

  const requestUrl = new URL(request.url);
  const forwardedHost = firstForwardedValue(request.header("x-forwarded-host"));
  if (forwardedHost === undefined) return requestUrl.origin;

  const forwardedProtocol =
    firstForwardedValue(request.header("x-forwarded-proto")) ??
    requestUrl.protocol.replace(/:$/u, "");
  const forwardedUrl = new URL(`${forwardedProtocol}://${forwardedHost}`);
  if (
    config.isDevelopment &&
    config.devAppPort !== undefined &&
    effectivePort(forwardedUrl) === config.devAppPort
  ) {
    forwardedUrl.port = String(config.serverPort);
  }
  return forwardedUrl.origin;
}

export function registerSystemRoutes(
  app: Hono,
  deps: ServerAppDeps,
  pluginService: PluginService,
): void {
  const { get, post, put, del } = typedRoutes<PublicApiSchema>(app, {
    onValidationError: (msg) => new ApiError(400, "invalid_request", msg),
  });
  const routes = publicApiRoutes.system;

  const themeRoot = resolveThemeRootPath(deps.config.dataDir);

  function pluginVisible(context: object, pluginId: string): boolean {
    const authContext = getCoreAuthContext(context);
    return (
      authContext === null ||
      isPluginAllowedByPolicy(authContext.policy, pluginId)
    );
  }

  function requireAdministratorForMutation(context: object): void {
    const authContext = getCoreAuthContext(context);
    if (authContext !== null && authContext.role !== "admin") {
      throw new ApiError(403, "policy_denied", "Administrator access required");
    }
  }

  function providerVisible(
    context: object,
    providerId: string,
    agentId?: string,
  ): boolean {
    const authContext = getCoreAuthContext(context);
    if (authContext === null) return true;
    const registration = deps.providerRegistry.get(providerId);
    if (
      registration !== null &&
      !pluginVisible(context, registration.pluginId)
    ) {
      return false;
    }
    if (agentId !== undefined) {
      return isProviderAllowedByPolicyForAgent(
        authContext.policy,
        agentId,
        providerId,
        authContext.evaAgents === undefined
          ? undefined
          : new Set(authContext.evaAgents.map((agent) => agent.id)),
        authContext.evaAgentProviderIds,
      );
    }
    if (authContext.policy.agentExecutionTuples !== undefined) {
      return authContext.role === "admin";
    }
    return isProviderAllowedByPolicy(authContext.policy, providerId);
  }

  function requireExecutionAgent(
    context: object,
    agentId: string | undefined,
  ): string | undefined {
    const authContext = getCoreAuthContext(context);
    if (authContext === null) return agentId;
    if (agentId === undefined) {
      throw new ApiError(
        403,
        "policy_denied",
        "Execution options require an explicit agent selection",
      );
    }
    if (
      !isAgentAllowedByPolicy(
        authContext.policy,
        agentId,
        authContext.evaAgents === undefined
          ? undefined
          : new Set(authContext.evaAgents.map((agent) => agent.id)),
      )
    ) {
      throw new ApiError(
        403,
        "policy_denied",
        "Agent is not available under your policy",
      );
    }
    return agentId;
  }

  function filterModelForAgent(
    model: AvailableModel,
    policy: NonNullable<ReturnType<typeof getCoreAuthContext>>["policy"],
    agentId: string,
    providerId: string,
    knownAgentIds?: ReadonlySet<string>,
    agentProviderIds?: ReadonlyMap<string, readonly string[]>,
  ): AvailableModel | null {
    if (
      !isModelAllowedByPolicyForAgent(
        policy,
        agentId,
        providerId,
        model.model,
        knownAgentIds,
        agentProviderIds,
      )
    ) {
      return null;
    }
    const allowedReasoningLevels = reasoningLevelsAllowedByPolicyForAgent(
      policy,
      agentId,
      providerId,
      model.model,
      knownAgentIds,
      agentProviderIds,
    );
    const allowedReasoning = new Set(allowedReasoningLevels);
    const supportedReasoningEfforts = model.supportedReasoningEfforts.filter(
      (effort) => allowedReasoning.has(effort.reasoningEffort),
    );
    if (supportedReasoningEfforts.length === 0) return null;
    const defaultReasoningEffort = allowedReasoning.has(
      model.defaultReasoningEffort,
    )
      ? model.defaultReasoningEffort
      : supportedReasoningEfforts[0]!.reasoningEffort;
    return {
      ...model,
      supportedReasoningEfforts,
      defaultReasoningEffort,
    };
  }

  function filterExecutionOptionsResponse(
    context: object,
    query: { agentId?: string; providerId?: string },
    result: Awaited<ReturnType<typeof resolveSystemExecutionOptions>>,
  ) {
    const authContext = getCoreAuthContext(context);
    if (authContext === null) return result;
    const agentId = requireExecutionAgent(context, query.agentId)!;
    const providers = result.providers.filter((provider) =>
      providerVisible(context, provider.id, agentId),
    );
    if (query.providerId === undefined) {
      return {
        ...result,
        providers,
        models: [],
        selectedOnlyModels: [],
      };
    }
    const allowedProvider = providerVisible(context, query.providerId, agentId);
    if (!allowedProvider) {
      throw new ApiError(
        403,
        "policy_denied",
        "Provider is not available for the selected EVA agent",
      );
    }
    const models = result.models
      .map((model) =>
        filterModelForAgent(
          model,
          authContext.policy,
          agentId,
          query.providerId!,
          authContext.evaAgents === undefined
            ? undefined
            : new Set(authContext.evaAgents.map((agent) => agent.id)),
          authContext.evaAgentProviderIds,
        ),
      )
      .filter((model): model is AvailableModel => model !== null);
    const selectedOnlyModels = result.selectedOnlyModels
      .map((model) =>
        filterModelForAgent(
          model,
          authContext.policy,
          agentId,
          query.providerId!,
          authContext.evaAgents === undefined
            ? undefined
            : new Set(authContext.evaAgents.map((agent) => agent.id)),
          authContext.evaAgentProviderIds,
        ),
      )
      .filter((model): model is AvailableModel => model !== null);
    const permissionCeiling = permissionCeilingForPolicyForAgent(
      authContext.policy,
      agentId,
      query.providerId,
      authContext.evaAgents === undefined
        ? undefined
        : new Set(authContext.evaAgents.map((agent) => agent.id)),
      authContext.evaAgentProviderIds,
    );
    if (permissionCeiling === null) {
      throw new ApiError(
        403,
        "policy_denied",
        "Execution is not available under your policy",
      );
    }
    return {
      ...result,
      providers,
      models,
      selectedOnlyModels,
      permissionCeiling: lowerPermissionMode(
        result.permissionCeiling,
        permissionCeiling,
      ),
    };
  }

  get(routes.attention, (context) =>
    context.json({ hasAttention: hasActiveThreadAttention(deps.db) }),
  );

  function readAppKeybindingOverrides(): AppKeybindingOverrides {
    try {
      return getAppKeybindingOverrides(deps.db);
    } catch (error) {
      deps.logger.error(
        { err: error },
        "Stored keyboard shortcut overrides are invalid; using defaults",
      );
      return [];
    }
  }

  async function resolveSelectedTheme(
    themeId: string,
    faviconColor: AppTheme["faviconColor"],
    context: object,
  ): Promise<AppTheme> {
    const pluginTheme = themeId.match(/^plugin:([^:]+):/u);
    if (pluginTheme !== null && !pluginVisible(context, pluginTheme[1]!)) {
      throw new ApiError(
        403,
        "policy_denied",
        "Theme is not available under your policy",
      );
    }
    const pluginCss = await pluginService.readThemeCss(themeId);
    if (pluginCss !== null) {
      return {
        themeId,
        customCss: pluginCss,
        faviconColor,
        resolvedCodeTheme: resolveCodeTheme(
          pluginService.readThemeCodeTheme(themeId),
          themeId,
        ),
      };
    }
    return resolveAppTheme(themeRoot, themeId, faviconColor);
  }

  async function buildSystemConfigResponse(serverUrl: string, context: object) {
    const keybindingOverrides = readAppKeybindingOverrides();
    const resolvedPrimaryHostId = resolvePrimaryHostId(deps);
    const primaryHostId =
      resolvedPrimaryHostId !== null &&
      canAccessResource(
        deps.db,
        getCoreAuthContext(context),
        "host",
        resolvedPrimaryHostId,
      )
        ? resolvedPrimaryHostId
        : null;
    const localHelperPorts = [
      ...new Set([
        deps.config.hostDaemonPort,
        ...deps.hub.listDaemonLocalApiPorts(),
      ]),
    ];
    return {
      generalSettings: compatibleGeneralSettings(),
      serverAccess: await serverAccessStatus(deps),
      keybindings: applyAppKeybindingOverrides(
        DEFAULT_APP_KEYBINDINGS,
        keybindingOverrides,
      ),
      defaultKeybindings: DEFAULT_APP_KEYBINDINGS,
      keybindingOverrides,
      experiments: getExperiments(deps.db),
      appearance: await resolveSelectedTheme(
        getStoredThemeId(deps.db),
        getStoredFaviconColor(deps.db),
        context,
      ),
      customThemes: listCustomThemeNames(themeRoot),
      pluginThemes: pluginService
        .listThemes()
        .filter((theme) => pluginVisible(context, theme.pluginId)),
      featureFlags: deps.config.featureFlags,
      hostDaemonPort: deps.config.hostDaemonPort,
      localHelperPorts,
      serverUrl,
      primaryHostId,
      primaryHostPlatform:
        primaryHostId === null
          ? null
          : deps.hub.getDaemonPlatformForHost(primaryHostId),
      voiceTranscriptionEnabled: resolveVoiceTranscriptionEnabled(deps),
      aiServices: {
        inference: deps.config.inferenceModel,
        inferenceFallback: deps.config.inferenceFallbackModel,
        transcription: deps.config.transcriptionModel,
        services: deps.aiServices
          .list()
          .filter((service) => pluginVisible(context, service.pluginId))
          .map((service) => ({
            id: service.id,
            displayName: service.displayName,
            kinds: [...service.kinds],
            pluginId: service.pluginId,
          })),
      },
      dataDir: "",
    };
  }

  get(routes.config, async (context) => {
    const serverUrl = resolveSystemServerUrl(context.req, deps.config);
    return context.json(await buildSystemConfigResponse(serverUrl, context));
  });

  function compatibleGeneralSettings() {
    const settings = getAppSettings(deps.db);
    return {
      ...settings,
      showUnhandledProviderEvents: settings.showDiagnosticEvents,
    };
  }
  post(routes.setMachineEnvironmentVariable, async (context, payload) => {
    assertCoreCapability(context, "settings");
    requireAdministratorForMutation(context);
    if (getGateAuthKind(context) === "machine")
      throw new ApiError(
        403,
        "forbidden",
        "Machine credentials cannot change global environment settings",
      );
    await setMachineEnvironmentVariable(
      deps.db,
      deps.config.dataDir,
      payload,
      null,
    );
    deps.lifecycleDedupers.providerModelCatalogs.markAllStale();
    deps.hub.notifySystem(["config-changed"]);
    return context.json(
      await machineEnvironmentView(deps.db, deps.config.dataDir),
    );
  });

  del(routes.deleteMachineEnvironmentVariable, async (context, payload) => {
    assertCoreCapability(context, "settings");
    requireAdministratorForMutation(context);
    if (getGateAuthKind(context) === "machine")
      throw new ApiError(
        403,
        "forbidden",
        "Machine credentials cannot change global environment settings",
      );
    await deleteMachineEnvironmentVariable(deps.db, payload.name, null);
    deps.lifecycleDedupers.providerModelCatalogs.markAllStale();
    deps.hub.notifySystem(["config-changed"]);
    return context.json(
      await machineEnvironmentView(deps.db, deps.config.dataDir),
    );
  });

  get(routes.machineEnvironment, async (context) => {
    assertCoreCapability(context, "settings");
    return context.json(
      await machineEnvironmentView(deps.db, deps.config.dataDir),
    );
  });
  put(routes.replaceMachineEnvironment, async (context, payload) => {
    assertCoreCapability(context, "settings");
    requireAdministratorForMutation(context);
    if (getGateAuthKind(context) === "machine")
      throw new ApiError(
        403,
        "forbidden",
        "Machine credentials cannot change global environment settings",
      );
    await replaceMachineEnvironment(deps.db, deps.config.dataDir, payload);
    deps.lifecycleDedupers.providerModelCatalogs.markAllStale();
    deps.hub.notifySystem(["config-changed"]);
    return context.json(
      await machineEnvironmentView(deps.db, deps.config.dataDir),
    );
  });

  put(routes.generalSettings, (context, payload) => {
    assertCoreCapability(context, "settings");
    requireAdministratorForMutation(context);
    const { showUnhandledProviderEvents, ...settings } = payload;
    const current = getAppSettings(deps.db);
    const diagnosticValue =
      "showDiagnosticEvents" in settings
        ? settings.showDiagnosticEvents
        : undefined;
    const updatedSettings = appSettingsSchema.parse({
      ...settings,
      telemetryEnabled: settings.telemetryEnabled ?? current.telemetryEnabled,
      showDiagnosticEvents:
        diagnosticValue === undefined ||
        (showUnhandledProviderEvents !== undefined &&
          diagnosticValue === current.showDiagnosticEvents)
          ? showUnhandledProviderEvents
          : diagnosticValue,
    });
    setAppSettings(deps.db, updatedSettings);
    deps.telemetry.setEnabled(updatedSettings.telemetryEnabled);
    deps.hub.notifySystem(["config-changed"]);
    return context.json(compatibleGeneralSettings());
  });

  put(routes.keyboardSettings, (context, payload) => {
    assertCoreCapability(context, "settings");
    requireAdministratorForMutation(context);
    setAppKeybindingOverrides(deps.db, payload);
    deps.hub.notifySystem(["config-changed"]);
    return context.json(getAppKeybindingOverrides(deps.db));
  });

  put(routes.experiments, (context, payload) => {
    assertCoreCapability(context, "settings");
    requireAdministratorForMutation(context);
    setExperiments(deps.db, { ...getExperiments(deps.db), ...payload });
    deps.hub.notifySystem(["config-changed"]);
    return context.json(getExperiments(deps.db));
  });

  async function requireKnownTheme(themeId: string): Promise<void> {
    if (isBuiltInThemeId(themeId)) return;
    if ((await pluginService.readThemeCss(themeId)) !== null) return;
    if (!customThemeNameSchema.safeParse(themeId).success) {
      throw new ApiError(
        400,
        "invalid_request",
        `Invalid theme id '${themeId}'.`,
      );
    }
    if (readCustomThemeCss(themeRoot, themeId) === null) {
      throw new ApiError(
        404,
        "theme_not_found",
        `Custom theme '${themeId}' not found. Create ${resolveCustomThemeCssPath(themeRoot, themeId)} first.`,
      );
    }
  }

  put(routes.appearance, async (context, payload) => {
    assertCoreCapability(context, "settings");
    requireAdministratorForMutation(context);
    const { themeId, faviconColor } = payload;
    await requireKnownTheme(themeId);
    setStoredAppearance(deps.db, { themeId, faviconColor });
    deps.hub.notifySystem(["config-changed"]);
    return context.json(
      await resolveSelectedTheme(themeId, faviconColor, context),
    );
  });

  get(routes.resolveTheme, async (context) => {
    assertCoreCapability(context, "settings");
    const themeId = context.req.param("id");
    await requireKnownTheme(themeId);
    return context.json(
      await resolveSelectedTheme(
        themeId,
        getStoredFaviconColor(deps.db),
        context,
      ),
    );
  });

  get(routes.themes, async (context) => {
    assertCoreCapability(context, "settings");
    return context.json({
      dir: themeRoot,
      custom: listCustomThemeNames(themeRoot),
      plugins: pluginService
        .listThemes()
        .filter((theme) => pluginVisible(context, theme.pluginId)),
      active: await resolveSelectedTheme(
        getStoredThemeId(deps.db),
        getStoredFaviconColor(deps.db),
        context,
      ),
    });
  });

  post(routes.reloadConfig, async (context) => {
    assertCoreCapability(context, "settings");
    requireAdministratorForMutation(context);
    try {
      await deps.bbAppManagedConfig.reload({ notify: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ApiError(422, "invalid_config", message);
    }
    return context.json({ ok: true });
  });

  get(routes.cliSkillsStatus, async (context, query) => {
    assertCoreCapability(context, "settings");
    requireAdministratorForMutation(context);
    return context.json(
      await readGlobalCliSkillStatus(deps, {
        hostIds:
          query.hostIds === undefined
            ? listInstallableMachineIds(deps)
            : query.hostIds.split(",").filter((hostId) => hostId.length > 0),
      }),
    );
  });

  post(routes.installCliSkills, async (context, body) => {
    assertCoreCapability(context, "settings");
    requireAdministratorForMutation(context);
    return context.json(
      await installGlobalCliSkills(deps, { hostIds: body.hostIds }),
    );
  });

  get(routes.environmentProviders, async (context, query) => {
    assertCoreCapability(context, "environments");
    const project =
      query.projectId === undefined
        ? null
        : requirePublicProject(deps.db, query.projectId);
    if (project !== null) {
      assertResourceAccess(deps.db, context, "project", project.id, "read");
    }
    if (query.hostId !== undefined) {
      assertResourceAccess(deps.db, context, "host", query.hostId, "read");
    }
    return context.json({
      providers: (
        await Promise.all(
          listEnvironmentProviders()
            .filter(
              (record) =>
                pluginVisible(context, record.pluginId) &&
                (project === null ||
                  record.provider.requires.projectless ===
                    (project.id === PERSONAL_PROJECT_ID)),
            )
            .sort((left, right) => {
              const leftIndex = LEADING_ENVIRONMENT_PROVIDER_IDS.indexOf(
                left.provider.id,
              );
              const rightIndex = LEADING_ENVIRONMENT_PROVIDER_IDS.indexOf(
                right.provider.id,
              );
              if (leftIndex !== -1 || rightIndex !== -1) {
                if (leftIndex === -1) return 1;
                if (rightIndex === -1) return -1;
                return leftIndex - rightIndex;
              }
              return (
                left.provider.displayName.localeCompare(
                  right.provider.displayName,
                ) || left.provider.id.localeCompare(right.provider.id)
              );
            })
            .map(async (record): Promise<SystemEnvironmentProvider | null> => {
              if (
                query.projectId !== undefined &&
                !environmentProviderMatchesContext(deps, record, {
                  projectId: query.projectId,
                  ...(query.hostId === undefined
                    ? {}
                    : { hostId: query.hostId }),
                })
              ) {
                return null;
              }
              const machineAvailability =
                query.projectId === undefined
                  ? {}
                  : environmentProviderMachineAvailability(deps, record, {
                      projectId: query.projectId,
                      ...(query.hostId === undefined
                        ? {}
                        : { hostId: query.hostId }),
                    });
              return {
                machineProviderId: null,
                id: record.provider.id,
                displayName: record.provider.displayName,
                description: record.provider.description,
                icon: record.provider.icon,
                logoUrl:
                  record.icon === undefined
                    ? null
                    : providerLogoUrl(
                        "environment",
                        record.provider.id,
                        record.icon.hash,
                      ),
                pluginId: record.pluginId,
                requires: record.provider.requires,
                inputs: record.provider.inputsJsonSchema,
                acceptsEmptyInputs:
                  await environmentProviderAcceptsEmptyInputs(record),
                availability:
                  query.hostId === undefined
                    ? null
                    : (machineAvailability[query.hostId] ?? null),
                machineAvailability,
              };
            }),
        )
      )
        .filter((provider) => provider !== null)
        .concat(
          query.hostId !== undefined
            ? []
            : (
                await Promise.all(
                  listEnvironmentCompositions()
                    .filter(({ pluginId }) => pluginVisible(context, pluginId))
                    .map(async ({ pluginId, composition, icon }) => {
                      const record = getEnvironmentProvider(
                        composition.environmentProviderId,
                      );
                      const machine = getMachineProvider(
                        composition.machineProviderId,
                      );
                      if (!record || !machine) return null;
                      if (
                        project !== null &&
                        (record.provider.requires.projectCheckout ||
                          record.provider.requires.gitRemote) &&
                        project.gitRemoteUrl === null
                      )
                        return null;
                      if (
                        project !== null &&
                        record.provider.requires.projectless !==
                          (project.id === PERSONAL_PROJECT_ID)
                      )
                        return null;
                      return {
                        id: composition.id,
                        displayName: composition.displayName,
                        description: composition.description,
                        icon: composition.icon ?? "FolderUnknown",
                        logoUrl:
                          icon === undefined
                            ? null
                            : providerLogoUrl(
                                "environment",
                                composition.id,
                                icon.hash,
                              ),
                        pluginId,
                        machineProviderId: composition.machineProviderId,
                        environmentProviderId:
                          composition.environmentProviderId,
                        requires: record.provider.requires,
                        inputs: record.provider.inputsJsonSchema,
                        acceptsEmptyInputs:
                          await environmentProviderAcceptsEmptyInputs(record),
                        machineInputs: machine.provider.inputsJsonSchema,
                        machineAcceptsEmptyInputs:
                          await machineProviderAcceptsEmptyInputs(machine),
                        machineProviderPluginId: machine.pluginId,
                        availability: null,
                        machineAvailability: {},
                      };
                    }),
                )
              ).filter((provider) => provider !== null),
        ),
    });
  });

  get(routes.machineProviders, async (context) => {
    assertCoreCapability(context, "hosts");
    return context.json({
      providers: await Promise.all(
        listMachineProviders()
          .filter((record) => pluginVisible(context, record.pluginId))
          .map(async (record) => ({
            id: record.provider.id,
            displayName: record.provider.displayName,
            description: record.provider.description,
            icon: record.provider.icon,
            logoUrl:
              record.icon === undefined
                ? null
                : providerLogoUrl(
                    "machine",
                    record.provider.id,
                    record.icon.hash,
                  ),
            pluginId: record.pluginId,
            inputs: record.provider.inputsJsonSchema,
            acceptsEmptyInputs: await machineProviderAcceptsEmptyInputs(record),
            supportsSuspend: record.provider.suspend !== null,
          })),
      ),
    });
  });

  get(routes.providers, async (context, query) =>
    context.json(
      (await listSystemProviderInfos(deps, query)).filter((provider) =>
        providerVisible(context, provider.id, query.agentId),
      ),
    ),
  );

  get(routes.providerLogo, async (context) => {
    const providerId = context.req.param("id");
    if (!providerVisible(context, providerId)) {
      throw new ApiError(
        403,
        "policy_denied",
        "Provider is not available under your policy",
      );
    }
    const registration = providerId.startsWith("environment:")
      ? (getEnvironmentProvider(providerId.slice("environment:".length)) ??
        listEnvironmentCompositions().find(
          (record) =>
            record.composition.id === providerId.slice("environment:".length),
        ))
      : providerId.startsWith("machine:")
        ? getMachineProvider(providerId.slice("machine:".length))
        : deps.providerRegistry.get(providerId);
    if (registration?.icon !== undefined) {
      return pluginImageResponse(
        context,
        registration.icon,
        hashedAssetCacheControl(context.req.query("h"), registration.icon.hash),
      );
    }
    throw new ApiError(
      404,
      "provider_logo_not_found",
      `Provider '${providerId}' has no logo.`,
    );
  });

  get(routes.providerStates, async (context, query) => {
    assertCoreCapability(context, "hosts");
    const result = await getProviderStates(
      deps,
      query,
      (provider) => providerVisible(context, provider.id, query.agentId),
      allowedPluginIdsForContext(context, query.agentId),
    );
    return context.json({
      providers: result.providers,
    });
  });

  get(routes.usageLimits, async (context, query) => {
    assertCoreCapability(context, "settings");
    if (
      query.providerId !== undefined &&
      !providerVisible(context, query.providerId)
    ) {
      throw new ApiError(
        403,
        "policy_denied",
        "Provider usage is not available under your policy",
      );
    }
    return context.json(
      await getProviderUsageLimits(deps, query, (provider) =>
        providerVisible(context, provider.id),
      ),
    );
  });

  get(routes.executionOptions, async (context, query) => {
    const result = await resolveSystemExecutionOptions(deps, query);
    return context.json(filterExecutionOptionsResponse(context, query, result));
  });

  post(routes.voiceTranscription, async (context) => {
    const formData = await context.req.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      throw new ApiError(400, "invalid_request", "Audio file is required");
    }
    return context.json({
      text: await transcribeVoiceInput(deps, {
        file,
        prompt:
          typeof formData.get("prompt") === "string"
            ? String(formData.get("prompt"))
            : undefined,
      }),
    });
  });

  get(routes.version, async (context, query) =>
    context.json(
      await deps.appVersion.getSystemVersion({
        forceRefresh: query.force === "true",
      }),
    ),
  );
}
