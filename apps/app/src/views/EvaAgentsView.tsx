import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Icon } from "@bb/shared-ui/icon";
import { Button } from "@bb/shared-ui/button";
import { Input } from "@bb/shared-ui/input";
import { Textarea } from "@bb/shared-ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@bb/shared-ui/dialog";
import { useCoreAuth } from "@/lib/core-auth";
import { sdk } from "@/lib/sdk";
import type {
  EvaAgent as SdkEvaAgent,
  EvaAgentThread as SdkEvaAgentThread,
  EvaAgentWorkspaceSyncStatus,
} from "@bb/sdk/browser";
import { BbHttpError } from "@bb/sdk/browser";
import {
  getEvaAgentsRoutePath,
  getEvaAgentDetailRoutePath,
  getThreadRoutePath,
} from "@/lib/route-paths";

type AgentStatus = SdkEvaAgent["status"];

interface AgentSkill {
  id: string;
  name: string;
  instructions: string;
}

type Agent = SdkEvaAgent;
type AgentThread = SdkEvaAgentThread;

interface CreateFormState {
  id: string;
  displayName: string;
  description: string;
  icon: string;
  instructions: string;
}

function statusLabel(status: AgentStatus): string {
  if (status === "live") return "Live";
  if (status === "shadow") return "Shadow";
  return "Draft";
}

function formatDate(value: number | null): string {
  if (value === null) return "Not scaffolded yet";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}

