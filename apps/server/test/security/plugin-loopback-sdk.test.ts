import { describe, expect, it } from "vitest";
import {
  installTestBuiltinPlugin,
  startTestServer,
} from "../helpers/test-app.js";

describe("plugin loopback SDK under core auth", () => {
  it("lets bound plugin SDK calls through when browser auth is required", async () => {
    const server = await startTestServer({ authRequired: true });
    try {
      server.pluginService.bindSdk({ baseUrl: server.baseUrl });
      await installTestBuiltinPlugin(server, "keep-awake");
      const api = server.pluginService.getApi("keep-awake");
      if (api === undefined) {
        throw new Error("keep-awake plugin API was not loaded");
      }
      await expect(api.sdk.threads.listRunning()).resolves.toEqual([]);
      const anonymous = await fetch(`${server.baseUrl}/api/v1/threads/running`);
      expect(anonymous.status).toBe(401);
    } finally {
      await server.pluginService.stop();
      await server.close();
    }
  });
});
