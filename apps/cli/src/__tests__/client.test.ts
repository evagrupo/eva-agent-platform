import { afterEach, describe, expect, it, vi } from "vitest";
import { cliFetch } from "../client.js";

describe("cliFetch agent credentials", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("attaches the scoped token only to this EVA server API", async () => {
    vi.stubEnv("BB_SERVER_URL", "https://eva.example.test/desk");
    vi.stubEnv("BB_AGENT_CLI_TOKEN", "scoped-token");
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        expect(new Headers(init?.headers).get("x-bb-agent-cli-token")).toBe(
          "scoped-token",
        );
        return new Response(null, { status: 200 });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    await cliFetch(
      "https://eva.example.test/desk/api/v1/plugins/contributions",
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never forwards the scoped token to another origin", async () => {
    vi.stubEnv("BB_SERVER_URL", "https://eva.example.test");
    vi.stubEnv("BB_AGENT_CLI_TOKEN", "scoped-token");
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        expect(new Headers(init?.headers).has("x-bb-agent-cli-token")).toBe(
          false,
        );
        return new Response(null, { status: 200 });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    await cliFetch(
      "https://attacker.example.test/api/v1/plugins/contributions",
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not attach the token to another path on the same origin", async () => {
    vi.stubEnv("BB_SERVER_URL", "https://eva.example.test/desk");
    vi.stubEnv("BB_AGENT_CLI_TOKEN", "scoped-token");
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        expect(new Headers(init?.headers).has("x-bb-agent-cli-token")).toBe(
          false,
        );
        return new Response(null, { status: 200 });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    await cliFetch("https://eva.example.test/api/v1/plugins/contributions");

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
