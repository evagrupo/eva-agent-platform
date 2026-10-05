import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  definePluginApp,
  experimental_NewThreadComposer as NewThreadComposer,
  experimental_useSidebarThreadActions,
  experimental_useSidebarThreadSplit,
  experimental_useSidebarThreads,
  useBbNavigate,
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import type {
  PluginSidebarThread,
  PluginSidebarProject,
  PluginSidebarThreadActions,
  PluginThreadListProps,
  NewThreadRequest,
} from "@get-bb/plugin-sdk/app";
import GoogleIcon from "@hugeicons/core-free-icons/GoogleIcon";
import MetaIcon from "@hugeicons/core-free-icons/MetaIcon";
import TiktokIcon from "@hugeicons/core-free-icons/TiktokIcon";
import { HugeiconsIcon } from "@hugeicons/react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { toast } from "sonner";
import type { EvaAgent, EvaRecentThread, rpcContract } from "./server";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Icon, type IconName } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import {
  IndicatorStatusGlyph,
  StatusCluster,
  StatusGlyph,
} from "./src/StatusGlyph";
import { countStatuses } from "./src/status";
import { createEvaAgentThread } from "./src/create-agent-thread";
import { listAgentThreadBindings } from "./src/list-agent-thread-bindings";

type AgentRoster = {
  agents: EvaAgent[];
  rootProjectId: string | null;
  summary: { conversationsThisWeek: number };
};

type AgentDetail = {
  agent: EvaAgent;
  threads: EvaRecentThread[];
  projectId: string | null;
  hostId: string | null;
  workspacePath: string | null;
};

const EVA_DEFAULT_MODEL = "gpt-5.6-luna";
const EVA_DEFAULT_REASONING_LEVEL = "max" as const;

const AGENT_ICON_MAP: Readonly<Record<string, IconName>> = {
  Network: "Workflow",
  ShieldCheck: "SecurityCheck",
  Sparkles: "Zap",
  Megaphone: "MessageSquare",
  Music2: "Mic",
  Search: "Search",
  PhoneCall: "MessageSquare",
  Mail: "Mail",
  Mic: "Mic",
  CreditCard: "Target",
  Users: "UserRound",
};

// The Spanish names remain the canonical values in the EVA database. The
// English source labels are translated back to Spanish by the Spanish
// Localization plugin when Spanish is selected, so the same UI works in both
// directions without changing persisted agent records.
const ENGLISH_AGENT_NAMES: Readonly<Record<string, string>> = {
  orchestrator: "Master Orchestrator",
  compliance: "Compliance",
  creative: "Creativity",
  meta: "Meta",
  tiktok: "TikTok",
  google: "Google",
  crm: "CRM & Call Center",
  email: "Email",
  voice: "AI Voice",
  recobro: "Payments",
  people: "HR",
};

const ENGLISH_AGENT_TAGLINES: Readonly<Record<string, string>> = {
  orchestrator: "Chooses which agent acts and keeps work within bounds",
  compliance: "Reviews and approves everything that goes public",
  creative: "Creates ads, images, videos, and pages",
  meta: "Facebook and Instagram campaigns",
  tiktok: "TikTok campaigns and creative",
  google: "Google search, keywords, and campaigns",
  crm: "Lead queue, operators, and first calls",
  email: "Classifies email and creates tasks",
  voice: "Calls and voice experiences for the app and web",
  recobro: "Failed payments and returns through collection",
  people: "Team productivity and capacity",
};

function agentDisplayName(agent: Pick<EvaAgent, "slug" | "name">): string {
  return ENGLISH_AGENT_NAMES[agent.slug] ?? agent.name;
}

function agentDisplayTagline(
  agent: Pick<EvaAgent, "slug" | "tagline">,
): string {
  return ENGLISH_AGENT_TAGLINES[agent.slug] ?? agent.tagline;
}

/** Keep absolute paths for BB operations, but make them readable in the UI. */
function compactWorkspacePath(path: string): string {
  const homePrefix = path.match(/^\/home\/[^/]+(?=\/|$)/)?.[0];
  if (homePrefix)
    return path === homePrefix ? "~" : "~" + path.slice(homePrefix.length);
  const macHomePrefix = path.match(/^\/Users\/[^/]+(?=\/|$)/)?.[0];
  if (macHomePrefix)
    return path === macHomePrefix
      ? "~"
      : "~" + path.slice(macHomePrefix.length);
  return path;
}

function agentWorkspaceLabel(slug: string): string {
  return slug === "orchestrator" ? "Agents root" : "Specialist folder";
}

function slugifyAgentName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function relativeTime(timestamp: number | null): string {
  if (timestamp === null) return "No activity yet";
  const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return "Now";
  if (minutes < 60)
    return minutes + (minutes === 1 ? " minute ago" : " minutes ago");
  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours + (hours === 1 ? " hour ago" : " hours ago");
  const days = Math.round(hours / 24);
  if (days < 7) return days + (days === 1 ? " day ago" : " days ago");
  const weeks = Math.round(days / 7);
  return weeks + (weeks === 1 ? " week ago" : " weeks ago");
}

function AgentIcon({ icon, className }: { icon: string; className?: string }) {
  if (icon === "Meta") {
    return (
      <HugeiconsIcon icon={MetaIcon} className={className} aria-hidden="true" />
    );
  }
  if (icon === "TikTok") {
    return (
      <HugeiconsIcon
        icon={TiktokIcon}
        className={className}
        aria-hidden="true"
      />
    );
  }
  if (icon === "Google") {
    return (
      <HugeiconsIcon
        icon={GoogleIcon}
        className={className}
        aria-hidden="true"
      />
    );
  }
  return (
    <Icon
      name={AGENT_ICON_MAP[icon] ?? "Bot"}
      className={className}
      aria-hidden="true"
    />
  );
}

function StatusBadge({ status }: { status: EvaAgent["status"] }) {
  const styles = {
    draft: "border-border bg-muted text-muted-foreground",
    shadow: "border-primary/20 bg-primary/10 text-primary",
    live: "border-success/20 bg-success/10 text-success",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
        styles[status],
      )}
    >
      {status}
    </span>
  );
}

function ProviderMark({ agent }: { agent: EvaAgent }) {
  if (!agent.provider) return null;
  return (
    <span
      title={"Pinned to " + agent.provider}
      className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground"
    >
      <Icon name="Bot" className="size-3" aria-hidden="true" />
      {agent.provider}
    </span>
  );
}

