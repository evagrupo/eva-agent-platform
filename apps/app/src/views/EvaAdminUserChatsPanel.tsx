import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { getThreadRoutePath } from "@/lib/route-paths";

export interface EvaAdminUserChat {
  agentId: string;
  agentName: string;
  agentIcon: string;
  threadId: string;
  projectId: string;
  title: string | null;
  status: string;
  updatedAt: number;
  preview: { role: "user" | "assistant"; text: string; at: number } | null;
  otherThreadCount: number;
}

export interface EvaAdminUserChatsResponse {
  userId: string;
  chats: EvaAdminUserChat[];
}

interface ChatUser {
  id: string;
  email: string;
  name: string;
}

type ChatsState =
  | { status: "idle" }
  | { status: "loading"; userId: string }
  | { status: "error"; userId: string; message: string }
  | { status: "ready"; userId: string; chats: EvaAdminUserChat[] };

function otherThreadsLabel(count: number): string {
  if (count === 0) return "No other threads";
  return count === 1 ? "1 other thread" : `${count} other threads`;
}

export function EvaAdminUserChatsPanel({
  users,
  loadChats,
}: {
  users: readonly ChatUser[];
  loadChats: (userId: string) => Promise<EvaAdminUserChatsResponse>;
}) {
  const [selectedUserId, setSelectedUserId] = useState("");
  const [state, setState] = useState<ChatsState>({ status: "idle" });
  const latestRequest = useRef(0);

  const selectUser = async (userId: string) => {
    setSelectedUserId(userId);
    const request = ++latestRequest.current;
    if (userId === "") {
      setState({ status: "idle" });
      return;
    }
    setState({ status: "loading", userId });
    try {
      const response = await loadChats(userId);
      if (request !== latestRequest.current) return;
      setState({ status: "ready", userId, chats: response.chats });
    } catch (cause) {
      if (request !== latestRequest.current) return;
      setState({
        status: "error",
        userId,
        message:
          cause instanceof Error ? cause.message : "Chats could not be loaded",
      });
    }
  };

  return (
    <div className="space-y-4">
      <label
        className="block max-w-md space-y-2 text-sm"
        htmlFor="admin-chats-user"
      >
        <span className="block font-medium">User</span>
        <select
          id="admin-chats-user"
          value={selectedUserId}
          onChange={(event) => void selectUser(event.target.value)}
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <option value="">Select a user</option>
          {users.map((user) => (
            <option key={user.id} value={user.id}>
              {user.name} ({user.email})
            </option>
          ))}
        </select>
      </label>
      {state.status === "loading" ? (
        <p className="text-sm text-muted-foreground">Loading chats…</p>
      ) : state.status === "error" ? (
        <p className="text-sm text-destructive" role="alert">
          {state.message}
        </p>
      ) : state.status === "ready" && state.chats.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          This user has no agent chats yet.
        </p>
      ) : state.status === "ready" ? (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {state.chats.map((chat) => (
            <li key={chat.agentId}>
              <Link
                className="flex min-h-14 flex-wrap items-start justify-between gap-3 px-4 py-3 text-sm hover:bg-state-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                to={getThreadRoutePath({
                  projectId: chat.projectId,
                  threadId: chat.threadId,
                })}
              >
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-foreground">
                    {chat.agentName}
                  </span>
                  <span className="mt-1 block truncate text-muted-foreground">
                    {chat.preview === null
                      ? "No messages yet"
                      : `${chat.preview.role === "user" ? "User" : chat.agentName}: ${chat.preview.text}`}
                  </span>
                </span>
                <span className="shrink-0 text-right text-xs text-muted-foreground">
                  <span className="block">
                    {new Date(
                      chat.preview?.at ?? chat.updatedAt,
                    ).toLocaleString()}
                  </span>
                  <span className="mt-1 block">
                    {otherThreadsLabel(chat.otherThreadCount)}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
