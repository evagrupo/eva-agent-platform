import { describe, expect, it } from "vitest";
import { shouldResetSplitLayoutForAccount } from "./SplitLayoutAccountReset";

describe("shouldResetSplitLayoutForAccount", () => {
  it("resets only when a different account signs in", () => {
    expect(shouldResetSplitLayoutForAccount("admin", "user")).toBe(true);
    expect(shouldResetSplitLayoutForAccount("user", "user")).toBe(false);
    // Nothing recorded yet: the layout may be another person's.
    expect(shouldResetSplitLayoutForAccount(null, "user")).toBe(true);
    expect(shouldResetSplitLayoutForAccount("admin", null)).toBe(false);
  });
});
