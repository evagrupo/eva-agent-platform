import { describe, expect, it, vi } from "vitest";
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
      const states: string[] = [];
      const changed = vi.fn();
      const unsubscribeConnection = api.sdk.subscribe({
        event: "realtime:connection",
        callback: ({ state }) => states.push(state),
      });
      const unsubscribeSystem = api.sdk.subscribe({
        event: "system:changed",
        callback: changed,
      });
      try {
        await vi.waitFor(() => expect(states).toContain("connected"));
        server.hub.notifySystem(["plugins-changed"]);
        await vi.waitFor(() =>
          expect(changed).toHaveBeenCalledWith(
            expect.objectContaining({
              entity: "system",
              changes: ["plugins-changed"],
            }),
          ),
        );
      } finally {
        unsubscribeConnection();
        unsubscribeSystem();
      }
      const anonymous = await fetch(`${server.baseUrl}/api/v1/threads/running`);
      expect(anonymous.status).toBe(401);
    } finally {
      await server.pluginService.stop();
      await server.close();
    }
  });
});
