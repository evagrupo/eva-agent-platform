import { describe, expect, it } from "vitest";
import {
  isEvaAgentChatReportPath,
  isEvaAgentChatSidePanelRequest,
  isEvaAgentChatSidePanelThread,
} from "../../src/services/threads/eva-agent-chat-side-panel.js";

describe("agent chat side panel grant", () => {
  it("covers only report files in the chat's own storage", () => {
    expect(isEvaAgentChatReportPath("reports/priorizar-cobros.md")).toBe(true);
    expect(isEvaAgentChatReportPath("reports%2Fplan.pdf")).toBe(true);
    expect(isEvaAgentChatReportPath("reports/../secrets.md")).toBe(false);
    expect(isEvaAgentChatReportPath("reports/sub/x.md")).toBe(false);
    expect(isEvaAgentChatReportPath("notes.md")).toBe(false);
    expect(isEvaAgentChatReportPath("reports/.env")).toBe(false);
    expect(isEvaAgentChatReportPath("reports/run.sh")).toBe(false);
  });

  it("defers only tab state and report file reads to the routes", () => {
    expect(isEvaAgentChatSidePanelRequest("GET", "/threads/thr_a/tabs")).toBe(true);
    expect(isEvaAgentChatSidePanelRequest("PUT", "/threads/thr_a/tabs")).toBe(true);
    expect(isEvaAgentChatSidePanelRequest("GET", "/threads/thr_a/thread-storage/files/reports/a.md")).toBe(true);
    expect(isEvaAgentChatSidePanelRequest("GET", "/threads/thr_a/thread-storage/files/other/a.md")).toBe(false);
    expect(isEvaAgentChatSidePanelRequest("GET", "/threads/thr_a/thread-storage/files")).toBe(false);
    expect(isEvaAgentChatSidePanelRequest("GET", "/threads/thr_a/host-files/etc/passwd")).toBe(false);
    expect(isEvaAgentChatSidePanelRequest("DELETE", "/threads/thr_a/tabs")).toBe(false);
    expect(isEvaAgentChatSidePanelRequest("GET", "/threads/thr_a/thread-storage/location")).toBe(true);
    expect(isEvaAgentChatSidePanelRequest("GET", "/threads/thr_a/thread-storage/paths")).toBe(false);
  });

  it("applies to top-level agent chats, not Admin or delegated threads", () => {
    expect(isEvaAgentChatSidePanelThread({ agentId: "crm", parentThreadId: null })).toBe(true);
    expect(isEvaAgentChatSidePanelThread({ agentId: "admin", parentThreadId: null })).toBe(false);
    expect(isEvaAgentChatSidePanelThread({ agentId: "crm", parentThreadId: "thr_p" })).toBe(false);
    expect(isEvaAgentChatSidePanelThread({ agentId: null, parentThreadId: null })).toBe(false);
  });
});
