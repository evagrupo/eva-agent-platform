import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import {
  AGENT_MEMORY_DETAILS_MAX_CHARS,
  AGENT_MEMORY_TITLE_MAX_CHARS,
  AgentMemoriesAccessDeniedError,
  deleteAgentMemory,
  listAgentMemories,
  listAgentMemoryUsers,
  updateAgentMemory,
  type AgentMemory,
  type AgentMemoryUser,
} from "./agent-memories";

const MEMORY_KIND_LABELS: Readonly<Record<AgentMemory["kind"], string>> = {
  preference: "Preference",
  correction: "Correction",
  pattern: "Pattern",
  fact: "Fact",
};

const MEMORY_LIMIT = 200;

type UsersResult =
  | { status: "error"; message: string }
  | { status: "ready"; users: AgentMemoryUser[] };

type MemoriesResult =
  | { status: "error"; message: string }
  | { status: "ready"; memories: AgentMemory[] };

interface MemoryDraft {
  title: string;
  details: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function userLabel(user: AgentMemoryUser): string {
  return user.name.trim() ? `${user.name} · ${user.email}` : user.email;
}

function updatedLabel(timestamp: number): string {
  return `Updated ${new Date(timestamp).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  })}`;
}

function draftOf(memory: AgentMemory): MemoryDraft {
  return { title: memory.title, details: memory.details };
}

export function AgentMemories({ agentSlug }: { agentSlug: string }) {
  const [denied, setDenied] = useState(false);
  const [usersAttempt, setUsersAttempt] = useState(0);
  const [usersResult, setUsersResult] = useState<{
    attempt: number;
    result: UsersResult;
  } | null>(null);
  const [userId, setUserId] = useState("");
  const [memoriesAttempt, setMemoriesAttempt] = useState(0);
  const [memoriesResult, setMemoriesResult] = useState<{
    key: string;
    result: MemoriesResult;
  } | null>(null);
  const [drafts, setDrafts] = useState<Record<string, MemoryDraft>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const usersState =
    usersResult?.attempt === usersAttempt ? usersResult.result : null;
  const users = usersState?.status === "ready" ? usersState.users : [];
  const selectedUserId = users.some((user) => user.id === userId)
    ? userId
    : (users[0]?.id ?? "");
  const memoriesKey =
    selectedUserId === ""
      ? null
      : JSON.stringify([agentSlug, selectedUserId, memoriesAttempt]);
  const memoriesState =
    memoriesKey !== null && memoriesResult?.key === memoriesKey
      ? memoriesResult.result
      : null;

  useEffect(() => {
    const controller = new AbortController();
    listAgentMemoryUsers(controller.signal)
      .then((loaded) => {
        if (controller.signal.aborted) return;
        setUsersResult({
          attempt: usersAttempt,
          result: { status: "ready", users: loaded },
        });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof AgentMemoriesAccessDeniedError) {
          setDenied(true);
          return;
        }
        setUsersResult({
          attempt: usersAttempt,
          result: { status: "error", message: errorMessage(error) },
        });
      });
    return () => controller.abort();
  }, [usersAttempt]);