function AgentStatusBadge({ status }: { status: AgentStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${
        status === "live"
          ? "border-success/30 bg-success/10 text-success"
          : status === "shadow"
            ? "border-warning/30 bg-warning/10 text-warning"
            : "border-border bg-surface-recessed text-muted-foreground"
      }`}
    >
      {statusLabel(status)}
    </span>
  );
}

function AgentIcon({ name }: { name: string }) {
  return (
    <span className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-border bg-surface-recessed text-foreground">
      <Icon name={name} aria-hidden="true" className="size-5" />
    </span>
  );
}

function EmptyAgentsState() {
  return (
    <section className="rounded-2xl border border-dashed border-border bg-card px-6 py-12 text-center shadow-xs">
      <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-surface-recessed text-muted-foreground">
        <Icon name="Network" aria-hidden="true" className="size-5" />
      </div>
      <h2 className="mt-4 text-base font-semibold text-foreground">
        Agent access is pending
      </h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
        Your workspace is ready. An administrator can assign an EVA agent grant
        when you are ready to start collaborating.
      </p>
    </section>
  );
}

function CreateAgentForm({ onCreated }: { onCreated: (agent: Agent) => void }) {
  const [form, setForm] = useState<CreateFormState>({
    id: "",
    displayName: "",
    description: "",
    icon: "Network",
    instructions: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const response = await sdk.evaAgents.create(form);
      onCreated(response.agent);
      setForm({
        id: "",
        displayName: "",
        description: "",
        icon: "Network",
        instructions: "",
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "EVA request failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      className="rounded-2xl border border-border bg-card p-5 shadow-xs"
      onSubmit={submit}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Administrator
          </p>
          <h2 className="mt-1 text-base font-semibold text-foreground">
            Add a managed agent
          </h2>
        </div>
        <Icon
          name="Plus"
          aria-hidden="true"
          className="size-4 text-muted-foreground"
        />
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1.5 text-sm text-foreground">
          Agent id
          <Input
            value={form.id}
            placeholder="campaign-review"
            onChange={(event) => setForm({ ...form, id: event.target.value })}
            required
          />
        </label>
        <label className="grid gap-1.5 text-sm text-foreground">
          Display name
          <Input
            value={form.displayName}
            placeholder="Campaign review"
            onChange={(event) =>
              setForm({ ...form, displayName: event.target.value })
            }
            required
          />
        </label>
        <label className="grid gap-1.5 text-sm text-foreground sm:col-span-2">
          Description
          <Input
            value={form.description}
            placeholder="Reviews campaign ideas before human approval"
            onChange={(event) =>
              setForm({ ...form, description: event.target.value })
            }
            required
          />
        </label>
        <label className="grid gap-1.5 text-sm text-foreground sm:col-span-2">
          Operating instructions
          <Textarea
            value={form.instructions}
            placeholder="Describe the safe operating boundary for this agent."
            onChange={(event) =>
              setForm({ ...form, instructions: event.target.value })
            }
            className="min-h-24"
            required
          />
        </label>
      </div>
      {error ? (
        <p className="mt-3 text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      <Button className="mt-4" type="submit" disabled={saving}>
        {saving ? "Creating…" : "Create agent"}
      </Button>
    </form>
  );
}

function AgentCard({ agent }: { agent: Agent }) {
  return (
    <Link
      className="group flex min-h-40 flex-col rounded-2xl border border-border bg-card p-5 shadow-xs transition-colors hover:border-foreground/25 hover:bg-state-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      to={getEvaAgentDetailRoutePath(agent.id)}
    >
      <div className="flex items-start justify-between gap-3">
        <AgentIcon name={agent.icon} />
        <AgentStatusBadge status={agent.status} />
      </div>
      <div className="mt-5">
        <h2 className="font-semibold text-foreground group-hover:underline">
          {agent.displayName}
        </h2>
        <p className="mt-1 line-clamp-2 text-sm leading-5 text-muted-foreground">
          {agent.description}
        </p>
      </div>
      <div className="mt-auto flex items-center gap-4 pt-5 text-xs text-muted-foreground">
        <span>{agent.weeklyConversationCount} this week</span>
        <span>{agent.skills.length} skills</span>
      </div>
    </Link>
  );
}

function AgentListView() {
  const auth = useCoreAuth();
  const [response, setResponse] = useState<Awaited<
    ReturnType<typeof sdk.evaAgents.list>
  > | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setResponse(await sdk.evaAgents.list());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "EVA request failed");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-6xl px-5 py-8" aria-busy="true">
        <div className="h-8 w-48 animate-pulse rounded bg-surface-recessed" />
        <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[1, 2, 3].map((item) => (
            <div
              className="h-40 animate-pulse rounded-2xl bg-surface-recessed"
              key={item}
            />
          ))}
        </div>
      </div>
    );
  }

  if (error !== null) {
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-col items-center px-5 py-16 text-center">
        <Icon
          name="AlertCircle"
          aria-hidden="true"
          className="size-6 text-destructive"
        />
        <h1 className="mt-4 text-lg font-semibold text-foreground">
          Agents could not load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">{error}</p>
        <Button className="mt-5" variant="outline" onClick={() => void load()}>
          Try again
        </Button>
      </main>
    );
  }

  const agents = response?.agents ?? [];
  return (
    <main className="mx-auto w-full max-w-6xl px-5 py-8 lg:px-8">
      <header className="flex flex-col gap-5 border-b border-border pb-7 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
            EVA operations
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground md:text-3xl">
            Agent workspace
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            Work with approved agents through bounded conversations, managed
            skills, and auditable workspace boundaries.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3 text-sm md:min-w-56">
          <div className="rounded-xl border border-border bg-card px-3 py-3">
            <p className="text-xs text-muted-foreground">Available</p>
            <p className="mt-1 text-lg font-semibold text-foreground">
              {response?.availableCount ?? 0}
            </p>
          </div>
          <div className="rounded-xl border border-border bg-card px-3 py-3">
            <p className="text-xs text-muted-foreground">This week</p>
            <p className="mt-1 text-lg font-semibold text-foreground">
              {response?.weeklyConversations ?? 0}
            </p>
          </div>
        </div>
      </header>

      <div className="mt-7 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {agents.map((agent) => (
          <AgentCard agent={agent} key={agent.id} />
        ))}
      </div>
      {agents.length === 0 ? (
        <div className="mt-7">
          <EmptyAgentsState />
        </div>
      ) : null}
      {response?.canManage ? (
        <div className="mt-7">
          <CreateAgentForm
            onCreated={(agent) => {
              setResponse((current) =>
                current === null
                  ? current
                  : {
                      ...current,
                      agents: [...current.agents, agent],
                      availableCount: current.availableCount + 1,
                    },
              );
            }}
          />
        </div>
      ) : null}
      {auth?.user?.role === "admin" ? (
        <p className="mt-5 text-xs text-muted-foreground">
          Grants still control which agents each account can see or run.
        </p>
      ) : null}
    </main>
  );
}

type PendingWorkspaceSyncAction =
  | "configure"
  | "initialize"
  | "commit"
  | "pull"
  | "push";

function workspaceSyncActionLabel(action: PendingWorkspaceSyncAction): string {
  if (action === "configure") return "Configure";
  if (action === "initialize") return "Initialize";
  if (action === "commit") return "Commit";
  if (action === "pull") return "Pull / Restore";
  return "Push";
}

function WorkspaceSyncStateBadge({
  state,
}: {
  state: EvaAgentWorkspaceSyncStatus["state"];
}) {
  const tone =
    state === "clean"
      ? "border-success/30 bg-success/10 text-success"
      : state === "changed"
        ? "border-warning/30 bg-warning/10 text-warning"
        : state === "blocked" || state === "conflict" || state === "error"
          ? "border-destructive/30 bg-destructive/10 text-destructive"
          : "border-border bg-surface-recessed text-muted-foreground";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${tone}`}
    >
      {state.replaceAll("_", " ")}
    </span>
  );
}

