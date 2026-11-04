import { beforeEach, describe, expect, it } from "vitest";
import {
  ADMINISTRATOR_RULES_UPDATE_PREFIX,
  administratorRulesUpdateInput,
  recordAdministratorRulesInSession,
  resetAdministratorRulesDeliveryForTest,
} from "../../src/services/threads/administrator-rules-delivery.js";

describe("administrator rules delivery to running sessions", () => {
  beforeEach(() => resetAdministratorRulesDeliveryForTest());

  it("sends nothing when the session started with the current rules", () => {
    recordAdministratorRulesInSession("thr_a", ["Be formal."]);
    expect(administratorRulesUpdateInput("thr_a", ["Be formal."])).toBeNull();
  });

  it("sends a changed rule once, hidden from the user", () => {
    recordAdministratorRulesInSession("thr_a", []);
    const update = administratorRulesUpdateInput("thr_a", ["End with OK."]);
    expect(update).toMatchObject({ type: "text", visibility: "agent-only" });
    expect(update && update.type === "text" ? update.text : "").toContain(ADMINISTRATOR_RULES_UPDATE_PREFIX);
    expect(update && update.type === "text" ? update.text : "").toContain("End with OK.");
    expect(administratorRulesUpdateInput("thr_a", ["End with OK."])).toBeNull();
  });

  it("tells the session when its rules were removed", () => {
    recordAdministratorRulesInSession("thr_a", ["Old rule."]);
    const update = administratorRulesUpdateInput("thr_a", []);
    expect(update && update.type === "text" ? update.text : "").toContain("no longer apply");
  });

  it("delivers rules to a session the server has not seen since it restarted", () => {
    expect(administratorRulesUpdateInput("thr_b", ["Rule."])).not.toBeNull();
    expect(administratorRulesUpdateInput("thr_c", [])).toBeNull();
  });
});
