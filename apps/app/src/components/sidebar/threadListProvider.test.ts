import { describe, expect, it } from "vitest";
import { orderThreadListsForAutomatic } from "./threadListProvider";

describe("automatic thread list choice", () => {
  it("prefers another plugin's thread list over the bundled one regardless of load order", () => {
    const bundled = { pluginId: "thread-list", id: "thread-list" };
    const eva = { pluginId: "eva", id: "eva-agent-threads" };
    expect(orderThreadListsForAutomatic([bundled, eva])[0]).toBe(eva);
    expect(orderThreadListsForAutomatic([eva, bundled])[0]).toBe(eva);
    expect(orderThreadListsForAutomatic([bundled])[0]).toBe(bundled);
  });
});
