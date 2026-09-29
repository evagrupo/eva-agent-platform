import { describe, expect, it } from "vitest";
import {
  createPluginLoopbackFetch,
  createPluginLoopbackSecret,
  PLUGIN_LOOPBACK_AUTH_HEADER,
  requestHasPluginLoopbackAuth,
} from "../../../src/services/plugins/plugin-loopback-auth.js";

describe("plugin loopback auth", () => {
  it("accepts only the secret stamped onto plugin SDK fetches", async () => {
    const secret = createPluginLoopbackSecret();
    const fetchImpl = createPluginLoopbackFetch(secret, async (input, init) => {
      const request = new Request(input, init);
      expect(requestHasPluginLoopbackAuth(request, secret)).toBe(true);
      return new Response(null, { status: 204 });
    });
    const response = await fetchImpl(
      "http://127.0.0.1:9/api/v1/threads/running",
    );
    expect(response.status).toBe(204);

    const anonymous = new Request("http://127.0.0.1:9/api/v1/threads/running");
    expect(requestHasPluginLoopbackAuth(anonymous, secret)).toBe(false);
    const forged = new Request("http://127.0.0.1:9/api/v1/threads/running", {
      headers: { [PLUGIN_LOOPBACK_AUTH_HEADER]: "0".repeat(64) },
    });
    expect(requestHasPluginLoopbackAuth(forged, secret)).toBe(false);
  });
});
