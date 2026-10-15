import { createNodeBbSdk, type BbSdk } from "@bb/sdk/node";
import type { Dispatcher } from "undici";

type CliRequestInit = RequestInit & { dispatcher?: Dispatcher };

export function cliFetch(
  input: RequestInfo | URL,
  init?: CliRequestInit,
): Promise<Response> {
  const token = process.env.BB_AGENT_CLI_TOKEN;
  const serverUrl = process.env.BB_SERVER_URL;
  if (token === undefined || serverUrl === undefined) {
    return fetch(input, init);
  }
  try {
    const server = new URL(serverUrl);
    const serverApiPrefix = `${server.pathname.replace(/\/+$/u, "")}/api/v1/`;
    const requestUrl = new URL(
      input instanceof Request ? input.url : input.toString(),
      serverUrl,
    );
    if (
      requestUrl.origin !== server.origin ||
      !requestUrl.pathname.startsWith(serverApiPrefix)
    ) {
      return fetch(input, init);
    }
  } catch {
    return fetch(input, init);
  }
  const headers = new Headers(
    input instanceof Request ? input.headers : undefined,
  );
  new Headers(init?.headers).forEach((value, name) => {
    headers.set(name, value);
  });
  headers.set("x-bb-agent-cli-token", token);
  return fetch(input, { ...init, headers });
}

export function createCliBbSdk(baseUrl: string): BbSdk {
  return createNodeBbSdk({ baseUrl, fetch: cliFetch });
}
