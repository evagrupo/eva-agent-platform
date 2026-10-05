import type { NewThreadRequest } from "@get-bb/plugin-sdk/app";

function messageFromResponse(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;
  if ("message" in value && typeof value.message === "string") {
    return value.message;
  }
  if ("error" in value) {
    const error = value.error;
    if (typeof error === "string") return error;
    if (
      typeof error === "object" &&
      error !== null &&
      "message" in error &&
      typeof error.message === "string"
    ) {
      return error.message;
    }
  }
  return null;
}

export async function createEvaAgentThread(args: {
  agentId: string;
  agentName: string;
  request: NewThreadRequest;
}): Promise<string> {
  const prompt = args.request.input
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join(" ")
    .trim()
    .replaceAll(/\s+/gu, " ");
  const response = await fetch("/api/v1/threads", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...args.request,
      agentId: args.agentId,
      origin: "plugin",
      originPluginId: "eva",
      title: `${args.agentName} — ${prompt.slice(0, 120) || "New conversation"}`,
    }),
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      messageFromResponse(body) ??
        `Failed to create conversation (HTTP ${response.status})`,
    );
  }
  if (
    typeof body !== "object" ||
    body === null ||
    !("id" in body) ||
    typeof body.id !== "string"
  ) {
    throw new Error("Thread creation returned an invalid response");
  }
  return body.id;
}
