import { isEvaAgentChatThread } from "../../agents/eva-agent-chat-presentation.js";

/**
 * People chatting with an EVA agent read what the agent shares in BB's side
 * panel, even when their policy turns off the side panel and file access in
 * general. This grant is narrow: only top-level agent chats they can already
 * read, and only files the agent put in the chat's own `reports/` folder.
 */
const REPORT_PATH_PATTERN =
  /^reports\/[A-Za-z0-9][A-Za-z0-9_-]{0,119}\.(?:md|txt|csv|json|pdf|png|jpe?g|gif|webp|svg|html)$/iu;

/** API paths the gate lets through; the routes then apply `isEvaAgentChat…`. */
const SIDE_PANEL_TABS_PATH = /^\/threads\/[^/]+\/tabs$/u;
const SIDE_PANEL_STORAGE_LOCATION_PATH =
  /^\/threads\/[^/]+\/thread-storage\/location$/u;
const SIDE_PANEL_REPORT_FILE_PATH =
  /^\/threads\/[^/]+\/thread-storage\/files\/(.+)$/u;

export function isEvaAgentChatReportPath(filePath: string): boolean {
  let decoded: string;
  try {
    decoded = decodeURIComponent(filePath);
  } catch {
    return false;
  }
  return REPORT_PATH_PATTERN.test(decoded);
}

/**
 * True for the side panel requests the capability gate defers to the route:
 * the thread's tab state, where its storage is, and one report file in it.
 */
export function isEvaAgentChatSidePanelRequest(
  method: string,
  path: string,
): boolean {
  if (SIDE_PANEL_TABS_PATH.test(path)) {
    return method === "GET" || method === "PUT";
  }
  if (SIDE_PANEL_STORAGE_LOCATION_PATH.test(path)) return method === "GET";
  const file = SIDE_PANEL_REPORT_FILE_PATH.exec(path);
  return (
    file !== null &&
    (method === "GET" || method === "HEAD") &&
    isEvaAgentChatReportPath(file[1]!)
  );
}

export function isEvaAgentChatSidePanelThread(thread: {
  agentId: string | null;
  parentThreadId: string | null;
}): boolean {
  return isEvaAgentChatThread(thread);
}
