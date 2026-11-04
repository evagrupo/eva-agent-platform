import { describe, expect, it } from "vitest";
import { canUseCorePlugin, type CoreAuthState } from "./core-auth";

function userAuth(core: Record<string, boolean>): CoreAuthState {
  return {
    status: "ready",
    authenticated: true,
    required: true,
    user: null,
    bootstrap: {
      capabilities: { core },
      plugins: { allowedIds: [] },
    },
    accessPending: false,
    error: null,
    refresh: async () => {},
    signIn: async () => null,
    signOut: async () => {},
  } as unknown as CoreAuthState;
}

describe("app shell plugins for chat readers", () => {
  const reader = userAuth({ threadOwnRead: true, plugins: false, pluginData: false });

  it("loads the shell plugins (agent chat list included) without the plugin capability", () => {
    for (const id of ["thread-list", "navigation", "bb--composer", "eva", "spanish-localization"]) {
      expect(canUseCorePlugin(reader, id)).toBe(true);
    }
  });

  it("keeps other plugins and non-readers out", () => {
    expect(canUseCorePlugin(reader, "bb--git")).toBe(false);
    expect(canUseCorePlugin(userAuth({}), "eva")).toBe(false);
  });
});
