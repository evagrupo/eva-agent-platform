import { describe, expect, it } from "vitest";
import { resolveThreadEnvironment } from "./thread-shell-environment.js";

describe("resolveThreadEnvironment agent CLI credential", () => {
  it("passes the credential to the agent while masking it in diagnostics", () => {
    const result = resolveThreadEnvironment({
      environmentId: "env_test",
      projectId: "proj_test",
      threadId: "thr_test",
      baseShellEnv: { BB_SERVER_URL: "https://eva.example.test" },
      contributedEnv: [
        {
          name: "BB_AGENT_CLI_TOKEN",
          value: "secret-token",
          source: { core: "agent-cli" },
          reason: "Scoped CLI access",
        },
      ],
    });

    expect(result.envVars.BB_AGENT_CLI_TOKEN).toBe("secret-token");
    expect(result.entries).toContainEqual({
      name: "BB_AGENT_CLI_TOKEN",
      source: { core: "agent-cli" },
      value: { masked: true },
      reason: "Scoped CLI access",
    });
  });
});
