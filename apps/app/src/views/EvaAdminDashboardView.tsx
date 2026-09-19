import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { Link } from "react-router-dom";
import { Button } from "@bb/shared-ui/button";
import { Input } from "@bb/shared-ui/input";
import {
  coreCapabilityNames,
  useCoreAuth,
  type CoreCapabilities,
} from "@/lib/core-auth";

type Role = "admin" | "user";
type Status = "active" | "revoked" | "disabled";
type Scope = "global" | "role" | "user" | "agent";
type ResourceType = "project" | "host" | "environment";
type PermissionMode = "accept-edits" | "auto" | "full";
type ReasoningLevel =
  | "none"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "ultracode"
  | "max"
  | "ultra";
type TerminalAccess = "none" | "read" | "controlled" | "full";

interface ManagedUser {
  id: string;
  email: string;
  name: string;
  emailVerified?: boolean;
  role: Role;
  status: Status;
  policyId: string;
  defaultAgentId: string | null;
  policyRevision?: number;
}

interface PolicyRecord {
  allowedAgentIds: string[];
  allowedProviderIds: string[];
  allowedModelPatterns: string[];
  allowedReasoningLevels: ReasoningLevel[];
  defaultProviderId: string | null;
  defaultModel: string | null;
  defaultReasoningLevel: ReasoningLevel | null;
  defaultPermissionMode: PermissionMode | null;
  fixedExecution: boolean;
  maxPermissionMode: PermissionMode;
  terminalAccess: TerminalAccess;
  allowedToolIds: string[];
  allowedPluginIds: string[];
  allowThreadReadOwn: boolean;
  allowThreadReadAll: boolean;
  allowThreadWrite: boolean;
  allowBootstrap: boolean;
  allowPluginData: boolean;
  capabilities: CoreCapabilities;
}

interface ManagedPolicy {
  id: string;
  role: Role;
  policy: PolicyRecord;
  revision?: number;
  updatedAt?: number;
}

interface ManagedGroup {
  id: string;
  name: string;
  policyId: string;
  memberCount: number;
}

interface ManagedInstruction {
  id: string;
  scope: Scope;
  role: Role | null;
  userId: string | null;
  agentId: string | null;
  content: string;
  enabled: boolean;
}

interface ManagedGrant {
  id: string;
  userId: string | null;
  groupId: string | null;
  agentId: string;
  providerIds: string[];
  modelPatterns: string[];
  reasoningLevels: ReasoningLevel[];
  fixedExecution: boolean;
  permissionMode: PermissionMode | null;
  terminalAccess: TerminalAccess;
  toolIds: string[];
  pluginIds: string[];
}

interface ManagedResourceAccess {
  id: string;
  resourceType: ResourceType;
  resourceId: string;
  userId: string | null;
  groupId: string | null;
  canRead: boolean;
  canWrite: boolean;
}

interface CatalogAgent {
  id: string;
  displayName: string;
  description: string;
  providerIds: string[];
  defaultProviderId: string | null;
  defaultModel: string;
  defaultReasoningLevel: ReasoningLevel;
  defaultPermissionMode: PermissionMode;
  reasoningLevels: ReasoningLevel[];
  permissionModes: PermissionMode[];
  status: "draft";
}

interface CatalogProvider {
  id: string;
  displayName: string;
  modelIds: string[];
  reasoningLevels: ReasoningLevel[];
  permissionModes: PermissionMode[];
}

interface CatalogConnector {
  id: string;
  displayName: string;
  category: string;
  status: "manifest-only";
  executable: false;
}

interface CatalogPlugin {
  id: string;
  name: string;
  version: string;
  status: string;
  enabled: boolean;
}

interface CatalogTool {
  id: string;
  pluginId: string;
  displayName: string;
  description: string;
}

interface AdminCatalog {
  defaults: {
    providerId: string;
    model: string;
    reasoningLevel: ReasoningLevel;
    permissionMode: PermissionMode;
  };
  registeredProviderIds: string[];
  plugins: CatalogPlugin[];
  tools: CatalogTool[];
  providers: CatalogProvider[];
  connectors: CatalogConnector[];
  agents: CatalogAgent[];
}

interface AuditEvent {
  id: string;
  actorUserId: string | null;
  targetUserId: string | null;
  eventType: string;
  createdAt: number;
}

interface AdminData {
  users: ManagedUser[];
  policies: ManagedPolicy[];
  groups: ManagedGroup[];
  grants: ManagedGrant[];
  instructions: ManagedInstruction[];
  resourceAccess: ManagedResourceAccess[];
  catalog: AdminCatalog;
  audit: AuditEvent[];
  members: Record<string, string[]>;
}

interface PolicyDraft {
  id: string;
  role: Role;
  agentIds: string[];
  providerIds: string[];
  modelPatterns: string;
  reasoningLevels: ReasoningLevel[];
  defaultProviderId: string;
  defaultModel: string;
  defaultReasoningLevel: ReasoningLevel | "";
  defaultPermissionMode: PermissionMode | "";
  fixedExecution: boolean;
  maxPermissionMode: PermissionMode;
  terminalAccess: TerminalAccess;
  toolIds: string;
  pluginIds: string;
  capabilities: CoreCapabilities;
}

interface GrantDraft {
  id: string;
  targetType: "user" | "group";
  targetId: string;
  agentId: string;
  providerIds: string[];
  modelPatterns: string;
  reasoningLevels: ReasoningLevel[];
  fixedExecution: boolean;
  permissionMode: PermissionMode | "";
  terminalAccess: TerminalAccess;
  toolIds: string;
  pluginIds: string;
}

interface InstructionDraft {
  id: string;
  scope: Scope;
  role: Role;
  userId: string;
  agentId: string;
  content: string;
}

interface ResourceDraft {
  id: string;
  resourceType: ResourceType;
  resourceId: string;
  targetType: "user" | "group";
  targetId: string;
  canRead: boolean;
  canWrite: boolean;
}

const reasoningLevels: ReasoningLevel[] = [
  "none",
  "low",
  "medium",
  "high",
  "xhigh",
  "ultracode",
  "max",
  "ultra",
];
const permissionModes: PermissionMode[] = ["accept-edits", "auto", "full"];
const terminalAccessValues: TerminalAccess[] = [
  "none",
  "read",
  "controlled",
  "full",
];

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    ...init,
    credentials: "include",
    headers: {
      accept: "application/json",
      ...(init?.body === undefined
        ? {}
        : { "content-type": "application/json" }),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    throw new Error(
      response.status === 403
        ? "Administrator access required"
        : "Request could not be completed",
    );
  }
  return (await response.json()) as T;
}

function splitList(value: string): string[] {
  return [
    ...new Set(
      value
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean),
    ),
  ];
}

function optionsWithCurrentValues(
  options: ReadonlyArray<{ value: string; label: string }>,
  value: string,
): Array<{ value: string; label: string }> {
  const known = new Set(options.map((option) => option.value));
  return [
    ...options,
    ...splitList(value)
      .filter((item) => !known.has(item))
      .map((item) => ({ value: item, label: `Existing: ${item}` })),
  ];
}

function emptyCapabilities(): CoreCapabilities {
  return Object.fromEntries(
    coreCapabilityNames.map((capability) => [capability, false]),
  ) as CoreCapabilities;
}

function emptyPolicyDraft(): PolicyDraft {
  return {
    id: "",
    role: "user",
    agentIds: [],
    providerIds: [],
    modelPatterns: "",
    reasoningLevels: [],
    defaultProviderId: "",
    defaultModel: "",
    defaultReasoningLevel: "",
    defaultPermissionMode: "",
    fixedExecution: false,
    maxPermissionMode: "accept-edits",
    terminalAccess: "none",
    toolIds: "",
    pluginIds: "",
    capabilities: emptyCapabilities(),
  };
}

function emptyGrantDraft(catalog?: AdminCatalog): GrantDraft {
  return {
    id: "",
    targetType: "user",
    targetId: "",
    agentId: catalog?.agents[0]?.id ?? "orchestrator",
    providerIds: catalog?.defaults.providerId
      ? [catalog.defaults.providerId]
      : [],
    modelPatterns: catalog?.defaults.model ?? "",
    reasoningLevels: catalog?.defaults.reasoningLevel
      ? [catalog.defaults.reasoningLevel]
      : [],
    fixedExecution: false,
    permissionMode: catalog?.defaults.permissionMode ?? "accept-edits",
    terminalAccess: "none",
    toolIds: "",
    pluginIds: "",
  };
}

function emptyInstructionDraft(): InstructionDraft {
  return {
    id: "",
    scope: "global",
    role: "user",
    userId: "",
    agentId: "",
    content: "",
  };
}