function WorkspaceSyncPanel({ agentId }: { agentId: string }) {
  const [status, setStatus] = useState<EvaAgentWorkspaceSyncStatus | null>(
    null,
  );
  const [remoteUrl, setRemoteUrl] = useState("");
  const [branch, setBranch] = useState("main");
  const [commitMessage, setCommitMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingAction, setPendingAction] =
    useState<PendingWorkspaceSyncAction | null>(null);

  const loadStatus = async (showLoading = true) => {
    if (showLoading) setLoading(true);
    setError(null);
    try {
      const response = await sdk.evaAgents.workspaceSync({ agentId });
      setStatus(response.status);
      setRemoteUrl(response.status.remoteUrl ?? "");
      setBranch(response.status.branch);
      setForbidden(false);
    } catch (caught) {
      if (caught instanceof BbHttpError && caught.status === 403) {
        setForbidden(true);
        setError(null);
      } else {
        setError(caught instanceof Error ? caught.message : "Sync status failed");
      }
    } finally {
      if (showLoading) setLoading(false);
    }
  };

  useEffect(() => {
    void loadStatus();
  }, [agentId]);

  const confirmAction = async () => {
    if (pendingAction === null) return;
    const action = pendingAction;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      let response: { status: EvaAgentWorkspaceSyncStatus };
      if (action === "configure") {
        response = await sdk.evaAgents.configureWorkspaceSync({
          agentId,
          remoteUrl,
          branch,
          enabled: true,
        });
      } else if (action === "initialize") {
        response = await sdk.evaAgents.initializeWorkspaceSync({ agentId });
      } else if (action === "commit") {
        if (status?.fingerprint === null || status?.fingerprint === undefined) {
          throw new Error("Refresh status before committing");
        }
        response = await sdk.evaAgents.commitWorkspaceSync({
          agentId,
          message: commitMessage,
          expectedFingerprint: status.fingerprint,
        });
      } else if (action === "pull") {
        if (status?.fingerprint === null || status?.fingerprint === undefined) {
          throw new Error("Refresh status before restoring");
        }
        response = await sdk.evaAgents.pullWorkspaceSync({
          agentId,
          expectedFingerprint: status.fingerprint,
          allowNonEmpty: true,
        });
      } else {
        if (status?.fingerprint === null || status?.fingerprint === undefined) {
          throw new Error("Refresh status before pushing");
        }
        response = await sdk.evaAgents.pushWorkspaceSync({
          agentId,
          expectedFingerprint: status.fingerprint,
        });
      }
      setStatus(response.status);
      setRemoteUrl(response.status.remoteUrl ?? remoteUrl);
      setBranch(response.status.branch);
      setNotice(`${workspaceSyncActionLabel(action)} completed.`);
      setPendingAction(null);
      if (action === "commit") setCommitMessage("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Workspace sync failed");
    } finally {
      setBusy(false);
    }
  };

  const canInitialize = status !== null && !status.repositoryInitialized;
  const canCommit =
    status !== null &&
    status.repositoryInitialized &&
    status.configured &&
    status.enabled &&
    status.state === "changed" &&
    status.fingerprint !== null &&
    commitMessage.trim().length > 0;
  const canRestore =
    status !== null &&
    status.repositoryInitialized &&
    status.configured &&
    status.enabled &&
    status.state === "clean" &&
    status.head !== null &&
    status.fingerprint !== null;
  const canPush = canRestore;

  if (forbidden) {
    return (
      <section className="mt-5 rounded-2xl border border-border bg-card p-5 shadow-xs">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          Workspace sync
        </p>
        <p className="mt-2 text-sm text-muted-foreground" role="status">
          Administrator access is required to inspect or change Git workspace sync.
        </p>
      </section>
    );
  }

  return (
    <section className="mt-5 rounded-2xl border border-border bg-card p-5 shadow-xs">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Administrator
          </p>
          <h2 className="mt-1 text-lg font-semibold text-foreground">
            Workspace sync
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            Git authentication is configured on the server for the service user.
            Credentials are never entered here or stored in EVA.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => void loadStatus(false)}
          disabled={loading || busy}
          aria-busy={loading}
        >
          <Icon name="RefreshCw" aria-hidden="true" />
          {loading ? "Loading…" : "Status / Refresh"}
        </Button>
      </div>

      {loading && status === null ? (
        <div className="mt-5 h-28 animate-pulse rounded-xl bg-surface-recessed" aria-busy="true" />
      ) : status !== null ? (
        <>
          <div className="mt-5 grid gap-3 rounded-xl border border-border p-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <p className="text-xs text-muted-foreground">Workspace path</p>
              <p className="mt-1 break-all font-mono text-xs text-foreground">
                {status.workspacePath}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Repository</p>
              <p className="mt-1 text-foreground">
                {status.configured ? "Configured" : "Not configured"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {status.repositoryInitialized ? "Initialized" : "Not initialized"}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Branch</p>
              <p className="mt-1 text-foreground">{status.branch}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Checked out: {status.currentBranch ?? "No branch"}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">State</p>
              <div className="mt-1">
                <WorkspaceSyncStateBadge state={status.state} />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {status.fileCount} allowed files
              </p>
            </div>
          </div>

          {status.remoteUrl !== null ? (
            <p className="mt-3 break-all text-xs text-muted-foreground">
              Remote: <span className="font-mono text-foreground">{status.remoteUrl}</span>
            </p>
          ) : null}
          {status.changes.length > 0 ? (
            <div className="mt-3 rounded-xl border border-border p-3 text-xs">
              <p className="font-medium text-foreground">Changes requiring review</p>
              <ul className="mt-2 grid gap-1 text-muted-foreground">
                {status.changes.map((change) => (
                  <li className="break-all font-mono" key={`${change.code}-${change.path}`}>
                    {change.code} {change.path}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {status.blockedFiles.length > 0 ? (
            <div className="mt-3 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive" role="alert">
              <p className="font-medium">Blocked from synchronization</p>
              <p className="mt-1">Remove secrets, credentials, runtime files, or symlinks before committing.</p>
              <ul className="mt-2 grid gap-1 font-mono">
                {status.blockedFiles.map((file) => (
                  <li className="break-all" key={file}>{file}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {status.lastErrorMessage !== null ? (
            <p className="mt-3 text-sm text-destructive" role="alert">
              {status.lastErrorMessage}
            </p>
          ) : null}
          <p className="mt-3 text-xs text-muted-foreground" role="status" aria-live="polite">
            Last operation: {status.lastOperation} · {status.lastResult}
            {status.lastOperationAt === null ? "" : ` · ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(status.lastOperationAt)}`}
          </p>
        </>
      ) : null}

      <form
        className="mt-5 grid gap-3 rounded-xl border border-border p-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,0.35fr)_auto] sm:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          setPendingAction("configure");
        }}
      >
        <label className="grid gap-1.5 text-sm text-foreground">
          Private Git remote
          <Input
            value={remoteUrl}
            onChange={(event) => setRemoteUrl(event.target.value)}
            placeholder="git@github.com:org/private-repo.git"
            autoComplete="off"
            required
          />
        </label>
        <label className="grid gap-1.5 text-sm text-foreground">
          Branch
          <Input
            value={branch}
            onChange={(event) => setBranch(event.target.value)}
            placeholder="main"
            autoComplete="off"
            required
          />
        </label>
        <Button type="submit" disabled={busy || remoteUrl.trim().length === 0 || branch.trim().length === 0}>
          Configure
        </Button>
      </form>

      <p className="mt-2 text-xs text-muted-foreground">
        Use HTTPS, SSH, or scp-style remotes without embedded credentials. The EVA fork, database, logs, provider state, and runtime files are never synchronized.
      </p>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => setPendingAction("initialize")}
          disabled={busy || !canInitialize}
        >
          Initialize
        </Button>
        <label className="flex min-w-56 flex-1 items-center gap-2 text-sm text-foreground sm:flex-none">
          <span className="sr-only">Commit message</span>
          <Input
            value={commitMessage}
            onChange={(event) => setCommitMessage(event.target.value)}
            placeholder="Commit message"
            maxLength={200}
            disabled={busy}
          />
        </label>
        <Button
          type="button"
          variant="outline"
          onClick={() => setPendingAction("commit")}
          disabled={busy || !canCommit}
        >
          Commit
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => setPendingAction("pull")}
          disabled={busy || !canRestore}
        >
          Pull / Restore
        </Button>
        <Button
          type="button"
          onClick={() => setPendingAction("push")}
          disabled={busy || !canPush}
        >
          Push
        </Button>
      </div>

      {notice !== null ? (
        <p className="mt-3 text-sm text-success" role="status" aria-live="polite">
          {notice}
        </p>
      ) : null}
      {error !== null ? (
        <p className="mt-3 text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <Dialog
        open={pendingAction !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setPendingAction(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Confirm {pendingAction === null ? "workspace sync" : workspaceSyncActionLabel(pendingAction)}
            </DialogTitle>
            <DialogDescription>
              {pendingAction === "pull"
                ? "This will fetch the configured branch and fast-forward the local repository only. Confirm that you reviewed the current status and that local files can be restored safely."
                : pendingAction === "configure"
                  ? "EVA will store only the sanitized remote and branch, then use the service user’s existing noninteractive Git authentication."
                  : "Review the current workspace status before allowing this administrator operation. Local files are not force-overwritten."
              }
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setPendingAction(null)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button type="button" onClick={() => void confirmAction()} disabled={busy}>
              {busy ? "Working…" : `Confirm ${pendingAction === null ? "operation" : workspaceSyncActionLabel(pendingAction)}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function AgentDetailView({ agentId }: { agentId: string }) {
  const navigate = useNavigate();
  const auth = useCoreAuth();
  const [agent, setAgent] = useState<Agent | null>(null);
  const [threads, setThreads] = useState<AgentThread[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [sending, setSending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [instructions, setInstructions] = useState("");
  const [skills, setSkills] = useState<AgentSkill[]>([]);
  const canManage = auth?.user?.role === "admin";

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [detail, threadResponse] = await Promise.all([
        sdk.evaAgents.get({ agentId }),
        sdk.evaAgents.threads({ agentId }),
      ]);
      setAgent(detail.agent);
      setInstructions(detail.agent.instructions);
      setSkills(detail.agent.skills);
      setThreads(threadResponse.threads);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "EVA request failed");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [agentId]);

  const startConversation = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (prompt.trim().length === 0) return;
    setSending(true);
    setError(null);
    try {
      const response = await sdk.evaAgents.start({
        agentId,
        prompt: prompt.trim(),
      });
      navigate(
        getThreadRoutePath({
          projectId: response.thread.projectId,
          threadId: response.thread.id,
        }),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "EVA request failed");
    } finally {
      setSending(false);
    }
  };

  const saveAgent = async () => {
    setSaved(false);
    setError(null);
    try {
      const response = await sdk.evaAgents.update({
        agentId,
        instructions,
        skills,
      });
      setAgent(response.agent);
      setInstructions(response.agent.instructions);
      setSkills(response.agent.skills);
      setSaved(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "EVA request failed");
    }
  };

  const addSkill = () => {
    setSkills((current) => [
      ...current,
      {
        id: `skill-${current.length + 1}`,
        name: "New skill",
        instructions: "",
      },
    ]);
  };

  const managedFiles = useMemo(
    () => agent?.workspace.managedFiles ?? [],
    [agent],
  );

  if (loading) {
    return (
      <main className="mx-auto w-full max-w-5xl px-5 py-8" aria-busy="true">
        <div className="h-7 w-56 animate-pulse rounded bg-surface-recessed" />
        <div className="mt-7 h-72 animate-pulse rounded-2xl bg-surface-recessed" />
      </main>
    );
  }

  if (error !== null && agent === null) {
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-col items-center px-5 py-16 text-center">
        <Icon
          name="AlertCircle"
          aria-hidden="true"
          className="size-6 text-destructive"
        />
        <h1 className="mt-4 text-lg font-semibold text-foreground">
          Agent details are unavailable
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">{error}</p>
        <Button className="mt-5" variant="outline" onClick={() => void load()}>
          Try again
        </Button>
      </main>
    );
  }

  if (agent === null) return null;
  return (
    <main className="mx-auto w-full max-w-5xl px-5 py-8 lg:px-8">
      <Link
        className="inline-flex min-h-10 items-center gap-2 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        to={getEvaAgentsRoutePath()}
      >
        <Icon name="ArrowLeft" aria-hidden="true" className="size-4" />
        All agents
      </Link>
      <header className="mt-6 flex flex-col gap-5 border-b border-border pb-7 md:flex-row md:items-start md:justify-between">
        <div className="flex gap-4">
          <AgentIcon name={agent.icon} />
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">
                {agent.displayName}
              </h1>
              <AgentStatusBadge status={agent.status} />
            </div>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              {agent.description}
            </p>
          </div>
        </div>
        <div className="text-left text-sm text-muted-foreground md:text-right">
          <p>{agent.weeklyConversationCount} conversations this week</p>
          <p className="mt-1">
            Provider: {agent.defaultProviderId ?? "Not configured"}
          </p>
        </div>
      </header>

      {error !== null ? (
        <div
          className="mt-5 flex items-center justify-between gap-4 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          role="alert"
        >
          <span>{error}</span>
          <Button size="sm" variant="outline" onClick={() => setError(null)}>
            Dismiss
          </Button>
        </div>
      ) : null}

      <div className="mt-7 grid gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(280px,0.7fr)]">
        <section className="rounded-2xl border border-border bg-card p-5 shadow-xs">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Conversation
              </p>
              <h2 className="mt-1 text-lg font-semibold text-foreground">
                Start bounded work
              </h2>
            </div>
            <Icon
              name="MessageSquare"
              aria-hidden="true"
              className="size-5 text-muted-foreground"
            />
          </div>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Conversations use the personal project and the agent’s managed
            workspace. Collaboration actions stay attached to a parent thread
            when delegated.
          </p>
          <form className="mt-5" onSubmit={startConversation}>
            <label className="grid gap-1.5 text-sm font-medium text-foreground">
              What should this agent work on?
              <Textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="Describe the next review, analysis, or draft."
                className="min-h-28"
                maxLength={16_000}
                required
              />
            </label>
            <Button className="mt-4" type="submit" disabled={sending}>
              <Icon name="ArrowUpRight" aria-hidden="true" />
              {sending ? "Starting…" : "Start conversation"}
            </Button>
          </form>
        </section>

        <section className="rounded-2xl border border-border bg-card p-5 shadow-xs">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Workspace boundary
              </p>
              <h2 className="mt-1 text-lg font-semibold text-foreground">
                Managed files
              </h2>
            </div>
            <Icon
              name="Folder"
              aria-hidden="true"
              className="size-5 text-muted-foreground"
            />
          </div>
          <p className="mt-3 break-all rounded-lg bg-surface-recessed px-3 py-2 font-mono text-xs text-muted-foreground">
            {agent.workspace.relativePath}
          </p>
          <p className="mt-3 text-xs text-muted-foreground">
            Status:{" "}
            {agent.workspace.status === "managed" ? "Ready" : "Needs attention"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Last scaffold: {formatDate(agent.workspace.lastScaffoldedAt)}
          </p>
          <ul className="mt-4 grid gap-2 text-xs text-muted-foreground">
            {managedFiles.map((file) => (
              <li className="flex items-center gap-2" key={file}>
                <Icon name="FileText" aria-hidden="true" className="size-3.5" />
                <span className="truncate">{file}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {canManage ? <WorkspaceSyncPanel agentId={agent.id} /> : null}

      <section className="mt-5 rounded-2xl border border-border bg-card p-5 shadow-xs">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Recent activity
            </p>
            <h2 className="mt-1 text-lg font-semibold text-foreground">
              Agent threads
            </h2>
          </div>
          <span className="rounded-full bg-surface-recessed px-2.5 py-1 text-xs text-muted-foreground">
            {threads.length}
          </span>
        </div>
        {threads.length === 0 ? (
          <p className="mt-5 rounded-xl border border-dashed border-border px-4 py-5 text-sm text-muted-foreground">
            No conversations yet.
          </p>
        ) : (
          <div className="mt-4 divide-y divide-border rounded-xl border border-border">
            {threads.map((thread) => (
              <Link
                className="flex min-h-14 items-center justify-between gap-4 px-4 py-3 text-sm hover:bg-state-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                key={thread.id}
                to={getThreadRoutePath({
                  projectId: thread.projectId,
                  threadId: thread.id,
                })}
              >
                <span className="min-w-0 truncate text-foreground">
                  {thread.title ?? "Untitled conversation"}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {thread.status}
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>

      {canManage ? (
        <section className="mt-5 rounded-2xl border border-border bg-card p-5 shadow-xs">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Administrator
              </p>
              <h2 className="mt-1 text-lg font-semibold text-foreground">
                Instructions and skills
              </h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Changes are persisted and scaffold only EVA-managed files inside
                the server-owned agent root.
              </p>
            </div>
            <Button variant="outline" onClick={addSkill}>
              <Icon name="Plus" aria-hidden="true" />
              Add skill
            </Button>
          </div>
          <label className="mt-5 grid gap-1.5 text-sm font-medium text-foreground">
            Operating instructions
            <Textarea
              value={instructions}
              onChange={(event) => setInstructions(event.target.value)}
              className="min-h-36"
            />
          </label>
          <div className="mt-5 grid gap-3">
            {skills.map((skill, index) => (
              <div
                className="rounded-xl border border-border p-4"
                key={`${skill.id}-${index}`}
              >
                <div className="grid gap-3 sm:grid-cols-[minmax(0,0.35fr)_minmax(0,0.65fr)]">
                  <label className="grid gap-1.5 text-sm text-foreground">
                    Skill id
                    <Input
                      value={skill.id}
                      onChange={(event) =>
                        setSkills((current) =>
                          current.map((candidate, candidateIndex) =>
                            candidateIndex === index
                              ? { ...candidate, id: event.target.value }
                              : candidate,
                          ),
                        )
                      }
                    />
                  </label>
                  <label className="grid gap-1.5 text-sm text-foreground">
                    Name
                    <Input
                      value={skill.name}
                      onChange={(event) =>
                        setSkills((current) =>
                          current.map((candidate, candidateIndex) =>
                            candidateIndex === index
                              ? { ...candidate, name: event.target.value }
                              : candidate,
                          ),
                        )
                      }
                    />
                  </label>
                </div>
                <label className="mt-3 grid gap-1.5 text-sm text-foreground">
                  Skill instructions
                  <Textarea
                    value={skill.instructions}
                    onChange={(event) =>
                      setSkills((current) =>
                        current.map((candidate, candidateIndex) =>
                          candidateIndex === index
                            ? { ...candidate, instructions: event.target.value }
                            : candidate,
                        ),
                      )
                    }
                    className="min-h-20"
                  />
                </label>
                <Button
                  className="mt-3"
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setSkills((current) =>
                      current.filter(
                        (_, candidateIndex) => candidateIndex !== index,
                      ),
                    )
                  }
                >
                  Remove skill
                </Button>
              </div>
            ))}
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Button onClick={() => void saveAgent()}>Save changes</Button>
            {saved ? <span className="text-sm text-success">Saved</span> : null}
          </div>
        </section>
      ) : null}
    </main>
  );
}

export function EvaAgentsView() {
  const { agentId } = useParams<{ agentId?: string }>();
  return agentId === undefined ? (
    <AgentListView />
  ) : (
    <AgentDetailView agentId={agentId} />
  );
}
