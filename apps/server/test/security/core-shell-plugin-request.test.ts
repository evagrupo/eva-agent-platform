import { describe, expect, it } from "vitest";
import { isCoreShellPluginRequest } from "../../src/server.js";

describe("app shell plugin requests for chat readers", () => {
  it("lets the shell load its plugin assets and RPCs", () => {
    expect(isCoreShellPluginRequest("GET", "/plugins")).toBe(true);
    expect(isCoreShellPluginRequest("GET", "/plugins/contributions")).toBe(true);
    for (const id of ["thread-list", "navigation", "bb--composer", "eva", "spanish-localization"]) {
      expect(isCoreShellPluginRequest("GET", `/plugins/${id}/assets/index.js`)).toBe(true);
    }
    expect(isCoreShellPluginRequest("POST", "/plugins/eva/rpc/agents_list")).toBe(true);
    expect(isCoreShellPluginRequest("POST", "/plugins/thread-list/rpc")).toBe(true);
    expect(isCoreShellPluginRequest("POST", "/plugins/thread-list/cli")).toBe(true);
  });

  it("keeps every other plugin request behind the plugin capability", () => {
    expect(isCoreShellPluginRequest("GET", "/plugins/bb--git/assets/index.js")).toBe(false);
    expect(isCoreShellPluginRequest("POST", "/plugins/automations/rpc/list")).toBe(false);
    expect(isCoreShellPluginRequest("POST", "/plugins/eva/cli")).toBe(false);
    expect(isCoreShellPluginRequest("POST", "/plugins/eva/update")).toBe(false);
    expect(isCoreShellPluginRequest("PUT", "/plugins/eva/settings")).toBe(false);
    expect(isCoreShellPluginRequest("POST", "/plugins/eva/rpc/agents_list/x")).toBe(false);
    expect(isCoreShellPluginRequest("GET", "/plugins/evaX/assets/a.js")).toBe(false);
  });
});