function emptyResourceDraft(): ResourceDraft {
  return {
    id: "",
    resourceType: "project",
    resourceId: "",
    targetType: "user",
    targetId: "",
    canRead: true,
    canWrite: false,
  };
}

function policyFromDraft(draft: PolicyDraft): PolicyRecord {
  return {
    allowedAgentIds: draft.agentIds,
    allowedProviderIds: draft.providerIds,
    allowedModelPatterns: splitList(draft.modelPatterns),
    allowedReasoningLevels: draft.reasoningLevels,
    defaultProviderId: draft.defaultProviderId || null,
    defaultModel: draft.defaultModel || null,
    defaultReasoningLevel: draft.defaultReasoningLevel || null,
    defaultPermissionMode: draft.defaultPermissionMode || null,
    fixedExecution: draft.fixedExecution,
    maxPermissionMode: draft.maxPermissionMode,
    terminalAccess: draft.terminalAccess,
    allowedToolIds: splitList(draft.toolIds),
    allowedPluginIds: splitList(draft.pluginIds),
    allowThreadReadOwn: draft.capabilities.threadOwnRead,
    allowThreadReadAll: draft.capabilities.threadAllRead,
    allowThreadWrite:
      draft.capabilities.threadOwnWrite || draft.capabilities.threadAllWrite,
    allowBootstrap: draft.capabilities.workspaceBootstrap,
    allowPluginData: draft.capabilities.pluginData,
    capabilities: draft.capabilities,
  };
}

function policyToDraft(
  policy: PolicyRecord,
  id: string,
  role: Role,
): PolicyDraft {
  return {
    id,
    role,
    agentIds: policy.allowedAgentIds,
    providerIds: policy.allowedProviderIds,
    modelPatterns: policy.allowedModelPatterns.join(", "),
    reasoningLevels: policy.allowedReasoningLevels,
    defaultProviderId: policy.defaultProviderId ?? "",
    defaultModel: policy.defaultModel ?? "",
    defaultReasoningLevel: policy.defaultReasoningLevel ?? "",
    defaultPermissionMode: policy.defaultPermissionMode ?? "",
    fixedExecution: policy.fixedExecution,
    maxPermissionMode: policy.maxPermissionMode,
    terminalAccess: policy.terminalAccess,
    toolIds: policy.allowedToolIds.join(", "),
    pluginIds: policy.allowedPluginIds.join(", "),
    capabilities: policy.capabilities,
  };
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-5 shadow-sm md:p-6">
      <div className="mb-5">
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  );
}

function Field({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="space-y-2 text-sm" htmlFor={id}>
      <span className="block font-medium">{label}</span>
      {children}
    </label>
  );
}

function SelectField({
  id,
  label,
  value,
  onChange,
  disabled = false,
  children,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <Field id={id} label={label}>
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        {children}
      </select>
    </Field>
  );
}