  useEffect(() => {
    if (memoriesKey === null) return;
    const controller = new AbortController();
    listAgentMemories(agentSlug, selectedUserId, controller.signal)
      .then((memories) => {
        if (controller.signal.aborted) return;
        setMemoriesResult({
          key: memoriesKey,
          result: { status: "ready", memories },
        });
        setDrafts(
          Object.fromEntries(
            memories.map((memory) => [memory.id, draftOf(memory)]),
          ),
        );
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof AgentMemoriesAccessDeniedError) {
          setDenied(true);
          return;
        }
        setMemoriesResult({
          key: memoriesKey,
          result: { status: "error", message: errorMessage(error) },
        });
      });
    return () => controller.abort();
  }, [agentSlug, selectedUserId, memoriesKey]);

  const updateMemories = useCallback(
    (update: (memories: AgentMemory[]) => AgentMemory[]) => {
      setMemoriesResult((current) =>
        current !== null && current.result.status === "ready"
          ? {
              key: current.key,
              result: {
                status: "ready",
                memories: update(current.result.memories),
              },
            }
          : current,
      );
    },
    [],
  );

  if (denied || usersState === null) return null;

  const saveMemory = async (memory: AgentMemory) => {
    const draft = drafts[memory.id];
    if (!draft || busyId !== null) return;
    if (!draft.title.trim() || !draft.details.trim()) {
      toast.error("A memory needs a title and details.");
      return;
    }
    setBusyId(memory.id);
    try {
      const saved = await updateAgentMemory(agentSlug, memory.id, draft);
      updateMemories((memories) =>
        memories.map((item) => (item.id === saved.id ? saved : item)),
      );
      setDrafts((current) => ({ ...current, [saved.id]: draftOf(saved) }));
      toast.success("Memory saved");
    } catch (error) {
      if (error instanceof AgentMemoriesAccessDeniedError) {
        setDenied(true);
        return;
      }
      toast.error(errorMessage(error));
    } finally {
      setBusyId(null);
    }
  };

  const removeMemory = async (memory: AgentMemory) => {
    if (busyId !== null) return;
    setBusyId(memory.id);
    try {
      await deleteAgentMemory(agentSlug, memory.id);
      updateMemories((memories) =>
        memories.filter((item) => item.id !== memory.id),
      );
      toast.success("Memory deleted");
    } catch (error) {
      if (error instanceof AgentMemoriesAccessDeniedError) {
        setDenied(true);
        return;
      }
      toast.error(errorMessage(error));
    } finally {
      setBusyId(null);
    }
  };

  const updateDraft = (id: string, field: keyof MemoryDraft, value: string) => {
    setDrafts((current) => {
      const draft = current[id];
      return draft
        ? { ...current, [id]: { ...draft, [field]: value } }
        : current;
    });
  };

  return (
    <section aria-labelledby="agent-memories-heading">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="agent-memories-heading" className="font-medium">
            Memories
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            What this agent remembers about each person across conversations.
            Only administrators can see and change these memories.
          </p>
        </div>
        {usersState.status === "ready" && users.length > 0 ? (
          <div className="flex items-center gap-2">
            <label
              htmlFor="agent-memories-user"
              className="text-xs font-medium text-muted-foreground"
            >
              User
            </label>
            <select
              id="agent-memories-user"
              value={selectedUserId}
              onChange={(event) => setUserId(event.target.value)}
              className="h-9 max-w-64 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {userLabel(user)}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </div>

      {usersState.status === "error" ? (
        <div className="mt-3 rounded-lg border border-dashed border-border px-4 py-6 text-center">
          <p className="text-sm text-muted-foreground">{usersState.message}</p>
          <Button
            className="mt-3"
            variant="outline"
            size="sm"
            onClick={() => setUsersAttempt((attempt) => attempt + 1)}
          >
            Try again
          </Button>
        </div>
      ) : users.length === 0 ? (
        <div className="mt-3 rounded-lg border border-dashed border-border px-4 py-6 text-center">
          <p className="text-sm text-muted-foreground">No users yet</p>
        </div>
      ) : memoriesState?.status === "error" ? (
        <div className="mt-3 rounded-lg border border-dashed border-border px-4 py-6 text-center">
          <p className="text-sm text-muted-foreground">
            {memoriesState.message}
          </p>
          <Button
            className="mt-3"
            variant="outline"
            size="sm"
            onClick={() => setMemoriesAttempt((attempt) => attempt + 1)}
          >
            Try again
          </Button>
        </div>
      ) : memoriesState === null ? (
        <div className="mt-3 h-24 w-full animate-pulse rounded-lg bg-muted" />
      ) : memoriesState.memories.length === 0 ? (
        <div className="mt-3 rounded-lg border border-dashed border-border px-4 py-6 text-center">
          <p className="text-sm font-medium">No memories yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            This agent has not saved anything about this user.
          </p>
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          {memoriesState.memories.map((memory) => {
            const draft = drafts[memory.id] ?? draftOf(memory);
            const dirty =
              draft.title !== memory.title || draft.details !== memory.details;
            const titleId = `agent-memory-title-${memory.id}`;
            const detailsId = `agent-memory-details-${memory.id}`;
            return (
              <fieldset
                key={memory.id}
                className="rounded-lg border border-border bg-card p-3"
                data-agent-memory={memory.id}
              >
                <legend className="sr-only">{memory.title}</legend>
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <label
                        htmlFor={titleId}
                        className="text-xs font-medium text-muted-foreground"
                      >
                        Title
                      </label>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                        {MEMORY_KIND_LABELS[memory.kind]}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {updatedLabel(memory.updatedAt)}
                      </span>
                    </div>
                    <Input
                      id={titleId}
                      value={draft.title}
                      maxLength={AGENT_MEMORY_TITLE_MAX_CHARS}
                      onChange={(event) =>
                        updateDraft(memory.id, "title", event.target.value)
                      }
                      className="mt-1"
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Delete memory ${memory.title}`}
                    disabled={busyId !== null}
                    onClick={() => void removeMemory(memory)}
                  >
                    <Icon name="Trash2" className="size-4 text-destructive" />
                  </Button>
                </div>
                <label
                  htmlFor={detailsId}
                  className="mt-3 block text-xs font-medium text-muted-foreground"
                >
                  Details
                </label>
                <textarea
                  id={detailsId}
                  value={draft.details}
                  maxLength={AGENT_MEMORY_DETAILS_MAX_CHARS}
                  onChange={(event) =>
                    updateDraft(memory.id, "details", event.target.value)
                  }
                  className="mt-1 min-h-24 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm leading-6 outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
                <div className="mt-2 flex items-center justify-end">
                  <Button
                    size="sm"
                    variant={dirty ? "default" : "outline"}
                    disabled={!dirty || busyId !== null}
                    onClick={() => void saveMemory(memory)}
                  >
                    <Icon name="Check" className="size-4" />
                    Save
                  </Button>
                </div>
              </fieldset>
            );
          })}
        </div>
      )}
      {memoriesState?.status === "ready" ? (
        <p className="mt-2 text-xs text-muted-foreground">
          {`${memoriesState.memories.length} of ${MEMORY_LIMIT} memories`}
        </p>
      ) : null}
    </section>
  );
}