function LoadingCards() {
  return (
    <div className="h-full min-h-0 overflow-y-auto">
      <div
        aria-label="Loading agents"
        className="mx-auto w-full max-w-6xl space-y-5 px-4 pb-6 pt-4 md:px-5"
      >
        <header className="space-y-2">
          <div className="h-7 w-32 animate-pulse rounded bg-muted" />
          <div className="h-4 w-80 max-w-full animate-pulse rounded bg-muted" />
        </header>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 11 }, (_, index) => (
            <div
              key={index}
              className="h-40 animate-pulse rounded-lg border border-border bg-muted/40"
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function PageError({ message, retry }: { message: string; retry: () => void }) {
  return (
    <div
      role="alert"
      className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm"
    >
      <p className="font-medium text-destructive">
        Agents could not be loaded.
      </p>
      <p className="mt-1 text-muted-foreground">{message}</p>
      <Button className="mt-3" variant="outline" size="sm" onClick={retry}>
        Retry
      </Button>
    </div>
  );
}

function useAgentRoster() {
  const rpc = useRpc<typeof rpcContract>();
  const connection = useRealtimeConnectionState();
  const [roster, setRoster] = useState<AgentRoster | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    try {
      const next = await rpc.call("agents_list");
      setRoster(next);
      setError(null);
    } catch (cause) {
      setError(errorText(cause));
    }
  }, [rpc]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  useEffect(() => {
    if (connection === "connected") void refetch();
  }, [connection, refetch]);

  useRealtime("agents-changed", () => {
    void refetch();
  });

  return { rpc, roster, error, refetch };
}

function useAgentThreadBindings(
  enabled: boolean,
  refreshKey: string,
): ReadonlyMap<string, string> {
  const [bindings, setBindings] = useState<ReadonlyMap<string, string>>(
    () => new Map(),
  );

  useEffect(() => {
    if (!enabled) {
      setBindings(new Map());
      return;
    }

    const controller = new AbortController();
    setBindings(new Map());
    void listAgentThreadBindings(controller.signal)
      .then((next) => {
        if (!controller.signal.aborted) setBindings(next);
      })
      .catch(() => {
        if (!controller.signal.aborted) setBindings(new Map());
      });

    return () => controller.abort();
  }, [enabled, refreshKey]);

  return bindings;
}

function useAgentDetail(slug: string) {
  const rpc = useRpc<typeof rpcContract>();
  const connection = useRealtimeConnectionState();
  const [detail, setDetail] = useState<AgentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    try {
      const next = await rpc.call("agents_get", { slug });
      setDetail(next);
      setError(null);
    } catch (cause) {
      setError(errorText(cause));
    }
  }, [rpc, slug]);

  useEffect(() => {
    setDetail(null);
    void refetch();
  }, [refetch]);

  useEffect(() => {
    if (connection === "connected") void refetch();
  }, [connection, refetch]);

  useRealtime("agents-changed", () => {
    void refetch();
  });

  return { rpc, detail, error, refetch };
}

function AgentCard({ agent }: { agent: EvaAgent }) {
  const navigate = useBbNavigate();
  return (
    <button
      type="button"
      onClick={() => navigate.toPluginPanel("agents", { subPath: agent.slug })}
      className="group flex min-h-40 w-full flex-col rounded-lg border border-border bg-card p-4 text-left transition-colors hover:bg-state-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid size-9 shrink-0 place-items-center rounded-md bg-muted text-foreground">
            <AgentIcon icon={agent.icon} className="size-4" />
          </span>
          <span className="min-w-0">
            <span className="block truncate font-medium">
              {agentDisplayName(agent)}
            </span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              {agent.slug}
            </span>
          </span>
        </div>
        <StatusBadge status={agent.status} />
      </div>
      <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">
        {agentDisplayTagline(agent)}
      </p>
      <div className="mt-auto flex items-end justify-between gap-2 pt-4">
        <span className="text-xs text-muted-foreground">
          {`${agent.threadCount} conversations`}
          <span className="mt-0.5 block">
            {relativeTime(agent.lastActivityAt)}
          </span>
        </span>
        <ProviderMark agent={agent} />
      </div>
    </button>
  );
}

function AgentsRoster() {
  const { roster, error, refetch } = useAgentRoster();
  const navigate = useBbNavigate();

  if (error) return <PageError message={error} retry={() => void refetch()} />;
  if (!roster) return <LoadingCards />;

  const live = roster.agents.filter((agent) => agent.status === "live").length;
  const shadow = roster.agents.filter(
    (agent) => agent.status === "shadow",
  ).length;

  return (
    <div className="h-full min-h-0 overflow-y-auto">
      <div className="mx-auto w-full max-w-6xl space-y-5 px-4 pb-6 pt-4 md:px-5">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Agents</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {`${roster.agents.length} agents · ${live} live · ${shadow} shadow · ${roster.summary.conversationsThisWeek} conversations this week`}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Shared BB project · Orchestrator owns the agents root ·
              specialists use isolated folders
            </p>
          </div>
          <Button
            onClick={() => navigate.toPluginPanel("agents", { subPath: "new" })}
          >
            <Icon name="Plus" className="size-4" />
            New agent
          </Button>
        </header>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {roster.agents.map((agent) => (
            <AgentCard key={agent.slug} agent={agent} />
          ))}
        </div>
      </div>
    </div>
  );
}