function CheckGrid({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  selected: readonly string[];
  onChange: (value: string[]) => void;
}) {
  const toggle = (value: string) =>
    onChange(
      selected.includes(value)
        ? selected.filter((item) => item !== value)
        : [...selected, value],
    );
  return (
    <fieldset className="space-y-2 text-sm">
      <legend className="font-medium">{label}</legend>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {options.map((option) => (
          <label className="flex items-center gap-2" key={option.value}>
            <input
              type="checkbox"
              checked={selected.includes(option.value)}
              onChange={() => toggle(option.value)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function DelimitedCheckGrid({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  value: string;
  onChange: (value: string) => void;
}) {
  const selected = splitList(value);
  const toggle = (option: string) => {
    const next = selected.includes(option)
      ? selected.filter((item) => item !== option)
      : option === "*"
        ? ["*"]
        : [...selected.filter((item) => item !== "*"), option];
    onChange(next.join(", "));
  };
  return (
    <fieldset className="space-y-2 text-sm">
      <legend className="font-medium">{label}</legend>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {options.map((option) => (
          <label className="flex items-center gap-2" key={option.value}>
            <input
              type="checkbox"
              checked={selected.includes(option.value)}
              onChange={() => toggle(option.value)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function CapabilityGrid({
  value,
  onChange,
}: {
  value: CoreCapabilities;
  onChange: (value: CoreCapabilities) => void;
}) {
  return (
    <fieldset className="space-y-2 text-sm">
      <legend className="font-medium">Named capabilities</legend>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {coreCapabilityNames.map((capability) => (
          <label className="flex items-start gap-2" key={capability}>
            <input
              type="checkbox"
              checked={value[capability]}
              onChange={(event) =>
                onChange({ ...value, [capability]: event.target.checked })
              }
            />
            <span className="break-words">{capability}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function formatDate(value: number | undefined): string {
  return value === undefined ? "—" : new Date(value).toLocaleString();
}

export function EvaAdminDashboardView() {
  const auth = useCoreAuth();
  const [locale, setLocale] = useState<"en" | "es">("en");
  const [data, setData] = useState<AdminData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [newUser, setNewUser] = useState({
    email: "",
    name: "",
    password: "",
    role: "user" as Role,
    policyId: "user",
    defaultAgentId: null as string | null,
  });
  const [policyDraft, setPolicyDraft] = useState<PolicyDraft>(emptyPolicyDraft);
  const [editingPolicyId, setEditingPolicyId] = useState<string | null>(null);
  const [grantDraft, setGrantDraft] = useState<GrantDraft>(() =>
    emptyGrantDraft(),
  );
  const [editingGrantId, setEditingGrantId] = useState<string | null>(null);
  const [instructionDraft, setInstructionDraft] = useState<InstructionDraft>(
    emptyInstructionDraft,
  );
  const [editingInstructionId, setEditingInstructionId] = useState<
    string | null
  >(null);
  const [resourceDraft, setResourceDraft] =
    useState<ResourceDraft>(emptyResourceDraft);
  const [groupDraft, setGroupDraft] = useState({
    id: "",
    name: "",
    policyId: "user",
  });
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [groupMembers, setGroupMembers] = useState<string[]>([]);
  const [invitation, setInvitation] = useState({
    email: "",
    name: "",
    role: "user" as Role,
    policyId: "user",
    token: "",
  });

  const copy =
    locale === "es"
      ? {
          eyebrow: "Control de acceso EVA",
          title: "Administración segura",
          description:
            "Gestiona identidades, agentes y capacidades desde el servidor.",
          back: "Volver al espacio",
          signOut: "Cerrar sesión",
          loading: "Cargando control de acceso…",
          success: "Cambio guardado.",
          empty: "No hay registros todavía.",
          create: "Crear",
          update: "Actualizar",
          cancel: "Cancelar",
          accounts: "Cuentas",
          groups: "Grupos y membresías",
          policies: "Políticas autorizadas",
          grants: "Permisos por agente",
          resources: "Alcances de recursos",
          instructions: "Instrucciones del servidor",
          invitations: "Invitaciones",
          catalog: "Catálogo EVA",
          audit: "Auditoría",
        }
      : {
          eyebrow: "EVA access control",
          title: "Secure administration",
          description:
            "Manage identities, agents, and capabilities from the server.",
          back: "Back to workspace",
          signOut: "Sign out",
          loading: "Loading access control…",
          success: "Change saved.",
          empty: "No records yet.",
          create: "Create",
          update: "Update",
          cancel: "Cancel",
          accounts: "Accounts",
          groups: "Groups and membership",
          policies: "Authoritative policies",
          grants: "Agent grants",
          resources: "Resource scopes",
          instructions: "Server instructions",
          invitations: "Invitations",
          catalog: "EVA catalog",
          audit: "Audit trail",
        };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [
        users,
        policies,
        groups,
        grants,
        instructions,
        resourceAccess,
        catalog,
        audit,
      ] = await Promise.all([
        requestJson<ManagedUser[]>("/access/users"),
        requestJson<ManagedPolicy[]>("/access/policies"),
        requestJson<ManagedGroup[]>("/access/groups"),
        requestJson<ManagedGrant[]>("/access/grants"),
        requestJson<ManagedInstruction[]>("/access/instructions"),
        requestJson<ManagedResourceAccess[]>("/access/resource-access"),
        requestJson<AdminCatalog>("/access/agents"),
        requestJson<AuditEvent[]>("/access/audit?limit=40"),
      ]);
      const memberEntries = await Promise.all(
        groups.map(
          async (group) =>
            [
              group.id,
              await requestJson<string[]>(
                `/access/groups/${encodeURIComponent(group.id)}/members`,
              ),
            ] as const,
        ),
      );
      setData({
        users,
        policies,
        groups,
        grants,
        instructions,
        resourceAccess,
        catalog,
        audit,
        members: Object.fromEntries(memberEntries),
      });
      setGrantDraft((current) =>
        current.agentId === "orchestrator" && catalog.agents[0]
          ? { ...emptyGrantDraft(catalog), ...current }
          : current,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (auth?.user?.role === "admin") void load();
    else setLoading(false);
  }, [auth?.user?.role, load]);

  const run = async (operation: () => Promise<void>) => {
    setError(null);
    setNotice(null);
    try {
      await operation();
      setNotice(copy.success);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Request failed");
    }
  };

  const policyOptions = useMemo(() => data?.policies ?? [], [data?.policies]);
  const agents = data?.catalog.agents ?? [];
  const providers = data?.catalog.providers ?? [];
  const plugins = data?.catalog.plugins ?? [];
  const tools = data?.catalog.tools ?? [];
  const agentOptions = agents.map((agent) => ({
    value: agent.id,
    label: `${agent.displayName} (${agent.id})`,
  }));
  const defaultAgentOptionsForPolicy = (policyId: string) => {
    const policy = policyOptions.find((candidate) => candidate.id === policyId);
    if (policy === undefined) return [];
    return agents.filter(
      (agent) =>
        policy.policy.allowedAgentIds.includes("*") ||
        policy.policy.allowedAgentIds.includes(agent.id),
    );
  };
  const defaultAgentOptionsForUser = (user: ManagedUser) => {
    const policy = policyOptions.find(
      (candidate) => candidate.id === user.policyId,
    );
    const groupIds = Object.entries(data?.members ?? {})
      .filter(([, memberIds]) => memberIds.includes(user.id))
      .map(([groupId]) => groupId);
    const effectiveGrants = data?.grants.filter(
      (grant) =>
        grant.userId === user.id ||
        (grant.groupId !== null && groupIds.includes(grant.groupId)),
    );
    const allowed = agents.filter(
      (agent) =>
        policy !== undefined &&
        (policy.policy.allowedAgentIds.length === 0 ||
          policy.policy.allowedAgentIds.includes("*") ||
          policy.policy.allowedAgentIds.includes(agent.id)),
    );
    if (effectiveGrants === undefined || effectiveGrants.length === 0) {
      return allowed;
    }
    const counts = new Map<string, number>();
    for (const grant of effectiveGrants) {
      counts.set(grant.agentId, (counts.get(grant.agentId) ?? 0) + 1);
    }
    return allowed.filter((agent) => counts.get(agent.id) === 1);
  };
  const providerOptions = [
    { value: "*", label: "All registered providers" },
    ...providers.map((provider) => ({
      value: provider.id,
      label: `${provider.displayName} (${provider.id})`,
    })),
  ];
  const toolOptions = [
    { value: "*", label: "All registered tools" },
    ...tools.map((tool) => ({
      value: tool.id,
      label: `${tool.displayName} (${tool.pluginId})`,
    })),
  ];
  const pluginOptions = [
    { value: "*", label: "All installed plugins" },
    ...plugins.map((plugin) => ({
      value: plugin.id,
      label: `${plugin.name} (${plugin.id})`,
    })),
  ];
  const modelOptions = [
    ...new Set(
      [
        data?.catalog.defaults.model,
        ...providers.flatMap((provider) => provider.modelIds),
        policyDraft.defaultModel,
        grantDraft.modelPatterns,
      ].filter(Boolean),
    ),
  ];
  const modelOptionsForProviders = (
    providerIds: readonly string[],
    currentValue: string,
  ) => {
    const selectedProviders =
      providerIds.length === 0 || providerIds.includes("*")
        ? providers
        : providers.filter((provider) => providerIds.includes(provider.id));
    return optionsWithCurrentValues(
      [
        ...new Set(selectedProviders.flatMap((provider) => provider.modelIds)),
      ].map((model) => ({ value: model, label: model })),
      currentValue,
    );
  };
  const policyModelOptions = modelOptionsForProviders(
    policyDraft.providerIds,
    policyDraft.modelPatterns,
  );
  const grantModelOptions = modelOptionsForProviders(
    grantDraft.providerIds,
    grantDraft.modelPatterns,
  );
  const selectedAgent = agents.find((agent) => agent.id === grantDraft.agentId);
  const selectedProvider = providers.find((provider) =>
    grantDraft.providerIds.includes(provider.id),
  );
  const setFixedPolicy = (fixedExecution: boolean) => {
    if (!fixedExecution) {
      setPolicyDraft((current) => ({ ...current, fixedExecution }));
      return;
    }
    const providerId = policyDraft.providerIds[0] ?? providers[0]?.id ?? "";
    const model =
      policyDraft.defaultModel ||
      splitList(policyDraft.modelPatterns)[0] ||
      modelOptions[0] ||
      "";
    const reasoningLevel =
      policyDraft.reasoningLevels[0] ?? reasoningLevels[0]!;
    const permissionMode =
      policyDraft.defaultPermissionMode || policyDraft.maxPermissionMode;
    setPolicyDraft((current) => ({
      ...current,
      fixedExecution: true,
      providerIds: providerId ? [providerId] : [],
      modelPatterns: model,
      reasoningLevels: [reasoningLevel],
      defaultProviderId: providerId,
      defaultModel: model,
      defaultReasoningLevel: reasoningLevel,
      defaultPermissionMode: permissionMode,
      maxPermissionMode: permissionMode,
    }));
  };
  const setFixedGrant = (fixedExecution: boolean) => {
    if (!fixedExecution) {
      setGrantDraft((current) => ({ ...current, fixedExecution }));
      return;
    }
    const agent = agents.find((item) => item.id === grantDraft.agentId);
    const providerId = grantDraft.providerIds[0] ?? agent?.providerIds[0] ?? "";
    const model =
      splitList(grantDraft.modelPatterns)[0] ||
      agent?.defaultModel ||
      modelOptions[0] ||
      "";
    const reasoningLevel =
      grantDraft.reasoningLevels[0] ??
      agent?.reasoningLevels[0] ??
      reasoningLevels[0]!;
    setGrantDraft((current) => ({
      ...current,
      fixedExecution: true,
      providerIds: providerId ? [providerId] : [],
      modelPatterns: model,
      reasoningLevels: [reasoningLevel],
      permissionMode:
        current.permissionMode ||
        agent?.defaultPermissionMode ||
        "accept-edits",
    }));
  };

  if (auth?.user?.role !== "admin") {
    return (
      <section className="mx-auto w-full max-w-xl rounded-xl border border-border bg-card p-6 shadow-sm">
        <h1 className="text-lg font-semibold">
          403 · Administrator access required
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This route is protected by the current server policy.
        </p>
        <Button asChild variant="outline" className="mt-5">
          <Link to="/">{copy.back}</Link>
        </Button>
      </section>
    );
  }

  if (loading) {
    return (
      <p className="text-sm text-muted-foreground" role="status">
        {copy.loading}
      </p>
    );
  }

  if (data === null) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-destructive" role="alert">
          {error ?? "The administration data is unavailable."}
        </p>
        <Button onClick={() => void load()}>Try again</Button>
      </div>
    );
  }

  const createUser = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await run(async () => {
      await requestJson("/access/users", {
        method: "POST",
        body: JSON.stringify(newUser),
      });
      setNewUser((current) => ({
        ...current,
        email: "",
        name: "",
        password: "",
        defaultAgentId: null,
      }));
    });
  };

  const savePolicy = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await run(async () => {
      const payload = {
        role: policyDraft.role,
        policy: policyFromDraft(policyDraft),
      };
      if (editingPolicyId === null) {
        await requestJson("/access/policies", {
          method: "POST",
          body: JSON.stringify({ id: policyDraft.id, ...payload }),
        });
      } else {
        await requestJson(
          `/access/policies/${encodeURIComponent(editingPolicyId)}`,
          {
            method: "PATCH",
            body: JSON.stringify(payload),
          },
        );
      }
      setPolicyDraft(emptyPolicyDraft());
      setEditingPolicyId(null);
    });
  };

  const saveGroup = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await run(async () => {
      if (editingGroupId === null) {
        await requestJson("/access/groups", {
          method: "POST",
          body: JSON.stringify(groupDraft),
        });
      } else {
        await requestJson(
          `/access/groups/${encodeURIComponent(editingGroupId)}`,
          {
            method: "PATCH",
            body: JSON.stringify({
              name: groupDraft.name,
              policyId: groupDraft.policyId,
            }),
          },
        );
      }
      const groupId = editingGroupId ?? groupDraft.id;
      await requestJson(
        `/access/groups/${encodeURIComponent(groupId)}/members`,
        {
          method: "PUT",
          body: JSON.stringify({ userIds: groupMembers }),
        },
      );
      setGroupDraft({ id: "", name: "", policyId: "user" });
      setGroupMembers([]);
      setEditingGroupId(null);
    });
  };

  const saveGrant = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await run(async () => {
      if (!grantDraft.targetId) throw new Error("Select a user or group");
      const grantFields = {
        agentId: grantDraft.agentId,
        providerIds: grantDraft.providerIds,
        modelPatterns: splitList(grantDraft.modelPatterns),
        reasoningLevels: grantDraft.reasoningLevels,
        fixedExecution: grantDraft.fixedExecution,
        permissionMode: grantDraft.permissionMode || null,
        terminalAccess: grantDraft.terminalAccess,
        toolIds: splitList(grantDraft.toolIds),
        pluginIds: splitList(grantDraft.pluginIds),
      };
      if (editingGrantId === null) {
        await requestJson("/access/grants", {
          method: "POST",
          body: JSON.stringify({
            id: grantDraft.id,
            ...(grantDraft.targetType === "user"
              ? { userId: grantDraft.targetId }
              : { groupId: grantDraft.targetId }),
            ...grantFields,
          }),
        });
      } else {
        await requestJson(
          `/access/grants/${encodeURIComponent(editingGrantId)}`,
          {
            method: "PATCH",
            body: JSON.stringify(grantFields),
          },
        );
      }
      setGrantDraft(emptyGrantDraft(data.catalog));
      setEditingGrantId(null);
    });
  };

  const saveInstruction = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await run(async () => {
      if (editingInstructionId === null) {
        const target =
          instructionDraft.scope === "role"
            ? { role: instructionDraft.role }
            : instructionDraft.scope === "user"
              ? { userId: instructionDraft.userId }
              : instructionDraft.scope === "agent"
                ? { agentId: instructionDraft.agentId }
                : {};
        await requestJson("/access/instructions", {
          method: "POST",
          body: JSON.stringify({
            id: instructionDraft.id,
            scope: instructionDraft.scope,
            content: instructionDraft.content,
            ...target,
          }),
        });
      } else {
        await requestJson(
          `/access/instructions/${encodeURIComponent(editingInstructionId)}`,
          {
            method: "PATCH",
            body: JSON.stringify({ content: instructionDraft.content }),
          },
        );
      }
      setInstructionDraft(emptyInstructionDraft());
      setEditingInstructionId(null);
    });
  };

  const createResourceAccess = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await run(async () => {
      if (!resourceDraft.targetId) throw new Error("Select a user or group");
      await requestJson("/access/resource-access", {
        method: "POST",
        body: JSON.stringify({
          id: resourceDraft.id,
          resourceType: resourceDraft.resourceType,
          resourceId: resourceDraft.resourceId,
          ...(resourceDraft.targetType === "user"
            ? { userId: resourceDraft.targetId }
            : { groupId: resourceDraft.targetId }),
          canRead: resourceDraft.canRead,
          canWrite: resourceDraft.canWrite,
        }),
      });
      setResourceDraft(emptyResourceDraft());
    });
  };

  const createInvitation = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await run(async () => {
      if (invitation.token.trim().length < 32) {
        throw new Error("Use an invitation token with at least 32 characters");
      }
      await requestJson("/access/invitations", {
        method: "POST",
        body: JSON.stringify({
          ...invitation,
          expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1_000,
          token: invitation.token,
        }),
      });
      setInvitation((current) => ({
        ...current,
        email: "",
        name: "",
        token: "",
      }));
    });
  };

  const updateUser = async (user: ManagedUser, patch: Partial<ManagedUser>) => {
    await run(async () => {
      await requestJson(`/access/users/${encodeURIComponent(user.id)}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
    });
  };

  const revokeSessions = async (user: ManagedUser) => {
    await run(async () => {
      await requestJson(
        `/access/users/${encodeURIComponent(user.id)}/revoke-sessions`,
        {
          method: "POST",
        },
      );
    });
  };

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
      <header className="flex flex-col gap-4 border-b border-border pb-6 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
            {copy.eyebrow}
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">
            {copy.title}
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            {copy.description}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label
            className="flex items-center gap-2 text-xs text-muted-foreground"
            htmlFor="admin-locale"
          >
            <span>{locale === "es" ? "Idioma" : "Language"}</span>
            <select
              id="admin-locale"
              value={locale}
              onChange={(event) => setLocale(event.target.value as "en" | "es")}
              className="h-8 rounded-md border border-input bg-transparent px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="en">English</option>
              <option value="es">Español</option>
            </select>
          </label>
          <Button asChild variant="outline" size="sm">
            <Link to="/">{copy.back}</Link>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void auth?.signOut()}
          >
            {copy.signOut}
          </Button>
        </div>
      </header>

      {error ? (
        <p
          className="rounded-md border border-destructive/40 bg-surface-destructive px-3 py-2 text-sm text-destructive-text"
          role="alert"
        >
          {error}
        </p>
      ) : null}
      {notice ? (
        <p
          className="rounded-md border border-success/40 bg-surface-recessed px-3 py-2 text-sm text-success"
          role="status"
        >
          {notice}
        </p>
      ) : null}
      <datalist id="eva-model-catalog">
        {modelOptions.map((model) => (
          <option key={model} value={model} />
        ))}
      </datalist>

      <Section
        title={copy.catalog}
        description="The bundled EVA catalog is authoritative for agent selection. Connector manifests remain disabled until an adapter is registered."
      >
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {data.catalog.agents.map((agent) => (
            <article
              className="rounded-lg border border-border p-4"
              key={agent.id}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-medium">{agent.displayName}</h3>
                  <p className="text-xs text-muted-foreground">{agent.id}</p>
                </div>
                <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
                  {agent.status}
                </span>
              </div>
              <p className="mt-3 text-sm text-muted-foreground">
                {agent.description}
              </p>
              <p className="mt-3 text-xs text-muted-foreground">
                Default: {agent.defaultProviderId ?? "policy-selected provider"}{" "}
                · {agent.defaultModel} · {agent.defaultReasoningLevel}
              </p>
            </article>
          ))}
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-2">
          <div className="rounded-lg border border-border p-4 text-sm">
            <h3 className="font-medium">Registered providers</h3>
            <p className="mt-2 text-muted-foreground">
              {data.catalog.registeredProviderIds.join(", ")}
            </p>
          </div>
          <div className="rounded-lg border border-border p-4 text-sm">
            <h3 className="font-medium">Connector state</h3>
            <ul className="mt-2 space-y-1 text-muted-foreground">
              {data.catalog.connectors.map((connector) => (
                <li key={connector.id}>
                  {connector.displayName}: {connector.status}, non-executable
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Section>

      <Section
        title={copy.accounts}
        description="Only administrators can create accounts, change roles, set a default agent, reset passwords, or revoke sessions. A default agent must be allowed and resolve to one complete execution grant."
      >
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[1120px] text-left text-sm">
            <thead className="bg-surface-recessed text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Account</th>
                <th className="px-3 py-2">Role</th>
                <th className="px-3 py-2">Policy</th>
                <th className="px-3 py-2">Default agent</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.users.map((user) => (
                <tr className="border-t border-border" key={user.id}>
                  <td className="px-3 py-3">
                    <div className="font-medium">{user.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {user.email}
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <select
                      aria-label={`Role for ${user.email}`}
                      value={user.role}
                      onChange={(event) =>
                        void updateUser(user, {
                          role: event.target.value as Role,
                        })
                      }
                      className="h-8 rounded-md border border-input bg-transparent px-2 text-xs"
                    >
                      <option value="user">User</option>
                      <option value="admin">Administrator</option>
                    </select>
                  </td>
                  <td className="px-3 py-3">
                    <select
                      aria-label={`Default agent for ${user.email}`}
                      value={user.defaultAgentId ?? ""}
                      onChange={(event) =>
                        void updateUser(user, {
                          defaultAgentId: event.target.value || null,
                        })
                      }
                      className="h-8 max-w-48 rounded-md border border-input bg-transparent px-2 text-xs"
                    >
                      <option value="">No default agent</option>
                      {defaultAgentOptionsForUser(user).map((agent) => (
                        <option key={agent.id} value={agent.id}>
                          {agent.displayName}
                        </option>
                      ))}
                      {user.defaultAgentId !== null &&
                      !defaultAgentOptionsForUser(user).some(
                        (agent) => agent.id === user.defaultAgentId,
                      ) ? (
                        <option value={user.defaultAgentId}>
                          {user.defaultAgentId} (server validation)
                        </option>
                      ) : null}
                    </select>
                  </td>
                  <td className="px-3 py-3">
                    <select
                      aria-label={`Policy for ${user.email}`}
                      value={user.policyId}
                      onChange={(event) =>
                        void updateUser(user, { policyId: event.target.value })
                      }
                      className="h-8 rounded-md border border-input bg-transparent px-2 text-xs"
                    >
                      {policyOptions.map((policy) => (
                        <option key={policy.id} value={policy.id}>
                          {policy.id}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-3">
                    <select
                      aria-label={`Status for ${user.email}`}
                      value={user.status}
                      onChange={(event) =>
                        void updateUser(user, {
                          status: event.target.value as Status,
                        })
                      }
                      className="h-8 rounded-md border border-input bg-transparent px-2 text-xs"
                    >
                      <option value="active">Active</option>
                      <option value="disabled">Disabled</option>
                      <option value="revoked">Revoked</option>
                    </select>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void revokeSessions(user)}
                      >
                        Revoke sessions
                      </Button>
                      <details>
                        <summary className="cursor-pointer rounded-md border border-border px-2 py-1 text-xs">
                          Reset password
                        </summary>
                        <form
                          className="mt-2 flex gap-2"
                          onSubmit={(event) => {
                            event.preventDefault();
                            const form = new FormData(event.currentTarget);
                            const password = String(form.get("password") ?? "");
                            void run(async () => {
                              await requestJson(
                                `/access/users/${encodeURIComponent(user.id)}/reset-password`,
                                {
                                  method: "POST",
                                  body: JSON.stringify({ password }),
                                },
                              );
                              event.currentTarget.reset();
                            });
                          }}
                        >
                          <Input
                            name="password"
                            type="password"
                            minLength={12}
                            autoComplete="new-password"
                            placeholder="12+ characters"
                            required
                            className="h-8 w-40"
                          />
                          <Button type="submit" size="sm">
                            Save
                          </Button>
                        </form>
                      </details>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.users.length === 0 ? (
            <p className="px-3 py-4 text-sm text-muted-foreground">
              {copy.empty}
            </p>
          ) : null}
        </div>
        <form
          className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3"
          onSubmit={createUser}
        >
          <Field id="admin-user-name" label="Name">
            <Input
              id="admin-user-name"
              value={newUser.name}
              onChange={(event) =>
                setNewUser({ ...newUser, name: event.target.value })
              }
              required
            />
          </Field>
          <Field id="admin-user-email" label="Email">
            <Input
              id="admin-user-email"
              type="email"
              autoComplete="off"
              value={newUser.email}
              onChange={(event) =>
                setNewUser({ ...newUser, email: event.target.value })
              }
              required
            />
          </Field>
          <Field id="admin-user-password" label="Temporary password">
            <Input
              id="admin-user-password"
              type="password"
              autoComplete="new-password"
              minLength={12}
              value={newUser.password}
              onChange={(event) =>
                setNewUser({ ...newUser, password: event.target.value })
              }
              required
            />
          </Field>
          <SelectField
            id="admin-user-role"
            label="Role"
            value={newUser.role}
            onChange={(value) =>
              setNewUser({ ...newUser, role: value as Role })
            }
          >
            <option value="user">User</option>
            <option value="admin">Administrator</option>
          </SelectField>
          <SelectField
            id="admin-user-policy"
            label="Policy"
            value={newUser.policyId}
            onChange={(value) =>
              setNewUser({
                ...newUser,
                policyId: value,
                defaultAgentId: defaultAgentOptionsForPolicy(value).some(
                  (agent) => agent.id === newUser.defaultAgentId,
                )
                  ? newUser.defaultAgentId
                  : null,
              })
            }
          >
            {policyOptions.map((policy) => (
              <option key={policy.id} value={policy.id}>
                {policy.id}
              </option>
            ))}
          </SelectField>
          <SelectField
            id="admin-user-default-agent"
            label="Default agent"
            value={newUser.defaultAgentId ?? ""}
            onChange={(defaultAgentId) =>
              setNewUser({
                ...newUser,
                defaultAgentId: defaultAgentId || null,
              })
            }
          >
            <option value="">No default agent</option>
            {defaultAgentOptionsForPolicy(newUser.policyId).map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.displayName}
              </option>
            ))}
          </SelectField>
          <div className="flex items-end">
            <Button type="submit">{copy.create}</Button>
          </div>
        </form>
      </Section>

      <Section
        title={copy.invitations}
        description="Provide a one-time token through a separate secure channel; only its hash is stored by the server."
      >
        <form
          className="grid gap-3 md:grid-cols-2 xl:grid-cols-5"
          onSubmit={createInvitation}
        >
          <Field id="admin-invite-name" label="Name">
            <Input
              id="admin-invite-name"
              value={invitation.name}
              onChange={(event) =>
                setInvitation({ ...invitation, name: event.target.value })
              }
              required
            />
          </Field>
          <Field id="admin-invite-email" label="Email">
            <Input
              id="admin-invite-email"
              type="email"
              value={invitation.email}
              onChange={(event) =>
                setInvitation({ ...invitation, email: event.target.value })
              }
              required
            />
          </Field>
          <Field id="admin-invite-token" label="One-time token">
            <Input
              id="admin-invite-token"
              type="password"
              autoComplete="off"
              minLength={32}
              value={invitation.token}
              onChange={(event) =>
                setInvitation({ ...invitation, token: event.target.value })
              }
              required
            />
          </Field>
          <SelectField
            id="admin-invite-role"
            label="Role"
            value={invitation.role}
            onChange={(value) =>
              setInvitation({ ...invitation, role: value as Role })
            }
          >
            <option value="user">User</option>
            <option value="admin">Administrator</option>
          </SelectField>
          <SelectField
            id="admin-invite-policy"
            label="Policy"
            value={invitation.policyId}
            onChange={(value) =>
              setInvitation({ ...invitation, policyId: value })
            }
          >
            {policyOptions.map((policy) => (
              <option key={policy.id} value={policy.id}>
                {policy.id}
              </option>
            ))}
          </SelectField>
          <div className="md:col-span-2 xl:col-span-4">
            <Button type="submit">Create invitation</Button>
          </div>
        </form>
      </Section>

      <Section
        title={copy.policies}
        description="Use typed selectors with default-deny semantics. Fixed execution requires one usable provider, model, reasoning level, and permission mode."
      >
        <div className="space-y-2 text-sm">
          {data.policies.map((policy) => (
            <div
              className="flex flex-wrap items-center justify-between gap-2 border-b border-border py-2 last:border-0"
              key={policy.id}
            >
              <div>
                <span className="font-medium">{policy.id}</span>
                <span className="ml-2 text-muted-foreground">
                  {policy.role}
                </span>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setPolicyDraft(
                      policyToDraft(policy.policy, policy.id, policy.role),
                    );
                    setEditingPolicyId(policy.id);
                  }}
                >
                  Edit
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={policy.id === "admin" || policy.id === "user"}
                  onClick={() =>
                    void run(async () => {
                      await requestJson(
                        `/access/policies/${encodeURIComponent(policy.id)}`,
                        { method: "DELETE" },
                      );
                    })
                  }
                >
                  Delete
                </Button>
              </div>
            </div>
          ))}
          {data.policies.length === 0 ? (
            <p className="text-muted-foreground">{copy.empty}</p>
          ) : null}
        </div>
        <form className="mt-5 space-y-4" onSubmit={savePolicy}>
          <div className="grid gap-3 md:grid-cols-2">
            <Field id="admin-policy-id" label="Policy ID">
              <Input
                id="admin-policy-id"
                value={policyDraft.id}
                disabled={editingPolicyId !== null}
                onChange={(event) =>
                  setPolicyDraft({ ...policyDraft, id: event.target.value })
                }
                required
              />
            </Field>
            <SelectField
              id="admin-policy-role"
              label="Role"
              value={policyDraft.role}
              onChange={(value) =>
                setPolicyDraft({ ...policyDraft, role: value as Role })
              }
            >
              <option value="user">User</option>
              <option value="admin">Administrator</option>
            </SelectField>
          </div>
          <CheckGrid
            label="Allowed EVA agents"
            options={agentOptions}
            selected={policyDraft.agentIds}
            onChange={(agentIds) =>
              setPolicyDraft({ ...policyDraft, agentIds })
            }
          />
          {policyDraft.fixedExecution ? (
            <SelectField
              id="admin-policy-fixed-provider"
              label="Fixed provider"
              value={policyDraft.providerIds[0] ?? ""}
              onChange={(providerId) =>
                setPolicyDraft({
                  ...policyDraft,
                  providerIds: [providerId],
                  defaultProviderId: providerId,
                })
              }
            >
              <option value="">Select a provider</option>
              {providers.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.displayName}
                </option>
              ))}
            </SelectField>
          ) : (
            <CheckGrid
              label="Allowed providers"
              options={providerOptions}
              selected={policyDraft.providerIds}
              onChange={(providerIds) =>
                setPolicyDraft({ ...policyDraft, providerIds })
              }
            />
          )}
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {policyDraft.fixedExecution ? (
              <Field id="admin-policy-models" label="Fixed model">
                <select
                  id="admin-policy-models"
                  value={policyDraft.modelPatterns}
                  onChange={(event) =>
                    setPolicyDraft({
                      ...policyDraft,
                      modelPatterns: event.target.value,
                      defaultModel: event.target.value,
                    })
                  }
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="">Select a model</option>
                  {policyModelOptions.map((model) => (
                    <option key={model.value} value={model.value}>
                      {model.label}
                    </option>
                  ))}
                </select>
              </Field>
            ) : (
              <DelimitedCheckGrid
                label="Allowed model IDs"
                options={policyModelOptions}
                value={policyDraft.modelPatterns}
                onChange={(modelPatterns) =>
                  setPolicyDraft({ ...policyDraft, modelPatterns })
                }
              />
            )}
            <SelectField
              disabled={policyDraft.fixedExecution}
              id="admin-policy-default-provider"
              label="Default provider"
              value={policyDraft.defaultProviderId}
              onChange={(defaultProviderId) =>
                setPolicyDraft({ ...policyDraft, defaultProviderId })
              }
            >
              <option value="">No default</option>
              {providers.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.displayName}
                </option>
              ))}
            </SelectField>
            <SelectField
              disabled={policyDraft.fixedExecution}
              id="admin-policy-default-model"
              label="Default model"
              value={policyDraft.defaultModel}
              onChange={(defaultModel) =>
                setPolicyDraft({ ...policyDraft, defaultModel })
              }
            >
              <option value="">No default</option>
              {modelOptions.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </SelectField>
            {policyDraft.fixedExecution ? (
              <SelectField
                id="admin-policy-fixed-reasoning"
                label="Fixed reasoning"
                value={policyDraft.reasoningLevels[0] ?? ""}
                onChange={(value) =>
                  setPolicyDraft({
                    ...policyDraft,
                    reasoningLevels: [value as ReasoningLevel],
                    defaultReasoningLevel: value as ReasoningLevel,
                  })
                }
              >
                <option value="">Select reasoning</option>
                {reasoningLevels.map((level) => (
                  <option key={level} value={level}>
                    {level}
                  </option>
                ))}
              </SelectField>
            ) : (
              <SelectField
                id="admin-policy-default-reasoning"
                label="Default reasoning"
                value={policyDraft.defaultReasoningLevel}
                onChange={(value) =>
                  setPolicyDraft({
                    ...policyDraft,
                    defaultReasoningLevel:
                      value as PolicyDraft["defaultReasoningLevel"],
                  })
                }
              >
                <option value="">No default</option>
                {reasoningLevels.map((level) => (
                  <option key={level} value={level}>
                    {level}
                  </option>
                ))}
              </SelectField>
            )}
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <SelectField
              id="admin-policy-default-permission"
              label={
                policyDraft.fixedExecution
                  ? "Fixed permission"
                  : "Default permission"
              }
              value={policyDraft.defaultPermissionMode}
              onChange={(value) =>
                setPolicyDraft({
                  ...policyDraft,
                  defaultPermissionMode:
                    value as PolicyDraft["defaultPermissionMode"],
                  ...(policyDraft.fixedExecution
                    ? { maxPermissionMode: value as PermissionMode }
                    : {}),
                })
              }
            >
              <option value="">No default</option>
              {permissionModes.map((mode) => (
                <option key={mode} value={mode}>
                  {mode}
                </option>
              ))}
            </SelectField>
            <SelectField
              disabled={policyDraft.fixedExecution}
              id="admin-policy-max-permission"
              label="Maximum permission"
              value={policyDraft.maxPermissionMode}
              onChange={(value) =>
                setPolicyDraft({
                  ...policyDraft,
                  maxPermissionMode: value as PermissionMode,
                })
              }
            >
              {permissionModes.map((mode) => (
                <option key={mode} value={mode}>
                  {mode}
                </option>
              ))}
            </SelectField>
            <SelectField
              id="admin-policy-terminal"
              label="Terminal access"
              value={policyDraft.terminalAccess}
              onChange={(value) =>
                setPolicyDraft({
                  ...policyDraft,
                  terminalAccess: value as TerminalAccess,
                })
              }
            >
              {terminalAccessValues.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </SelectField>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <DelimitedCheckGrid
              label="Allowed tools"
              options={optionsWithCurrentValues(
                toolOptions,
                policyDraft.toolIds,
              )}
              value={policyDraft.toolIds}
              onChange={(toolIds) =>
                setPolicyDraft({ ...policyDraft, toolIds })
              }
            />
            <DelimitedCheckGrid
              label="Allowed plugins"
              options={optionsWithCurrentValues(
                pluginOptions,
                policyDraft.pluginIds,
              )}
              value={policyDraft.pluginIds}
              onChange={(pluginIds) =>
                setPolicyDraft({ ...policyDraft, pluginIds })
              }
            />
            <label className="flex items-center gap-2 self-end text-sm">
              <input
                type="checkbox"
                checked={policyDraft.fixedExecution}
                onChange={(event) => setFixedPolicy(event.target.checked)}
              />{" "}
              Fixed execution
            </label>
          </div>
          <CapabilityGrid
            value={policyDraft.capabilities}
            onChange={(capabilities) =>
              setPolicyDraft({ ...policyDraft, capabilities })
            }
          />
          <div className="flex flex-wrap gap-2">
            <Button type="submit">
              {editingPolicyId === null ? copy.create : copy.update}
            </Button>
            {editingPolicyId !== null ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setEditingPolicyId(null);
                  setPolicyDraft(emptyPolicyDraft());
                }}
              >
                {copy.cancel}
              </Button>
            ) : null}
          </div>
        </form>
      </Section>

      <div className="grid gap-6 xl:grid-cols-2">
        <Section
          title={copy.groups}
          description="Assign a policy and replace membership atomically."
        >
          <div className="space-y-2 text-sm">
            {data.groups.map((group) => (
              <div
                className="flex flex-wrap items-center justify-between gap-2 border-b border-border py-2"
                key={group.id}
              >
                <div>
                  <span className="font-medium">{group.name}</span>
                  <span className="ml-2 text-muted-foreground">
                    {group.memberCount} members · {group.policyId}
                  </span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setEditingGroupId(group.id);
                    setGroupDraft({
                      id: group.id,
                      name: group.name,
                      policyId: group.policyId,
                    });
                    setGroupMembers(data.members[group.id] ?? []);
                  }}
                >
                  Edit membership
                </Button>
              </div>
            ))}
          </div>
          <form className="mt-5 space-y-3" onSubmit={saveGroup}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field id="admin-group-id" label="Group ID">
                <Input
                  id="admin-group-id"
                  value={groupDraft.id}
                  disabled={editingGroupId !== null}
                  onChange={(event) =>
                    setGroupDraft({ ...groupDraft, id: event.target.value })
                  }
                  required
                />
              </Field>
              <Field id="admin-group-name" label="Name">
                <Input
                  id="admin-group-name"
                  value={groupDraft.name}
                  onChange={(event) =>
                    setGroupDraft({ ...groupDraft, name: event.target.value })
                  }
                  required
                />
              </Field>
            </div>
            <SelectField
              id="admin-group-policy"
              label="Policy"
              value={groupDraft.policyId}
              onChange={(policyId) =>
                setGroupDraft({ ...groupDraft, policyId })
              }
            >
              {policyOptions.map((policy) => (
                <option key={policy.id} value={policy.id}>
                  {policy.id}
                </option>
              ))}
            </SelectField>
            <CheckGrid
              label="Members"
              options={data.users.map((user) => ({
                value: user.id,
                label: user.email,
              }))}
              selected={groupMembers}
              onChange={setGroupMembers}
            />
            <div className="flex gap-2">
              <Button type="submit">
                {editingGroupId === null ? copy.create : copy.update}
              </Button>
              {editingGroupId !== null ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setEditingGroupId(null);
                    setGroupDraft({ id: "", name: "", policyId: "user" });
                    setGroupMembers([]);
                  }}
                >
                  {copy.cancel}
                </Button>
              ) : null}
            </div>
          </form>
        </Section>

        <Section
          title={copy.grants}
          description="Provider, model, reasoning, permission, terminal, and tools stay in the selected agent tuple."
        >
          <div className="space-y-2 text-sm">
            {data.grants.map((grant) => (
              <div
                className="flex flex-wrap items-center justify-between gap-2 border-b border-border py-2"
                key={grant.id}
              >
                <div>
                  <span className="font-medium">{grant.agentId}</span>
                  <span className="ml-2 text-muted-foreground">
                    {grant.userId ?? `group:${grant.groupId}`} ·{" "}
                    {grant.fixedExecution ? "fixed" : "changeable"}
                  </span>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setEditingGrantId(grant.id);
                      setGrantDraft({
                        id: grant.id,
                        targetType: grant.userId ? "user" : "group",
                        targetId: grant.userId ?? grant.groupId ?? "",
                        agentId: grant.agentId,
                        providerIds: grant.providerIds,
                        modelPatterns: grant.modelPatterns.join(", "),
                        reasoningLevels: grant.reasoningLevels,
                        fixedExecution: grant.fixedExecution,
                        permissionMode: grant.permissionMode ?? "",
                        terminalAccess: grant.terminalAccess,
                        toolIds: grant.toolIds.join(", "),
                        pluginIds: grant.pluginIds.join(", "),
                      });
                    }}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      void run(async () => {
                        await requestJson(
                          `/access/grants/${encodeURIComponent(grant.id)}`,
                          { method: "DELETE" },
                        );
                      })
                    }
                  >
                    Delete
                  </Button>
                </div>
              </div>
            ))}
          </div>
          <form className="mt-5 space-y-4" onSubmit={saveGrant}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field id="admin-grant-id" label="Grant ID">
                <Input
                  id="admin-grant-id"
                  value={grantDraft.id}
                  disabled={editingGrantId !== null}
                  onChange={(event) =>
                    setGrantDraft({ ...grantDraft, id: event.target.value })
                  }
                  required
                />
              </Field>
              <SelectField
                id="admin-grant-target-type"
                label="Target type"
                value={grantDraft.targetType}
                onChange={(targetType) =>
                  setGrantDraft({
                    ...grantDraft,
                    targetType: targetType as GrantDraft["targetType"],
                    targetId: "",
                  })
                }
              >
                <option value="user">User</option>
                <option value="group">Group</option>
              </SelectField>
            </div>
            <SelectField
              id="admin-grant-target"
              label="Target"
              value={grantDraft.targetId}
              onChange={(targetId) =>
                setGrantDraft({ ...grantDraft, targetId })
              }
            >
              <option value="">Select a target</option>
              {(grantDraft.targetType === "user"
                ? data.users
                : data.groups
              ).map((target) => (
                <option key={target.id} value={target.id}>
                  {"email" in target ? target.email : target.name}
                </option>
              ))}
            </SelectField>
            <SelectField
              id="admin-grant-agent"
              label="EVA agent"
              value={grantDraft.agentId}
              onChange={(agentId) => {
                const agent = agents.find((item) => item.id === agentId);
                setGrantDraft({
                  ...grantDraft,
                  agentId,
                  providerIds: agent?.providerIds ?? [],
                  modelPatterns: agent?.defaultModel ?? "",
                  reasoningLevels: agent?.reasoningLevels ?? [],
                  permissionMode:
                    agent?.defaultPermissionMode ?? "accept-edits",
                });
              }}
            >
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.displayName} ({agent.id})
                </option>
              ))}
            </SelectField>
            {grantDraft.fixedExecution ? (
              <SelectField
                id="admin-grant-fixed-provider"
                label="Fixed provider"
                value={grantDraft.providerIds[0] ?? ""}
                onChange={(providerId) =>
                  setGrantDraft({ ...grantDraft, providerIds: [providerId] })
                }
              >
                <option value="">Select a provider</option>
                {providers.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.displayName}
                  </option>
                ))}
              </SelectField>
            ) : (
              <CheckGrid
                label="Providers in this tuple"
                options={providerOptions}
                selected={grantDraft.providerIds}
                onChange={(providerIds) =>
                  setGrantDraft({ ...grantDraft, providerIds })
                }
              />
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              {grantDraft.fixedExecution ? (
                <Field id="admin-grant-models" label="Fixed model">
                  <select
                    id="admin-grant-models"
                    value={grantDraft.modelPatterns}
                    onChange={(event) =>
                      setGrantDraft({
                        ...grantDraft,
                        modelPatterns: event.target.value,
                      })
                    }
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <option value="">Select a model</option>
                    {grantModelOptions.map((model) => (
                      <option key={model.value} value={model.value}>
                        {model.label}
                      </option>
                    ))}
                  </select>
                </Field>
              ) : (
                <DelimitedCheckGrid
                  label="Allowed model IDs"
                  options={grantModelOptions}
                  value={grantDraft.modelPatterns}
                  onChange={(modelPatterns) =>
                    setGrantDraft({ ...grantDraft, modelPatterns })
                  }
                />
              )}
              <DelimitedCheckGrid
                label="Allowed tools in this tuple"
                options={optionsWithCurrentValues(
                  toolOptions,
                  grantDraft.toolIds,
                )}
                value={grantDraft.toolIds}
                onChange={(toolIds) =>
                  setGrantDraft({ ...grantDraft, toolIds })
                }
              />
              <DelimitedCheckGrid
                label="Allowed plugins in this tuple"
                options={optionsWithCurrentValues(
                  pluginOptions,
                  grantDraft.pluginIds,
                )}
                value={grantDraft.pluginIds}
                onChange={(pluginIds) =>
                  setGrantDraft({ ...grantDraft, pluginIds })
                }
              />
            </div>
            {grantDraft.fixedExecution ? (
              <SelectField
                id="admin-grant-fixed-reasoning"
                label="Fixed reasoning"
                value={grantDraft.reasoningLevels[0] ?? ""}
                onChange={(value) =>
                  setGrantDraft({
                    ...grantDraft,
                    reasoningLevels: [value as ReasoningLevel],
                  })
                }
              >
                <option value="">Select reasoning</option>
                {reasoningLevels.map((level) => (
                  <option key={level} value={level}>
                    {level}
                  </option>
                ))}
              </SelectField>
            ) : (
              <CheckGrid
                label="Reasoning in this tuple"
                options={reasoningLevels.map((level) => ({
                  value: level,
                  label: level,
                }))}
                selected={grantDraft.reasoningLevels}
                onChange={(values) =>
                  setGrantDraft({
                    ...grantDraft,
                    reasoningLevels: values as ReasoningLevel[],
                  })
                }
              />
            )}
            <div className="grid gap-3 sm:grid-cols-3">
              <SelectField
                id="admin-grant-permission"
                label="Permission"
                value={grantDraft.permissionMode}
                onChange={(permissionMode) =>
                  setGrantDraft({
                    ...grantDraft,
                    permissionMode:
                      permissionMode as GrantDraft["permissionMode"],
                  })
                }
              >
                <option value="">No default</option>
                {permissionModes.map((mode) => (
                  <option key={mode} value={mode}>
                    {mode}
                  </option>
                ))}
              </SelectField>
              <SelectField
                id="admin-grant-terminal"
                label="Terminal"
                value={grantDraft.terminalAccess}
                onChange={(terminalAccess) =>
                  setGrantDraft({
                    ...grantDraft,
                    terminalAccess:
                      terminalAccess as GrantDraft["terminalAccess"],
                  })
                }
              >
                {terminalAccessValues.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </SelectField>
              <label className="flex items-center gap-2 self-end text-sm">
                <input
                  type="checkbox"
                  checked={grantDraft.fixedExecution}
                  onChange={(event) => setFixedGrant(event.target.checked)}
                />{" "}
                Fixed tuple
              </label>
            </div>
            <div className="flex gap-2">
              <Button type="submit">
                {editingGrantId === null ? copy.create : copy.update}
              </Button>
              {editingGrantId !== null ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setEditingGrantId(null);
                    setGrantDraft(emptyGrantDraft(data.catalog));
                  }}
                >
                  {copy.cancel}
                </Button>
              ) : null}
            </div>
          </form>
          {selectedAgent && selectedProvider ? (
            <p className="mt-3 text-xs text-muted-foreground">
              Selected tuple: {selectedAgent.id} · {selectedProvider.id}
            </p>
          ) : null}
        </Section>
      </div>

      <Section
        title={copy.resources}
        description="Direct resource IDs are still checked by the server against these scopes and the current session."
      >
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-surface-recessed text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Resource</th>
                <th className="px-3 py-2">Target</th>
                <th className="px-3 py-2">Read</th>
                <th className="px-3 py-2">Write</th>
                <th className="px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.resourceAccess.map((grant) => (
                <tr className="border-t border-border" key={grant.id}>
                  <td className="px-3 py-3">
                    {grant.resourceType}: {grant.resourceId}
                  </td>
                  <td className="px-3 py-3 text-muted-foreground">
                    {grant.userId ?? `group:${grant.groupId}`}
                  </td>
                  <td className="px-3 py-3">
                    <input
                      type="checkbox"
                      checked={grant.canRead}
                      onChange={(event) =>
                        void run(async () => {
                          await requestJson(
                            `/access/resource-access/${encodeURIComponent(grant.id)}`,
                            {
                              method: "PATCH",
                              body: JSON.stringify({
                                canRead: event.target.checked,
                                canWrite:
                                  event.target.checked && grant.canWrite,
                              }),
                            },
                          );
                        })
                      }
                    />
                  </td>
                  <td className="px-3 py-3">
                    <input
                      type="checkbox"
                      checked={grant.canWrite}
                      disabled={!grant.canRead}
                      onChange={(event) =>
                        void run(async () => {
                          await requestJson(
                            `/access/resource-access/${encodeURIComponent(grant.id)}`,
                            {
                              method: "PATCH",
                              body: JSON.stringify({
                                canWrite: event.target.checked,
                              }),
                            },
                          );
                        })
                      }
                    />
                  </td>
                  <td className="px-3 py-3">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        void run(async () => {
                          await requestJson(
                            `/access/resource-access/${encodeURIComponent(grant.id)}`,
                            { method: "DELETE" },
                          );
                        })
                      }
                    >
                      Delete
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <form
          className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4"
          onSubmit={createResourceAccess}
        >
          <Field id="admin-resource-id" label="Grant ID">
            <Input
              id="admin-resource-id"
              value={resourceDraft.id}
              onChange={(event) =>
                setResourceDraft({ ...resourceDraft, id: event.target.value })
              }
              required
            />
          </Field>
          <SelectField
            id="admin-resource-type"
            label="Resource type"
            value={resourceDraft.resourceType}
            onChange={(resourceType) =>
              setResourceDraft({
                ...resourceDraft,
                resourceType: resourceType as ResourceType,
              })
            }
          >
            <option value="project">Project</option>
            <option value="host">Host</option>
            <option value="environment">Environment</option>
          </SelectField>
          <Field id="admin-resource-value" label="Resource ID">
            <Input
              id="admin-resource-value"
              value={resourceDraft.resourceId}
              onChange={(event) =>
                setResourceDraft({
                  ...resourceDraft,
                  resourceId: event.target.value,
                })
              }
              required
            />
          </Field>
          <SelectField
            id="admin-resource-target-type"
            label="Target type"
            value={resourceDraft.targetType}
            onChange={(targetType) =>
              setResourceDraft({
                ...resourceDraft,
                targetType: targetType as ResourceDraft["targetType"],
                targetId: "",
              })
            }
          >
            <option value="user">User</option>
            <option value="group">Group</option>
          </SelectField>
          <SelectField
            id="admin-resource-target"
            label="Target"
            value={resourceDraft.targetId}
            onChange={(targetId) =>
              setResourceDraft({ ...resourceDraft, targetId })
            }
          >
            <option value="">Select a target</option>
            {(resourceDraft.targetType === "user"
              ? data.users
              : data.groups
            ).map((target) => (
              <option key={target.id} value={target.id}>
                {"email" in target ? target.email : target.name}
              </option>
            ))}
          </SelectField>
          <div className="flex items-end gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={resourceDraft.canRead}
                onChange={(event) =>
                  setResourceDraft({
                    ...resourceDraft,
                    canRead: event.target.checked,
                    canWrite: event.target.checked && resourceDraft.canWrite,
                  })
                }
              />{" "}
              Read
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={resourceDraft.canWrite}
                disabled={!resourceDraft.canRead}
                onChange={(event) =>
                  setResourceDraft({
                    ...resourceDraft,
                    canWrite: event.target.checked,
                  })
                }
              />{" "}
              Write
            </label>
            <Button type="submit">{copy.create}</Button>
          </div>
        </form>
      </Section>

      <Section
        title={copy.instructions}
        description="Server instructions are hidden from users. Global, role, user, and agent entries apply by precedence to constrained users; administrators are excluded."
      >
        <div className="space-y-2 text-sm">
          {data.instructions.map((instruction) => (
            <div
              className="flex flex-wrap items-start justify-between gap-3 border-b border-border py-3"
              key={instruction.id}
            >
              <div className="min-w-0">
                <div className="font-medium">
                  {instruction.id} · {instruction.scope}{" "}
                  {instruction.enabled ? "· enabled" : "· disabled"}
                </div>
                <p className="mt-1 max-w-3xl whitespace-pre-wrap text-muted-foreground">
                  {instruction.content}
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setEditingInstructionId(instruction.id);
                    setInstructionDraft({
                      id: instruction.id,
                      scope: instruction.scope,
                      role: instruction.role ?? "user",
                      userId: instruction.userId ?? "",
                      agentId: instruction.agentId ?? "",
                      content: instruction.content,
                    });
                  }}
                >
                  Edit
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    void run(async () => {
                      await requestJson(
                        `/access/instructions/${encodeURIComponent(instruction.id)}`,
                        {
                          method: "PATCH",
                          body: JSON.stringify({
                            enabled: !instruction.enabled,
                          }),
                        },
                      );
                    })
                  }
                >
                  {instruction.enabled ? "Disable" : "Enable"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    void run(async () => {
                      await requestJson(
                        `/access/instructions/${encodeURIComponent(instruction.id)}`,
                        { method: "DELETE" },
                      );
                    })
                  }
                >
                  Delete
                </Button>
              </div>
            </div>
          ))}
        </div>
        <form className="mt-5 space-y-3" onSubmit={saveInstruction}>
          <div className="grid gap-3 md:grid-cols-3">
            <Field id="admin-instruction-id" label="Instruction ID">
              <Input
                id="admin-instruction-id"
                value={instructionDraft.id}
                disabled={editingInstructionId !== null}
                onChange={(event) =>
                  setInstructionDraft({
                    ...instructionDraft,
                    id: event.target.value,
                  })
                }
                required
              />
            </Field>
            <SelectField
              id="admin-instruction-scope"
              label="Scope"
              value={instructionDraft.scope}
              onChange={(scope) =>
                setInstructionDraft({
                  ...instructionDraft,
                  scope: scope as Scope,
                })
              }
            >
              <option value="global">Global</option>
              <option value="role">Role</option>
              <option value="user">User</option>
              <option value="agent">Agent</option>
            </SelectField>
            {instructionDraft.scope === "role" ? (
              <SelectField
                id="admin-instruction-role"
                label="Role"
                value={instructionDraft.role}
                onChange={(role) =>
                  setInstructionDraft({
                    ...instructionDraft,
                    role: role as Role,
                  })
                }
              >
                <option value="user">User</option>
                <option value="admin">Administrator</option>
              </SelectField>
            ) : instructionDraft.scope === "user" ? (
              <SelectField
                id="admin-instruction-user"
                label="User"
                value={instructionDraft.userId}
                onChange={(userId) =>
                  setInstructionDraft({ ...instructionDraft, userId })
                }
              >
                <option value="">Select a user</option>
                {data.users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.email}
                  </option>
                ))}
              </SelectField>
            ) : instructionDraft.scope === "agent" ? (
              <SelectField
                id="admin-instruction-agent"
                label="Agent"
                value={instructionDraft.agentId}
                onChange={(agentId) =>
                  setInstructionDraft({ ...instructionDraft, agentId })
                }
              >
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.displayName}
                  </option>
                ))}
              </SelectField>
            ) : (
              <div />
            )}
          </div>
          <label
            className="block space-y-2 text-sm"
            htmlFor="admin-instruction-content"
          >
            <span className="font-medium">Content</span>
            <textarea
              id="admin-instruction-content"
              value={instructionDraft.content}
              onChange={(event) =>
                setInstructionDraft({
                  ...instructionDraft,
                  content: event.target.value,
                })
              }
              className="min-h-28 w-full rounded-md border border-input bg-transparent p-3 text-sm leading-5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              maxLength={8192}
              required
            />
          </label>
          <div className="flex gap-2">
            <Button type="submit">
              {editingInstructionId === null ? copy.create : copy.update}
            </Button>
            {editingInstructionId !== null ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setEditingInstructionId(null);
                  setInstructionDraft(emptyInstructionDraft());
                }}
              >
                {copy.cancel}
              </Button>
            ) : null}
          </div>
        </form>
      </Section>

      <Section
        title={copy.audit}
        description="Administrative changes are recorded without passwords, tokens, or instruction payloads."
      >
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="bg-surface-recessed text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Event</th>
                <th className="px-3 py-2">Actor</th>
                <th className="px-3 py-2">Target</th>
                <th className="px-3 py-2">Time</th>
              </tr>
            </thead>
            <tbody>
              {data.audit.map((event) => (
                <tr className="border-t border-border" key={event.id}>
                  <td className="px-3 py-3 font-medium">{event.eventType}</td>
                  <td className="px-3 py-3 text-muted-foreground">
                    {event.actorUserId ?? "system"}
                  </td>
                  <td className="px-3 py-3 text-muted-foreground">
                    {event.targetUserId ?? "—"}
                  </td>
                  <td className="px-3 py-3 text-muted-foreground">
                    {formatDate(event.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}
