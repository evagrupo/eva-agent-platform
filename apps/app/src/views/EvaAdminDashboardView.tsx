import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { Link } from "react-router-dom";
import { Badge } from "@bb/shared-ui/badge";
import { Button } from "@bb/shared-ui/button";
import { Checkbox } from "@bb/shared-ui/checkbox";
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@bb/shared-ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@bb/shared-ui/dialog";
import { Icon } from "@bb/shared-ui/icon";
import { Input } from "@bb/shared-ui/input";
import { cn } from "@bb/shared-ui/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@bb/shared-ui/popover";
import { PageShell } from "@/components/ui/page-shell.js";
import { searchPickerOptions } from "@/components/pickers/picker-search";
import { useResetPickerScroll } from "@/components/pickers/useResetPickerScroll";
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
}

interface CorePolicy {
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
  capabilities?: CoreCapabilities;
}

interface ManagedPolicy {
  id: string;
  role: Role;
  policy: CorePolicy;
  revision: number;
  updatedAt: number;
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
    const body: unknown = await response.json().catch(() => null);
    const apiMessage =
      typeof body === "object" &&
      body !== null &&
      "message" in body &&
      typeof body.message === "string"
        ? body.message
        : null;
    throw new Error(
      apiMessage ??
        (response.status === 403
          ? "Administrator access required"
          : "Request could not be completed"),
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
  options: MultiSelectOptions,
  value: string,
): MultiSelectOption[] {
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

function policyFromDraft(draft: PolicyDraft): CorePolicy {
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

function policyToDraft(policy: ManagedPolicy): PolicyDraft {
  return {
    id: policy.id,
    role: policy.role,
    agentIds: policy.policy.allowedAgentIds,
    providerIds: policy.policy.allowedProviderIds,
    modelPatterns: policy.policy.allowedModelPatterns.join(", "),
    reasoningLevels: policy.policy.allowedReasoningLevels,
    defaultProviderId: policy.policy.defaultProviderId ?? "",
    defaultModel: policy.policy.defaultModel ?? "",
    defaultReasoningLevel: policy.policy.defaultReasoningLevel ?? "",
    defaultPermissionMode: policy.policy.defaultPermissionMode ?? "",
    fixedExecution: policy.policy.fixedExecution,
    maxPermissionMode: policy.policy.maxPermissionMode,
    terminalAccess: policy.policy.terminalAccess,
    toolIds: policy.policy.allowedToolIds.join(", "),
    pluginIds: policy.policy.allowedPluginIds.join(", "),
    capabilities: policy.policy.capabilities ?? emptyCapabilities(),
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

function Section({
  id,
  title,
  description,
  open,
  onToggle,
  children,
}: {
  id: string;
  title: string;
  description: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const panelId = `admin-section-${id}-panel`;
  return (
    <section className="rounded-xl border border-border bg-card p-5 shadow-sm md:p-6">
      <h2>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={onToggle}
          className="flex w-full items-start justify-between gap-3 text-left"
        >
          <span className="block">
            <span className="block text-base font-semibold">{title}</span>
            <span className="mt-1 block text-sm font-normal text-muted-foreground">
              {description}
            </span>
          </span>
          <Icon
            name="ChevronDown"
            className={cn(
              "mt-1 size-4 shrink-0 text-muted-foreground transition-transform",
              open && "rotate-180",
            )}
          />
        </button>
      </h2>
      {open ? (
        <div className="mt-5" id={panelId}>
          {children}
        </div>
      ) : null}
    </section>
  );
}

function CredentialsPanel({
  email,
  password,
  onDone,
}: {
  email: string;
  password: string;
  onDone: () => void;
}) {
  const [copied, setCopied] = useState<"email" | "password" | "both" | null>(
    null,
  );
  const copy = async (field: "email" | "password" | "both", value: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(field);
    window.setTimeout(() => setCopied(null), 1500);
  };
  return (
    <div className="rounded-lg border border-border bg-surface-recessed p-4">
      <h3 className="text-sm font-semibold">User credentials</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Copy email and password and send them on a channel you control. The
        server never stores the plaintext password and will not show it again.
      </p>
      <div className="mt-4 space-y-3">
        <div className="flex items-end gap-2">
          <Field id="issued-user-email" label="Email">
            <Input id="issued-user-email" value={email} readOnly />
          </Field>
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label="Copy email"
            onClick={() => void copy("email", email)}
          >
            <Icon name={copied === "email" ? "Check" : "Copy"} />
          </Button>
        </div>
        <div className="flex items-end gap-2">
          <Field id="issued-user-password" label="Password">
            <Input
              id="issued-user-password"
              value={password}
              readOnly
              className="font-mono"
            />
          </Field>
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label="Copy password"
            onClick={() => void copy("password", password)}
          >
            <Icon name={copied === "password" ? "Check" : "Copy"} />
          </Button>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          type="button"
          onClick={() =>
            void copy("both", `Email: ${email}\nPassword: ${password}`)
          }
        >
          {copied === "both" ? "Copied" : "Copy both"}
        </Button>
        <Button type="button" variant="outline" onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
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

interface MultiSelectOption {
  value: string;
  label: string;
  group?: string;
}

type MultiSelectOptions = ReadonlyArray<MultiSelectOption>;

const MULTI_SELECT_SEARCH_MIN_OPTIONS = 6;

function sameValues(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function multiSelectFieldId(label: string): string {
  return `admin-multi-${label.replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase()}`;
}

function MultiSelectCombobox({
  id,
  label,
  options,
  selected,
  toggle,
  onCommit,
}: {
  id: string;
  label: string;
  options: MultiSelectOptions;
  selected: readonly string[];
  toggle: (current: readonly string[], value: string) => string[];
  onCommit: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<string[]>(() => [...selected]);
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const listRef = useResetPickerScroll<HTMLDivElement>(searchQuery);
  const showSearch = options.length > MULTI_SELECT_SEARCH_MIN_OPTIONS;
  const filteredOptions = useMemo(
    () =>
      showSearch
        ? searchPickerOptions({
            options,
            query: searchQuery,
            getLabel: (option) => option.label,
          })
        : options,
    [options, searchQuery, showSearch],
  );
  const selectedOptions = useMemo(
    () =>
      selected.map(
        (value) =>
          options.find((option) => option.value === value) ?? {
            value,
            label: value,
          },
      ),
    [options, selected],
  );

  const optionGroups = useMemo(() => {
    const order: string[] = [];
    for (const option of options) {
      const group = option.group ?? "";
      if (!order.includes(group)) order.push(group);
    }
    return order.map((group) => ({
      group,
      items: filteredOptions.filter((option) => (option.group ?? "") === group),
    }));
  }, [filteredOptions, options]);

  const handleOpenChange = (next: boolean) => {
    if (next) {
      setPending([...selected]);
    } else if (!sameValues(pending, selected)) {
      onCommit(pending);
    }
    setSearchQuery("");
    setOpen(next);
  };

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (contentRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      handleOpenChange(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointerDown, true);
    return () =>
      document.removeEventListener(
        "pointerdown",
        closeOnOutsidePointerDown,
        true,
      );
  });

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          ref={triggerRef}
          type="button"
          id={id}
          aria-label={label}
          className="flex min-h-9 w-full flex-wrap items-center gap-1.5 rounded-md border border-input bg-transparent px-2 py-1.5 text-left text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          {selectedOptions.length === 0 ? (
            <span className="px-1 text-muted-foreground">Select…</span>
          ) : (
            selectedOptions.map((option) => (
              <Badge
                key={option.value}
                variant="secondary"
                className="gap-1 rounded-sm py-0 pr-1 font-normal"
              >
                {option.label}
                <span
                  role="button"
                  tabIndex={-1}
                  aria-label={`Remove ${option.label}`}
                  className="rounded-sm p-0.5 hover:bg-state-hover"
                  onClick={(event) => {
                    event.stopPropagation();
                    onCommit(selected.filter((item) => item !== option.value));
                  }}
                >
                  <Icon name="X" className="size-3" aria-hidden />
                </span>
              </Badge>
            ))
          )}
          <Icon
            name="ChevronDown"
            className="ml-auto size-4 shrink-0 text-muted-foreground"
            aria-hidden
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        ref={contentRef}
        align="start"
        mobileTitle={label}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          if (showSearch) searchInputRef.current?.focus();
        }}
        className="flex max-h-72 w-[min(20rem,90vw)] flex-col overflow-hidden p-0"
      >
        <Command label={label} shouldFilter={false} className="min-h-0">
          {showSearch ? (
            <CommandInput
              ref={searchInputRef}
              aria-label={`Search ${label}`}
              placeholder={`Search ${label.toLowerCase()}`}
              value={searchQuery}
              onValueChange={setSearchQuery}
              className="h-8 text-xs"
            />
          ) : null}
          <CommandList
            ref={listRef}
            className="max-h-56 overscroll-contain"
            onWheel={(event) => event.stopPropagation()}
            onTouchMove={(event) => event.stopPropagation()}
          >
            {optionGroups.map(({ group, items }) =>
              items.length === 0 ? null : (
                <CommandGroup key={group} heading={group || label}>
                  {items.map((option) => {
                    const checked = pending.includes(option.value);
                    return (
                      <CommandItem
                        key={`${group}\u0000${option.value}`}
                        value={`${group}\u0000${option.value}`}
                        keywords={[option.label]}
                        onSelect={() =>
                          setPending((current) => toggle(current, option.value))
                        }
                        className="gap-2"
                      >
                        <Checkbox
                          checked={checked}
                          className="pointer-events-none"
                        />
                        <span className="min-w-0 flex-1 truncate">
                          {option.label}
                        </span>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              ),
            )}
            {showSearch && filteredOptions.length === 0 ? (
              <div className="px-2 py-1.5 text-xs text-muted-foreground">
                No matches
              </div>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function MultiSelectField({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: MultiSelectOptions;
  selected: readonly string[];
  onChange: (value: string[]) => void;
}) {
  const id = multiSelectFieldId(label);
  return (
    <Field id={id} label={label}>
      <MultiSelectCombobox
        id={id}
        label={label}
        options={options}
        selected={selected}
        toggle={(current, value) =>
          current.includes(value)
            ? current.filter((item) => item !== value)
            : [...current, value]
        }
        onCommit={onChange}
      />
    </Field>
  );
}

function DelimitedMultiSelectField({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: MultiSelectOptions;
  value: string;
  onChange: (value: string) => void;
}) {
  const id = multiSelectFieldId(label);
  const selected = splitList(value);
  return (
    <Field id={id} label={label}>
      <MultiSelectCombobox
        id={id}
        label={label}
        options={options}
        selected={selected}
        toggle={(current, option) =>
          current.includes(option)
            ? current.filter((item) => item !== option)
            : option === "*"
              ? ["*"]
              : [...current.filter((item) => item !== "*"), option]
        }
        onCommit={(next) => onChange(next.join(", "))}
      />
    </Field>
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
      <legend className="font-medium">Capabilities</legend>
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
  const [openAdminSection, setOpenAdminSection] = useState<string>("accounts");
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
    agentIds: [] as string[],
  });
  const [createUserOpen, setCreateUserOpen] = useState(false);
  const [issuedCredentials, setIssuedCredentials] = useState<{
    email: string;
    password: string;
  } | null>(null);
  const [policyDraft, setPolicyDraft] = useState<PolicyDraft>(emptyPolicyDraft);
  const [editingPolicyId, setEditingPolicyId] = useState<string | null>(null);
  const [policyDialogOpen, setPolicyDialogOpen] = useState(false);
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

  const adminSectionProps = useCallback(
    (id: string) => ({
      id,
      open: openAdminSection === id,
      onToggle: () =>
        setOpenAdminSection((current) => (current === id ? "" : id)),
    }),
    [openAdminSection],
  );

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
          delete: "Eliminar",
          accounts: "Cuentas",
          policies: "Políticas autorizadas",
          groups: "Grupos y membresías",
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
          delete: "Delete",
          accounts: "Accounts",
          policies: "Authoritative policies",
          groups: "Groups and membership",
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

  const agents = data?.catalog.agents ?? [];
  const policyOptions = data?.policies ?? [];
  const providers = data?.catalog.providers ?? [];
  const plugins = data?.catalog.plugins ?? [];
  const tools = data?.catalog.tools ?? [];
  const agentOptions = agents.map((agent) => ({
    value: agent.id,
    label: `${agent.displayName} (${agent.id})`,
  }));
  const defaultAgentOptionsForSelection = (agentIds: readonly string[]) =>
    agentIds.length === 0
      ? agents
      : agents.filter((agent) => agentIds.includes(agent.id));
  const defaultAgentOptionsForUser = (user: ManagedUser) => {
    const groupIds = Object.entries(data?.members ?? {})
      .filter(([, memberIds]) => memberIds.includes(user.id))
      .map(([groupId]) => groupId);
    const effectiveGrants = data?.grants.filter(
      (grant) =>
        grant.userId === user.id ||
        (grant.groupId !== null && groupIds.includes(grant.groupId)),
    );
    if (effectiveGrants === undefined || effectiveGrants.length === 0) {
      return agents;
    }
    const counts = new Map<string, number>();
    for (const grant of effectiveGrants) {
      counts.set(grant.agentId, (counts.get(grant.agentId) ?? 0) + 1);
    }
    return agents.filter((agent) => counts.get(agent.id) === 1);
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
  const policyOptionElements = policyOptions.map((policy) => (
    <option key={policy.id} value={policy.id}>
      {policy.id} ({policy.role})
    </option>
  ));
  const modelOptions = [
    ...new Set(
      [
        data?.catalog.defaults.model,
        ...providers.flatMap((provider) => provider.modelIds),
        grantDraft.modelPatterns,
        policyDraft.defaultModel,
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
        { value: "*", label: "All models" },
        ...selectedProviders.flatMap((provider) =>
          provider.modelIds.map((model) => ({
            value: model,
            label: model,
            group: provider.displayName,
          })),
        ),
      ],
      currentValue,
    );
  };
  const grantModelOptions = modelOptionsForProviders(
    grantDraft.providerIds,
    grantDraft.modelPatterns,
  );
  const policyModelOptions = modelOptionsForProviders(
    policyDraft.providerIds,
    policyDraft.modelPatterns,
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
      const created = await requestJson<{
        id: string;
        email: string;
        generatedPassword?: string;
      }>("/access/users", {
        method: "POST",
        body: JSON.stringify({
          email: newUser.email,
          name: newUser.name,
          ...(newUser.password.trim().length === 0
            ? {}
            : { password: newUser.password }),
          role: newUser.role,
          policyId: newUser.policyId,
          defaultAgentId: newUser.defaultAgentId,
        }),
      });
      await requestJson(
        `/access/users/${encodeURIComponent(created.id)}/agents`,
        {
          method: "PUT",
          body: JSON.stringify({ agentIds: newUser.agentIds }),
        },
      );
      const issuedPassword =
        created.generatedPassword ?? newUser.password.trim();
      if (issuedPassword.length > 0) {
        setIssuedCredentials({
          email: created.email,
          password: issuedPassword,
        });
      }
      setNewUser((current) => ({
        ...current,
        email: "",
        name: "",
        password: "",
        defaultAgentId: null,
        agentIds: [],
      }));
      setCreateUserOpen(false);
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
      setPolicyDialogOpen(false);
    });
  };

  const deletePolicy = async (policy: ManagedPolicy) => {
    if (!window.confirm(`Delete policy ${policy.id}? This cannot be undone.`)) {
      return;
    }
    await run(async () => {
      await requestJson(`/access/policies/${encodeURIComponent(policy.id)}`, {
        method: "DELETE",
      });
    });
  };

  const openPolicyDialog = (policy: ManagedPolicy | null) => {
    setEditingPolicyId(policy === null ? null : policy.id);
    setPolicyDraft(
      policy === null ? emptyPolicyDraft() : policyToDraft(policy),
    );
    setPolicyDialogOpen(true);
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

  const setUserAgents = async (user: ManagedUser, agentIds: string[]) => {
    await run(async () => {
      await requestJson(`/access/users/${encodeURIComponent(user.id)}/agents`, {
        method: "PUT",
        body: JSON.stringify({ agentIds }),
      });
    });
  };

  const deleteUser = async (user: ManagedUser) => {
    if (auth?.user?.id === user.id) return;
    if (!window.confirm(`Delete ${user.email}? This cannot be undone.`)) return;
    await run(async () => {
      await requestJson(`/access/users/${encodeURIComponent(user.id)}`, {
        method: "DELETE",
      });
    });
  };

  const userAgentIds = (userId: string): string[] =>
    data === null
      ? []
      : [
          ...new Set(
            data.grants
              .filter((grant) => grant.userId === userId)
              .map((grant) => grant.agentId),
          ),
        ];

  return (
    <PageShell maxWidthClassName="max-w-7xl" contentClassName="pt-6 md:pt-8">
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
                onChange={(event) =>
                  setLocale(event.target.value as "en" | "es")
                }
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
          {...adminSectionProps("catalog")}
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
                  Default:{" "}
                  {agent.defaultProviderId ?? "grant-selected provider"} ·{" "}
                  {agent.defaultModel} · {agent.defaultReasoningLevel}
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
          {...adminSectionProps("accounts")}
          title={copy.accounts}
          description="Only administrators can create accounts, assign agents, change roles, set a default agent, reset passwords, revoke sessions, or delete users. A default agent must be allowed and resolve to one complete execution grant."
        >
          <div className="overflow-x-auto rounded-lg border border-border">
            {issuedCredentials !== null ? (
              <div className="mb-5">
                <CredentialsPanel
                  email={issuedCredentials.email}
                  password={issuedCredentials.password}
                  onDone={() => setIssuedCredentials(null)}
                />
              </div>
            ) : null}
            <table className="w-full min-w-[1440px] text-left text-sm">
              <thead className="bg-surface-recessed text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Account</th>
                  <th className="px-3 py-2">Role</th>
                  <th className="px-3 py-2">Policy</th>
                  <th className="px-3 py-2">Agents</th>
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
                        aria-label={`Policy for ${user.email}`}
                        value={user.policyId}
                        onChange={(event) =>
                          void updateUser(user, {
                            policyId: event.target.value,
                          })
                        }
                        className="h-8 rounded-md border border-input bg-transparent px-2 text-xs"
                      >
                        {policyOptionElements}
                      </select>
                    </td>
                    <td className="px-3 py-3">
                      <MultiSelectField
                        label={`Agents for ${user.email}`}
                        options={agentOptions}
                        selected={userAgentIds(user.id)}
                        onChange={(agentIds) =>
                          void setUserAgents(user, agentIds)
                        }
                      />
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
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={auth?.user?.id === user.id}
                          onClick={() => void deleteUser(user)}
                        >
                          {copy.delete}
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
                              const password = String(
                                form.get("password") ?? "",
                              ).trim();
                              void run(async () => {
                                const result = await requestJson<{
                                  generatedPassword?: string;
                                }>(
                                  `/access/users/${encodeURIComponent(user.id)}/reset-password`,
                                  {
                                    method: "POST",
                                    body: JSON.stringify(
                                      password.length === 0 ? {} : { password },
                                    ),
                                  },
                                );
                                event.currentTarget.reset();
                                const issued =
                                  result.generatedPassword ?? password;
                                if (issued.length > 0) {
                                  setIssuedCredentials({
                                    email: user.email,
                                    password: issued,
                                  });
                                }
                              });
                            }}
                          >
                            <Input
                              name="password"
                              type="password"
                              minLength={12}
                              autoComplete="new-password"
                              placeholder="Empty = generate"
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
          <div className="mt-5">
            <Button type="button" onClick={() => setCreateUserOpen(true)}>
              <Icon name="Plus" className="size-4" aria-hidden />
              New account
            </Button>
          </div>
          <Dialog open={createUserOpen} onOpenChange={setCreateUserOpen}>
            <DialogContent className="sm:max-w-2xl">
              <DialogHeader>
                <DialogTitle>New account</DialogTitle>
                <DialogDescription>
                  Create an account and assign its agents. A default agent must
                  be allowed and resolve to one complete execution grant.
                </DialogDescription>
              </DialogHeader>
              <form className="grid gap-3 md:grid-cols-2" onSubmit={createUser}>
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
                    placeholder="Leave empty to generate"
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
                  onChange={(policyId) => setNewUser({ ...newUser, policyId })}
                >
                  {policyOptionElements}
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
                  {defaultAgentOptionsForSelection(newUser.agentIds).map(
                    (agent) => (
                      <option key={agent.id} value={agent.id}>
                        {agent.displayName}
                      </option>
                    ),
                  )}
                </SelectField>
                <div className="md:col-span-2">
                  <MultiSelectField
                    label="Agents"
                    options={agentOptions}
                    selected={newUser.agentIds}
                    onChange={(agentIds) =>
                      setNewUser({
                        ...newUser,
                        agentIds,
                        defaultAgentId: defaultAgentOptionsForSelection(
                          agentIds,
                        ).some((agent) => agent.id === newUser.defaultAgentId)
                          ? newUser.defaultAgentId
                          : null,
                      })
                    }
                  />
                </div>
                <DialogFooter className="md:col-span-2">
                  <Button type="submit">{copy.create}</Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </Section>

        <Section
          {...adminSectionProps("policies")}
          title={copy.policies}
          description="Policies are default-deny and assigned per user, group, and invitation. Fixed execution pins one usable provider, model, reasoning level, and permission mode."
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
                    {policy.role} · revision {policy.revision} ·{" "}
                    {formatDate(policy.updatedAt)}
                  </span>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => openPolicyDialog(policy)}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={policy.id === "admin" || policy.id === "user"}
                    onClick={() => void deletePolicy(policy)}
                  >
                    {copy.delete}
                  </Button>
                </div>
              </div>
            ))}
            {data.policies.length === 0 ? (
              <p className="text-muted-foreground">{copy.empty}</p>
            ) : null}
          </div>
          <div className="mt-5">
            <Button type="button" onClick={() => openPolicyDialog(null)}>
              <Icon name="Plus" className="size-4" aria-hidden />
              New policy
            </Button>
          </div>
          <Dialog open={policyDialogOpen} onOpenChange={setPolicyDialogOpen}>
            <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
              <DialogHeader>
                <DialogTitle>
                  {editingPolicyId === null ? "New policy" : "Edit policy"}
                </DialogTitle>
                <DialogDescription>
                  Empty selections and the wildcard entry mean unrestricted.
                  Fixed execution requires exactly one provider, model, and
                  reasoning level that match the defaults.
                </DialogDescription>
              </DialogHeader>
              <form className="space-y-4" onSubmit={savePolicy}>
                <div className="grid gap-3 md:grid-cols-2">
                  <Field id="admin-policy-id" label="Policy ID">
                    <Input
                      id="admin-policy-id"
                      value={policyDraft.id}
                      disabled={editingPolicyId !== null}
                      onChange={(event) =>
                        setPolicyDraft({
                          ...policyDraft,
                          id: event.target.value,
                        })
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
                <MultiSelectField
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
                  <MultiSelectField
                    label="Allowed providers"
                    options={providerOptions}
                    selected={policyDraft.providerIds}
                    onChange={(providerIds) =>
                      setPolicyDraft({ ...policyDraft, providerIds })
                    }
                  />
                )}
                <div className="grid gap-3 md:grid-cols-2">
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
                    <DelimitedMultiSelectField
                      label="Allowed model IDs"
                      options={policyModelOptions}
                      value={policyDraft.modelPatterns}
                      onChange={(modelPatterns) =>
                        setPolicyDraft({ ...policyDraft, modelPatterns })
                      }
                    />
                  )}
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
                    <MultiSelectField
                      label="Allowed reasoning levels"
                      options={reasoningLevels.map((level) => ({
                        value: level,
                        label: level,
                      }))}
                      selected={policyDraft.reasoningLevels}
                      onChange={(values) =>
                        setPolicyDraft({
                          ...policyDraft,
                          reasoningLevels: values as ReasoningLevel[],
                        })
                      }
                    />
                  )}
                </div>
                <div className="grid gap-3 md:grid-cols-3">
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
                  <SelectField
                    disabled={policyDraft.fixedExecution}
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
                  <DelimitedMultiSelectField
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
                  <DelimitedMultiSelectField
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
                <DialogFooter>
                  <Button type="submit">
                    {editingPolicyId === null ? copy.create : copy.update}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </Section>

        <Section
          {...adminSectionProps("invitations")}
          title={copy.invitations}
          description="Provide a one-time token through a separate secure channel; only its hash is stored by the server."
        >
          <form
            className="grid gap-3 md:grid-cols-2 xl:grid-cols-4"
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
              onChange={(policyId) =>
                setInvitation({ ...invitation, policyId })
              }
            >
              {policyOptionElements}
            </SelectField>
            <div className="md:col-span-2 xl:col-span-4">
              <Button type="submit">Create invitation</Button>
            </div>
          </form>
        </Section>

        <div className="grid gap-6 xl:grid-cols-2">
          <Section
            {...adminSectionProps("groups")}
            title={copy.groups}
            description="Replace membership atomically."
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
                <SelectField
                  id="admin-group-policy"
                  label="Policy"
                  value={groupDraft.policyId}
                  onChange={(policyId) =>
                    setGroupDraft({ ...groupDraft, policyId })
                  }
                >
                  {policyOptionElements}
                </SelectField>
              </div>
              <MultiSelectField
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
            {...adminSectionProps("grants")}
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
                <MultiSelectField
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
                  <DelimitedMultiSelectField
                    label="Allowed model IDs"
                    options={grantModelOptions}
                    value={grantDraft.modelPatterns}
                    onChange={(modelPatterns) =>
                      setGrantDraft({ ...grantDraft, modelPatterns })
                    }
                  />
                )}
                <DelimitedMultiSelectField
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
                <DelimitedMultiSelectField
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
                <MultiSelectField
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
          {...adminSectionProps("resources")}
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
          {...adminSectionProps("instructions")}
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
          {...adminSectionProps("audit")}
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
    </PageShell>
  );
}