function CreateAgentPage() {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [tagline, setTagline] = useState("");
  const [instructions, setInstructions] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const normalizedSlug = slugifyAgentName(slug);
  const slugIsValid =
    normalizedSlug === slug &&
    /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(slug) &&
    slug !== "new";
  const canSubmit =
    name.trim().length > 0 &&
    tagline.trim().length > 0 &&
    instructions.trim().length > 0 &&
    slugIsValid &&
    !submitting;

  const changeName = (next: string) => {
    setName(next);
    if (!slugTouched) setSlug(slugifyAgentName(next));
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    if (!canSubmit) {
      setError("Complete every field and use a valid agent id.");
      return;
    }
    setSubmitting(true);
    try {
      const result = await rpc.call("agents_create", {
        name: name.trim(),
        slug,
        tagline: tagline.trim(),
        instructions: instructions.trim(),
      });
      toast.success("Agent created", {
        description: `Workspace: ${compactWorkspacePath(result.workspacePath)}`,
      });
      navigate.toPluginPanel("agents", { subPath: result.agent.slug });
    } catch (cause) {
      const message = errorText(cause);
      setError(message);
      toast.error("Agent could not be created", { description: message });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="h-full min-h-0 overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-4 pb-8 pt-4 md:px-5">
        <button
          type="button"
          onClick={() => navigate.toPluginPanel("agents")}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <Icon name="ChevronLeft" className="size-4" aria-hidden="true" />
          All agents
        </button>

        <header className="mt-5">
          <h1 className="text-xl font-semibold tracking-tight">New agent</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Create a specialist with its own folder, instructions, skills, and
            CLI tools inside the shared EVA project.
          </p>
        </header>

        <form onSubmit={submit} className="mt-6 space-y-5" noValidate>
          {error ? (
            <div
              role="alert"
              className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
            >
              {error}
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="new-agent-name" className="text-sm font-medium">
                Name
              </label>
              <Input
                id="new-agent-name"
                value={name}
                maxLength={80}
                autoFocus
                onChange={(event) => changeName(event.target.value)}
                placeholder="Example: Sales analyst"
                className="mt-1.5"
                required
              />
            </div>
            <div>
              <label htmlFor="new-agent-slug" className="text-sm font-medium">
                Agent id
              </label>
              <Input
                id="new-agent-slug"
                value={slug}
                maxLength={64}
                onChange={(event) => {
                  setSlugTouched(true);
                  setSlug(event.target.value.toLocaleLowerCase());
                }}
                placeholder="analista-ventas"
                className="mt-1.5 font-mono"
                aria-describedby="new-agent-slug-help"
                aria-invalid={slug.length > 0 && !slugIsValid}
                required
              />
              <p
                id="new-agent-slug-help"
                className={cn(
                  "mt-1.5 text-xs",
                  slug.length > 0 && !slugIsValid
                    ? "text-destructive"
                    : "text-muted-foreground",
                )}
              >
                Lowercase letters, numbers, and hyphens. This also becomes its
                folder name and @ mention.
              </p>
            </div>
          </div>

          <div>
            <label htmlFor="new-agent-tagline" className="text-sm font-medium">
              Short mandate
            </label>
            <Input
              id="new-agent-tagline"
              value={tagline}
              maxLength={180}
              onChange={(event) => setTagline(event.target.value)}
              placeholder="What work this agent should own"
              className="mt-1.5"
              required
            />
          </div>

          <div>
            <label
              htmlFor="new-agent-instructions"
              className="text-sm font-medium"
            >
              Instructions
            </label>
            <p
              id="new-agent-instructions-help"
              className="mt-1 text-sm text-muted-foreground"
            >
              Saved as{" "}
              <span className="font-mono text-foreground">AGENTS.md</span>{" "}
              inside the agent folder. Native provider files and BB&apos;s
              bridge point to it.
            </p>
            <textarea
              id="new-agent-instructions"
              value={instructions}
              maxLength={16_000}
              onChange={(event) => setInstructions(event.target.value)}
              aria-describedby="new-agent-instructions-help"
              placeholder="Describe goals, working style, limits, and when to delegate…"
              className="mt-2 min-h-56 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm leading-6 outline-none focus-visible:ring-1 focus-visible:ring-ring"
              required
            />
          </div>

          <div className="rounded-lg border border-border bg-card p-3 text-sm text-muted-foreground">
            <p>
              Folder:{" "}
              <span className="font-mono text-foreground">
                agents/{slug || "agent-id"}/
              </span>
            </p>
            <p className="mt-1">
              EVA keeps this specialist isolated in its folder while all agent
              conversations use the configured shared BB project. The
              Orchestrator owns the agents root.
            </p>
            <p className="mt-1">
              The folder includes{" "}
              <span className="font-mono text-foreground">.bb/skills/</span>,{" "}
              <span className="font-mono text-foreground">bin/</span>, and the
              instructions file.
            </p>
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => navigate.toPluginPanel("agents")}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              <Icon name="Plus" className="size-4" />
              {submitting ? "Creating…" : "Create agent"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function AgentStatusControl({
  value,
  onChange,
  disabled,
}: {
  value: EvaAgent["status"];
  onChange: (next: EvaAgent["status"]) => void;
  disabled: boolean;
}) {
  const options: EvaAgent["status"][] = ["draft", "shadow", "live"];
  return (
    <div
      role="radiogroup"
      aria-label="Agent status"
      className="inline-flex rounded-md border border-border bg-muted p-0.5"
    >
      {options.map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={option === value}
          disabled={disabled}
          onClick={() => onChange(option)}
          className={cn(
            "rounded-[5px] px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50",
            option === value
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

function AgentDetail({ slug }: { slug: string }) {
  const navigate = useBbNavigate();
  const { rpc, detail, error, refetch } = useAgentDetail(slug);
  const [instructions, setInstructions] = useState("");
  const [savedInstructions, setSavedInstructions] = useState("");
  const [skills, setSkills] = useState<EvaAgent["skills"]>([]);
  const [savedSkills, setSavedSkills] = useState<EvaAgent["skills"]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!detail) return;
    setInstructions(detail.agent.instructions);
    setSavedInstructions(detail.agent.instructions);
    setSkills(detail.agent.skills);
    setSavedSkills(detail.agent.skills);
  }, [detail?.agent.slug, detail?.agent.updatedAt]);

  if (error) return <PageError message={error} retry={() => void refetch()} />;
  if (!detail) {
    return (
      <div className="h-full min-h-0 overflow-y-auto px-4 py-4 md:px-5">
        <div className="mx-auto max-w-4xl animate-pulse space-y-4">
          <div className="h-8 w-52 rounded bg-muted" />
          <div className="h-10 w-full rounded bg-muted" />
          <div className="h-64 w-full rounded bg-muted" />
        </div>
      </div>
    );
  }

  const { agent, threads } = detail;
  const isDirty = instructions !== savedInstructions;
  const skillsDirty = JSON.stringify(skills) !== JSON.stringify(savedSkills);

  const updateStatus = async (status: EvaAgent["status"]) => {
    if (status === agent.status || saving) return;
    setSaving(true);
    try {
      await rpc.call("agents_update", { slug: agent.slug, status });
      toast.success("Status saved");
      await refetch();
    } catch (cause) {
      toast.error(errorText(cause));
    } finally {
      setSaving(false);
    }
  };

  const saveInstructions = async () => {
    if (!isDirty || saving) return;
    setSaving(true);
    try {
      const result = await rpc.call("agents_update", {
        slug: agent.slug,
        instructions,
      });
      setInstructions(result.agent.instructions);
      setSavedInstructions(result.agent.instructions);
      toast.success("Instructions saved");
      await refetch();
    } catch (cause) {
      toast.error(errorText(cause));
    } finally {
      setSaving(false);
    }
  };

  const saveSkills = async () => {
    if (!skillsDirty || saving) return;
    const incomplete = skills.find(
      (skill) => !skill.name.trim() || !skill.instructions.trim(),
    );
    if (incomplete) {
      toast.error("Every skill needs a name and instructions.");
      return;
    }
    setSaving(true);
    try {
      const result = await rpc.call("agents_update", {
        slug: agent.slug,
        skills,
      });
      setSkills(result.agent.skills);
      setSavedSkills(result.agent.skills);
      toast.success("Skills saved");
      await refetch();
    } catch (cause) {
      toast.error(errorText(cause));
    } finally {
      setSaving(false);
    }
  };

  const addSkill = () => {
    setSkills((current) => [
      ...current,
      {
        id: `skill-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: "",
        instructions: "",
      },
    ]);
  };

  const updateSkill = (
    id: string,
    field: "name" | "instructions",
    value: string,
  ) => {
    setSkills((current) =>
      current.map((skill) =>
        skill.id === id ? { ...skill, [field]: value } : skill,
      ),
    );
  };

  const startConversation = () => {
    navigate.toPluginPanel("agents", { subPath: agent.slug + "/new" });
  };

  return (
    <div className="h-full min-h-0 overflow-y-auto">
      <div className="mx-auto w-full max-w-4xl space-y-6 px-4 pb-6 pt-4 md:px-5">
        <button
          type="button"
          onClick={() => navigate.toPluginPanel("agents")}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <Icon name="ChevronLeft" className="size-4" aria-hidden="true" />
          All agents
        </button>

        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-md bg-muted">
              <AgentIcon icon={agent.icon} className="size-5" />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-semibold tracking-tight">
                  {agentDisplayName(agent)}
                </h1>
                <StatusBadge status={agent.status} />
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {agentDisplayTagline(agent)}
              </p>
            </div>
          </div>
          <Button onClick={startConversation}>
            <Icon name="MessageSquarePlus" className="size-4" />
            Start conversation
          </Button>
        </header>

        <section className="rounded-lg border border-border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-medium">Operating status</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                The mode is added to the instructions for each new session.
              </p>
            </div>
            <AgentStatusControl
              value={agent.status}
              onChange={(status) => void updateStatus(status)}
              disabled={saving}
            />
          </div>
        </section>

        <section>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="font-medium">Custom instructions</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                This editor changes <span className="font-mono">AGENTS.md</span>{" "}
                directly. Native provider files and BB&apos;s bridge load it for
                the agent&apos;s next session.
              </p>
            </div>
            <Button
              variant={isDirty ? "default" : "outline"}
              onClick={() => void saveInstructions()}
              disabled={!isDirty || saving}
            >
              <Icon name="Check" className="size-4" />
              Save
            </Button>
          </div>
          <textarea
            value={instructions}
            onChange={(event) => setInstructions(event.target.value)}
            className="mt-3 min-h-56 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm leading-6 outline-none focus-visible:ring-1 focus-visible:ring-ring"
            aria-label="Custom instructions"
          />
          <p className="mt-2 text-xs text-muted-foreground">
            {isDirty ? "Unsaved changes" : "Everything saved"}
          </p>
        </section>

        <section>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="font-medium">Custom skills</h2>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                Each skill is saved as a native BB skill in this agent&apos;s
                <span className="font-mono"> .bb/skills/</span> folder.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={addSkill}
                disabled={saving || skills.length >= 16}
              >
                <Icon name="Plus" className="size-4" />
                Add skill
              </Button>
              <Button
                variant={skillsDirty ? "default" : "outline"}
                onClick={() => void saveSkills()}
                disabled={!skillsDirty || saving}
              >
                <Icon name="Check" className="size-4" />
                Save
              </Button>
            </div>
          </div>
          {skills.length === 0 ? (
            <div className="mt-3 rounded-lg border border-dashed border-border px-4 py-6 text-center">
              <p className="text-sm font-medium">No custom skills</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Add a capability with specific rules for this agent.
              </p>
              <Button
                className="mt-3"
                variant="outline"
                size="sm"
                onClick={addSkill}
              >
                <Icon name="Plus" className="size-4" />
                Add skill
              </Button>
            </div>
          ) : (
            <div className="mt-3 space-y-3">
              {skills.map((skill, index) => {
                const nameId = `agent-skill-name-${skill.id}`;
                const instructionsId = `agent-skill-instructions-${skill.id}`;
                return (
                  <fieldset
                    key={skill.id}
                    className="rounded-lg border border-border bg-card p-3"
                  >
                    <legend className="sr-only">Skill {index + 1}</legend>
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <label
                          htmlFor={nameId}
                          className="text-xs font-medium text-muted-foreground"
                        >
                          Skill name
                        </label>
                        <Input
                          id={nameId}
                          value={skill.name}
                          maxLength={80}
                          onChange={(event) =>
                            updateSkill(skill.id, "name", event.target.value)
                          }
                          className="mt-1"
                          placeholder="Example: Campaign research"
                        />
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Delete skill ${skill.name || index + 1}`}
                        onClick={() =>
                          setSkills((current) =>
                            current.filter((item) => item.id !== skill.id),
                          )
                        }
                      >
                        <Icon
                          name="Trash2"
                          className="size-4 text-destructive"
                        />
                      </Button>
                    </div>
                    <label
                      htmlFor={instructionsId}
                      className="mt-3 block text-xs font-medium text-muted-foreground"
                    >
                      How this skill should be applied
                    </label>
                    <textarea
                      id={instructionsId}
                      value={skill.instructions}
                      maxLength={2_000}
                      onChange={(event) =>
                        updateSkill(
                          skill.id,
                          "instructions",
                          event.target.value,
                        )
                      }
                      className="mt-1 min-h-28 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm leading-6 outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      placeholder="Describe the process, limits, and expected result."
                    />
                  </fieldset>
                );
              })}
            </div>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            {skillsDirty ? "Unsaved changes" : `${skills.length} of 16 skills`}
          </p>
        </section>

        <section className="rounded-lg border border-border bg-card p-4">
          <h2 className="font-medium">Provider</h2>
          {agent.provider ? (
            <p className="mt-1 text-sm text-muted-foreground">
              Pinned to{" "}
              <span className="font-mono text-foreground">
                {agent.provider}
              </span>
              {agent.model ? (
                <>
                  {" · "}
                  <span className="font-mono text-foreground">
                    {agent.model}
                  </span>
                </>
              ) : null}
            </p>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">
              Uses BB&apos;s normal provider resolution.
            </p>
          )}
        </section>

        <section className="rounded-lg border border-border bg-card p-4">
          <h2 className="font-medium">Agent workspace</h2>
          {detail.workspacePath ? (
            <>
              <div
                className="mt-2 flex min-w-0 items-center gap-2 text-sm"
                title={compactWorkspacePath(detail.workspacePath)}
              >
                <Icon
                  name="Folder"
                  className="size-4 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
                <div className="min-w-0">
                  <span className="block text-xs text-muted-foreground">
                    {agentWorkspaceLabel(agent.slug)}
                  </span>
                  <span className="block truncate font-mono font-medium text-foreground">
                    {compactWorkspacePath(detail.workspacePath)}
                  </span>
                </div>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                All EVA conversations use the configured shared BB project. The
                Orchestrator works from the agents root; specialists stay
                isolated in their own folder.
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                Instructions in <span className="font-mono">AGENTS.md</span>,
                Claude bridge in <span className="font-mono">CLAUDE.md</span>,
                skills in <span className="font-mono">.bb/skills/</span>, and
                CLI tools in <span className="font-mono">bin/</span>.
              </p>
            </>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">
              Configure the agents root folder in Extensions → EVA Agents.
            </p>
          )}
        </section>

        <section>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="font-medium">Recent conversations</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {`${agent.threadCount} conversations linked to this agent.`}
              </p>
            </div>
          </div>
          {threads.length === 0 ? (
            <div className="mt-3 rounded-lg border border-dashed border-border px-4 py-6 text-center">
              <p className="text-sm text-muted-foreground">
                No conversations yet
              </p>
              <Button
                className="mt-3"
                variant="outline"
                size="sm"
                onClick={startConversation}
              >
                Start a conversation
              </Button>
            </div>
          ) : (
            <ul className="mt-3 overflow-hidden rounded-lg border border-border bg-card">
              {threads.map((thread) => (
                <li
                  key={thread.id}
                  className="border-b border-border last:border-b-0"
                >
                  <button
                    type="button"
                    onClick={() => navigate.toThread(thread.id)}
                    className="flex w-full items-center gap-2 px-3 py-3 text-left text-sm hover:bg-state-hover"
                  >
                    <span className="flex size-4 shrink-0 items-center justify-center">
                      <IndicatorStatusGlyph
                        indicator={thread.indicator}
                        colored
                      />
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      {thread.title}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {relativeTime(thread.updatedAt)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function AgentThreadComposer({ slug }: { slug: string }) {
  const navigate = useBbNavigate();
  const { rpc, detail, error, refetch } = useAgentDetail(slug);

  if (error) return <PageError message={error} retry={() => void refetch()} />;
  if (!detail) {
    return (
      <div className="h-full min-h-0 overflow-y-auto px-4 py-4 md:px-5">
        <div className="mx-auto max-w-4xl animate-pulse space-y-4">
          <div className="h-8 w-64 rounded bg-muted" />
          <div className="h-64 w-full rounded bg-muted" />
        </div>
      </div>
    );
  }

  const { agent, projectId } = detail;
  if (!projectId) {
    return (
      <div className="h-full min-h-0 overflow-y-auto px-4 py-4 md:px-5">
        <div className="mx-auto max-w-4xl rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <p className="font-medium text-destructive">
            The shared EVA project is not configured.
          </p>
          <p className="mt-1 text-muted-foreground">
            Configure EVA&apos;s shared BB project in Extensions → EVA Agents
            before starting a conversation.
          </p>
          <Button
            className="mt-3"
            variant="outline"
            size="sm"
            onClick={() =>
              navigate.toPluginPanel("agents", { subPath: agent.slug })
            }
          >
            Back to agent
          </Button>
        </div>
      </div>
    );
  }
  if (!detail.workspacePath) {
    return (
      <div className="h-full min-h-0 overflow-y-auto px-4 py-4 md:px-5">
        <div className="mx-auto max-w-4xl rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <p className="font-medium text-destructive">
            The agents workspace is not configured.
          </p>
          <p className="mt-1 text-muted-foreground">
            Configure the agents root folder in Extensions → EVA Agents.
          </p>
        </div>
      </div>
    );
  }

  const submit = async (request: NewThreadRequest) => {
    try {
      const threadId = await createEvaAgentThread({
        agentId: agent.slug,
        agentName: agentDisplayName(agent),
        request,
      });
      toast.success("Conversation started");
      navigate.toThread(threadId);
    } catch (cause) {
      toast.error(errorText(cause));
      throw cause;
    }
  };

  return (
    <div className="h-full min-h-0 overflow-y-auto">
      <div className="mx-auto w-full max-w-4xl space-y-5 px-4 pb-6 pt-4 md:px-5">
        <button
          type="button"
          onClick={() =>
            navigate.toPluginPanel("agents", { subPath: agent.slug })
          }
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <Icon name="ChevronLeft" className="size-4" aria-hidden="true" />
          {agentDisplayName(agent)}
        </button>
        <header className="flex items-start gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-md bg-muted">
            <AgentIcon icon={agent.icon} className="size-5" />
          </span>
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight">
              New conversation with <span>{agentDisplayName(agent)}</span>
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {agentDisplayTagline(agent)}
            </p>
          </div>
        </header>
        <NewThreadComposer
          defaultProjectId={projectId}
          defaultAgentId={agent.slug}
          defaultProviderId={agent.provider ?? undefined}
          defaultModel={agent.model ?? EVA_DEFAULT_MODEL}
          defaultReasoningLevel={EVA_DEFAULT_REASONING_LEVEL}
          defaultEnvironment={{
            type: "host",
            hostId: detail.hostId ?? undefined,
            workspace: { type: "unmanaged", path: detail.workspacePath },
          }}
          placeholder="Type your message"
          draftKey={"eva-agent-" + agent.slug}
          layout="document"
          className="[&_[data-promptbox-project-control]]:hidden"
          onSubmit={submit}
        />
      </div>
    </div>
  );
}

function AgentsHome({ subPath }: { subPath: string }) {
  const [slug, route] = subPath.split("/").filter(Boolean);
  if (slug === "new") return <CreateAgentPage />;
  if (slug && route === "new") return <AgentThreadComposer slug={slug} />;
  return slug ? <AgentDetail slug={slug} /> : <AgentsRoster />;
}

function AgentNavigation() {
  const { roster, error, refetch } = useAgentRoster();
  const navigate = useBbNavigate();
  if (error) return <PageError message={error} retry={() => void refetch()} />;
  if (!roster) {
    return <div className="animate-pulse rounded-lg bg-muted px-3 py-10" />;
  }
  return (
    <div className="space-y-1">
      <Button
        variant="outline"
        size="sm"
        className="mb-2 w-full justify-start"
        onClick={() => navigate.toPluginPanel("agents", { subPath: "new" })}
      >
        <Icon name="Plus" className="size-4" />
        New agent
      </Button>
      <p className="px-1 pb-2 text-xs text-muted-foreground">Switch agent</p>
      {roster.agents.map((agent) => (
        <button
          key={agent.slug}
          type="button"
          onClick={() =>
            navigate.toPluginPanel("agents", { subPath: agent.slug })
          }
          className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-state-hover"
        >
          <AgentIcon
            icon={agent.icon}
            className="size-4 text-muted-foreground"
          />
          <span className="min-w-0 flex-1 truncate text-sm">
            {agentDisplayName(agent)}
          </span>
          <StatusBadge status={agent.status} />
        </button>
      ))}
    </div>
  );
}

function useCollapsedGroups() {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    try {
      const stored = window.localStorage.getItem("eva.sidebar.collapsed");
      return stored ? (JSON.parse(stored) as Record<string, boolean>) : {};
    } catch {
      return {};
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem(
        "eva.sidebar.collapsed",
        JSON.stringify(collapsed),
      );
    } catch {
      // Local persistence is optional; the sidebar remains usable without it.
    }
  }, [collapsed]);
  const toggle = useCallback((id: string, currentlyCollapsed: boolean) => {
    setCollapsed((current) => ({ ...current, [id]: !currentlyCollapsed }));
  }, []);
  return { collapsed, toggle };
}

function SidebarSection({
  label,
  count,
  collapsed,
  onToggle,
  children,
}: {
  label: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section aria-label={label} className="mb-1">
      <div className="flex h-6 items-center gap-1.5 px-2">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!collapsed}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
        >
          <Icon
            name="ChevronRight"
            className={cn(
              "size-3 shrink-0 text-subtle-foreground/70 transition-transform duration-150",
              !collapsed && "rotate-90",
            )}
          />
          <span className="truncate text-2xs font-medium uppercase tracking-wide text-subtle-foreground/80">
            {label}
          </span>
          <span className="text-2xs tabular-nums text-subtle-foreground/60">
            {count}
          </span>
        </button>
      </div>
      {collapsed ? null : <div className="space-y-px">{children}</div>}
    </section>
  );
}

function ThreadOverflowMenu({
  thread,
  actions,
}: {
  thread: PluginSidebarThread;
  actions: PluginSidebarThreadActions;
}) {
  const invoke = (operation: () => Promise<void>) => {
    void operation().catch((cause) => toast.error(errorText(cause)));
  };

  const rename = () => {
    const title = window.prompt(
      "Conversation name",
      thread.title ?? thread.titleFallback ?? "",
    );
    if (!title?.trim()) return;
    invoke(() => actions.rename(thread.id, title.trim()));
  };

  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label={
            "Manage " + (thread.title ?? thread.titleFallback ?? "conversation")
          }
          title="Manage conversation"
          className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <Icon name="MoreHorizontal" className="size-4" aria-hidden="true" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          side="right"
          align="start"
          sideOffset={4}
          className="z-50 min-w-44 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
        >
          <DropdownMenu.Item
            onSelect={() => actions.open(thread.id, { split: true })}
            className="cursor-pointer rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-state-hover focus:bg-state-hover"
          >
            Open in split pane
          </DropdownMenu.Item>
          <DropdownMenu.Separator className="my-1 h-px bg-border" />
          <DropdownMenu.Item
            onSelect={() =>
              invoke(() => actions.setPinned(thread.id, !thread.isPinned))
            }
            className="cursor-pointer rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-state-hover focus:bg-state-hover"
          >
            {thread.isPinned ? "Unpin" : "Pin"}
          </DropdownMenu.Item>
          <DropdownMenu.Item
            onSelect={() =>
              invoke(() => actions.setRead(thread.id, thread.isUnread))
            }
            className="cursor-pointer rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-state-hover focus:bg-state-hover"
          >
            {thread.isUnread ? "Mark as read" : "Mark as unread"}
          </DropdownMenu.Item>
          <DropdownMenu.Item
            onSelect={rename}
            className="cursor-pointer rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-state-hover focus:bg-state-hover"
          >
            Rename
          </DropdownMenu.Item>
          <DropdownMenu.Separator className="my-1 h-px bg-border" />
          <DropdownMenu.Item
            onSelect={() => actions.archive(thread.id)}
            className="cursor-pointer rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-state-hover focus:bg-state-hover"
          >
            Archive
          </DropdownMenu.Item>
          <DropdownMenu.Item
            onSelect={() => actions.requestDelete(thread.id)}
            className="cursor-pointer rounded-sm px-2 py-1.5 text-sm text-destructive outline-none hover:bg-destructive/10 focus:bg-destructive/10"
          >
            Delete…
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function SidebarThreadRow({
  thread,
  activeThreadId,
  onOpen,
  actions,
  nested = false,
}: {
  thread: PluginSidebarThread;
  activeThreadId: string | null;
  onOpen: (threadId: string, split: boolean) => void;
  actions: PluginSidebarThreadActions;
  nested?: boolean;
}) {
  const { splitProps } = experimental_useSidebarThreadSplit(thread.id);
  const title = thread.title ?? thread.titleFallback ?? "Conversation";
  const ownerName = thread.ownerName?.trim() || null;
  const accessibleLabel = ownerName ? `${title} (${ownerName})` : title;
  const isActive = activeThreadId === thread.id;
  return (
    <li
      className={cn(
        "group/row relative flex w-full items-center gap-2 rounded-md pr-1 text-sm transition-colors",
        ownerName ? "min-h-9 py-0.5" : "h-7",
        isActive
          ? "bg-sidebar-accent text-sidebar-foreground"
          : "text-sidebar-foreground/85 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground dark:text-sidebar-foreground",
      )}
      style={
        nested
          ? { marginLeft: 14, width: "calc(100% - 14px)", paddingLeft: 10 }
          : { paddingLeft: 8 }
      }
    >
      <a
        href="#"
        data-sidebar-thread-shortcut-target=""
        data-sidebar-thread-id={thread.id}
        aria-label={accessibleLabel}
        aria-current={isActive ? "page" : undefined}
        {...splitProps}
        onClick={(event) => {
          event.preventDefault();
          onOpen(thread.id, event.metaKey || event.ctrlKey);
        }}
        className="absolute inset-0 rounded-md outline-none ring-sidebar-ring focus-visible:ring-2"
      />
      <span className="pointer-events-none relative min-w-0 flex-1">
        <span
          className={cn("block truncate", thread.isUnread && "font-medium")}
          title={title}
        >
          {title}
        </span>
        {ownerName ? (
          <span
            className="block truncate text-2xs leading-3 text-subtle-foreground/80"
            title={ownerName}
          >
            {ownerName}
          </span>
        ) : null}
      </span>
      <span className="relative flex size-5 shrink-0 items-center justify-center">
        <span className="flex items-center justify-center transition-opacity group-hover/row:opacity-0 group-focus-within/row:opacity-0">
          <StatusGlyph thread={thread} colored />
        </span>
        <span className="absolute inset-[-4px] opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100">
          <ThreadOverflowMenu thread={thread} actions={actions} />
        </span>
      </span>
    </li>
  );
}

function SidebarConversationFolder({
  id,
  label,
  threads,
  open,
  onToggle,
  onNew,
  newLabel,
  activeThreadId,
  onOpenThread,
  actions,
  agent,
  project,
}: {
  id: string;
  label: string;
  threads: readonly PluginSidebarThread[];
  open: boolean;
  onToggle: () => void;
  onNew: () => void;
  newLabel: string;
  activeThreadId: string | null;
  onOpenThread: (threadId: string, split: boolean) => void;
  actions: PluginSidebarThreadActions;
  agent?: EvaAgent;
  project?: PluginSidebarProject;
}) {
  const isActiveHere =
    activeThreadId !== null &&
    threads.some((thread) => thread.id === activeThreadId);
  const statusCounts = useMemo(() => countStatuses(threads), [threads]);
  return (
    <div className="mb-px" data-sidebar-folder-id={id}>
      <div
        className={cn(
          "group/folder relative flex h-7 items-center gap-2 rounded-md pl-2 pr-1 text-sm transition-colors",
          "text-sidebar-foreground/85 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground dark:text-sidebar-foreground",
          isActiveHere && !open && "text-sidebar-foreground",
        )}
      >
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-label={`${label} (${threads.length} conversations)`}
          className="absolute inset-0 rounded-md outline-none ring-sidebar-ring focus-visible:ring-2"
        />
        <span className="pointer-events-none relative flex w-4 shrink-0 items-center justify-center text-subtle-foreground">
          {agent ? (
            <AgentIcon icon={agent.icon} className="size-4" />
          ) : (
            <Icon
              name={open ? "FolderOpen" : "Folder"}
              className="size-4"
              aria-hidden="true"
            />
          )}
        </span>
        <span className="pointer-events-none relative min-w-0 flex-1 truncate font-medium">
          {label}
        </span>
        <span className="pointer-events-none relative flex shrink-0 items-center gap-2 group-hover/folder:hidden">
          <StatusCluster counts={statusCounts} colored />
          <span className="text-2xs tabular-nums text-subtle-foreground/70">
            {threads.length}
          </span>
        </span>
        <button
          type="button"
          aria-label={newLabel}
          onClick={(event) => {
            event.stopPropagation();
            onNew();
          }}
          className="relative z-10 hidden size-5 items-center justify-center rounded text-muted-foreground hover:text-foreground max-md:flex group-hover/folder:flex group-focus-within/folder:flex"
        >
          <Icon name="Plus" className="size-3.5" />
        </button>
      </div>
      {open ? (
        <ul className="relative ml-2 space-y-px before:pointer-events-none before:absolute before:bottom-0 before:left-[7px] before:top-0 before:z-10 before:w-px before:bg-border-hairline before:opacity-70 before:content-['']">
          {threads.map((thread) => (
            <SidebarThreadRow
              key={thread.id}
              thread={thread}
              activeThreadId={activeThreadId}
              onOpen={onOpenThread}
              actions={actions}
              nested
            />
          ))}
          {threads.length === 0 ? (
            <li className="py-1 pl-6 text-xs text-muted-foreground/60">
              No conversations
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}

function EVAThreadList({
  activeThreadId,
  activeProjectId,
  searchQuery,
  onNavigate,
  Original,
}: PluginThreadListProps) {
  const { status, threads, projects } = experimental_useSidebarThreads();
  const actions = experimental_useSidebarThreadActions();
  const navigate = useBbNavigate();
  const { roster, error } = useAgentRoster();
  const { collapsed, toggle } = useCollapsedGroups();
  const rosterAgentKey =
    roster?.agents
      .map((agent) => agent.slug)
      .sort()
      .join("\u001f") ?? "";
  const sidebarThreadRevision = threads
    .map((thread) => `${thread.id}:${thread.isArchived ? 1 : 0}`)
    .sort()
    .join("\u001f");
  const authorizedThreadBindings = useAgentThreadBindings(
    roster !== null,
    `${rosterAgentKey}\u001e${sidebarThreadRevision}`,
  );

  useEffect(() => {
    const menu = document.querySelector<HTMLElement>(
      '[data-sidebar="footer"] ul',
    );
    if (!menu) return;
    const remoteItem = menu.querySelector<HTMLElement>(
      'li:has([data-testid="plugin-sidebar-footer-action-connect-remote-access"])',
    );
    const extensionsRow = document.querySelector<HTMLElement>(
      '[data-testid="plugin-nav-sidebar-items"] > div:has([data-icon="Toolbox"])',
    );
    const previousRemoteDisplay = remoteItem?.style.display ?? "";
    const previousExtensionsDisplay = extensionsRow?.style.display ?? "";
    if (remoteItem) remoteItem.style.display = "none";
    if (extensionsRow) extensionsRow.style.display = "none";

    return () => {
      if (remoteItem) remoteItem.style.display = previousRemoteDisplay;
      if (extensionsRow)
        extensionsRow.style.display = previousExtensionsDisplay;
    };
  }, []);

  const query = searchQuery.trim().toLocaleLowerCase();
  const agentByThreadId = useMemo(() => {
    const map = new Map<string, EvaAgent>();
    const agentBySlug = new Map(
      (roster?.agents ?? []).map((agent) => [agent.slug, agent]),
    );
    for (const agent of roster?.agents ?? []) {
      for (const threadId of agent.threadIds) map.set(threadId, agent);
    }
    for (const [threadId, agentSlug] of authorizedThreadBindings) {
      const agent = agentBySlug.get(agentSlug);
      if (agent) map.set(threadId, agent);
    }
    return map;
  }, [authorizedThreadBindings, roster]);

  // Older EVA versions provisioned one BB project per agent. Those project
  // records are retained for history, but they are not part of EVA's current
  // shared-project model and should not reappear as project folders here.
  const legacyAgentProjectIds = useMemo(() => {
    const ids = new Set<string>();
    for (const agent of roster?.agents ?? []) {
      if (agent.projectId && agent.projectId !== roster?.rootProjectId) {
        ids.add(agent.projectId);
      }
    }
    return ids;
  }, [roster]);

  if (status === "error" || error) return <Original />;
  if (status !== "ready" || !roster) {
    return (
      <div className="px-3 py-4 text-xs text-muted-foreground">
        Loading conversations…
      </div>
    );
  }

  const visibleThreads = threads
    .filter((thread) => !thread.isArchived)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const matches = (thread: (typeof threads)[number]) => {
    const title = (
      thread.title ??
      thread.titleFallback ??
      ""
    ).toLocaleLowerCase();
    return title.includes(query);
  };

  const openThread = (threadId: string, split: boolean) => {
    actions.open(threadId, { split });
    onNavigate();
  };

  if (query) {
    const results = visibleThreads.filter(matches);
    return (
      <>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {results.length === 0 ? (
            <p
              role="status"
              className="px-2 py-6 text-center text-xs text-muted-foreground"
            >
              No conversations match “{searchQuery.trim()}”.
            </p>
          ) : (
            <ul className="space-y-px">
              {results.map((thread) => (
                <SidebarThreadRow
                  key={thread.id}
                  thread={thread}
                  activeThreadId={activeThreadId}
                  onOpen={openThread}
                  actions={actions}
                />
              ))}
            </ul>
          )}
        </div>
      </>
    );
  }

  const groups = roster.agents.map((agent) => ({
    id: agent.slug,
    agent,
    threads: visibleThreads.filter(
      (thread) => agentByThreadId.get(thread.id)?.slug === agent.slug,
    ),
  }));
  const allThreadsByProject = new Map<string, PluginSidebarThread[]>();
  for (const thread of visibleThreads) {
    const group = allThreadsByProject.get(thread.projectId) ?? [];
    group.push(thread);
    allThreadsByProject.set(thread.projectId, group);
  }
  // Agent bindings, rather than project ids, determine the Agents groups.
  // Keep EVA threads out of Projects even though they share the configured BB
  // project, so that project folders only show ordinary conversations.
  const rootThreads = visibleThreads.filter(
    (thread) => !agentByThreadId.has(thread.id),
  );
  const threadsByProject = new Map<string, PluginSidebarThread[]>();
  for (const thread of rootThreads) {
    const group = threadsByProject.get(thread.projectId) ?? [];
    group.push(thread);
    threadsByProject.set(thread.projectId, group);
  }
  const orderedProjects = [...projects]
    .filter((project) => !legacyAgentProjectIds.has(project.id))
    .filter((project) => {
      const allProjectThreads = allThreadsByProject.get(project.id) ?? [];
      const rootProjectThreads = threadsByProject.get(project.id) ?? [];
      if (
        project.id === roster.rootProjectId &&
        rootProjectThreads.length === 0
      ) {
        return false;
      }
      return rootProjectThreads.length > 0 || allProjectThreads.length === 0;
    })
    .sort((a, b) => {
      if (a.isPersonal !== b.isPersonal) return a.isPersonal ? 1 : -1;
      const aLatest = threadsByProject.get(a.id)?.[0]?.updatedAt ?? 0;
      const bLatest = threadsByProject.get(b.id)?.[0]?.updatedAt ?? 0;
      return bLatest - aLatest;
    });

  const agentsCollapsed = collapsed["section:agents"] === true;
  const projectsCollapsed = collapsed["section:projects"] === true;

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        <SidebarSection
          label="Agents"
          count={groups.length}
          collapsed={agentsCollapsed}
          onToggle={() => toggle("section:agents", agentsCollapsed)}
        >
          {groups.map((group) => {
            const key = `folder:agent:${group.id}`;
            const activeHere = group.threads.some(
              (thread) => thread.id === activeThreadId,
            );
            const open =
              collapsed[key] === false ||
              (collapsed[key] === undefined && activeHere);
            return (
              <SidebarConversationFolder
                key={group.id}
                id={group.id}
                label={agentDisplayName(group.agent)}
                agent={group.agent}
                threads={group.threads}
                open={open}
                onToggle={() => toggle(key, !open)}
                onNew={() =>
                  navigate.toPluginPanel("agents", {
                    subPath: group.agent.slug + "/new",
                  })
                }
                newLabel={
                  "New conversation with " + agentDisplayName(group.agent)
                }
                activeThreadId={activeThreadId}
                onOpenThread={openThread}
                actions={actions}
              />
            );
          })}
        </SidebarSection>

        <SidebarSection
          label="Projects"
          count={orderedProjects.length}
          collapsed={projectsCollapsed}
          onToggle={() => toggle("section:projects", projectsCollapsed)}
        >
          {orderedProjects.map((project) => {
            const projectThreads = threadsByProject.get(project.id) ?? [];
            const key = `folder:project:${project.id}`;
            const activeHere =
              projectThreads.some((thread) => thread.id === activeThreadId) ||
              (activeThreadId === null && activeProjectId === project.id);
            const open =
              collapsed[key] === false ||
              (collapsed[key] === undefined && activeHere);
            return (
              <SidebarConversationFolder
                key={project.id}
                id={project.id}
                label={project.name}
                project={project}
                threads={projectThreads}
                open={open}
                onToggle={() => toggle(key, !open)}
                onNew={() => {
                  actions.openNewThread({
                    projectId: project.id,
                    focusPrompt: true,
                  });
                  onNavigate();
                }}
                newLabel={"New conversation in " + project.name}
                activeThreadId={activeThreadId}
                onOpenThread={openThread}
                actions={actions}
              />
            );
          })}
        </SidebarSection>
      </div>
    </>
  );
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "agents",
    path: "agents",
    title: "Agents",
    icon: "Network",
    component: AgentsHome,
    fixedTabs: [
      {
        panelId: "agents",
        id: "agent-navigation",
        title: "Agents",
        icon: "Network",
        component: AgentNavigation,
        layout: "padded",
      },
    ],
  });
  app.slots.experimental_threadList({
    id: "eva-agent-threads",
    title: "EVA agent conversations",
    description: "Groups BB threads by their EVA agent record.",
    component: EVAThreadList,
  });
});
