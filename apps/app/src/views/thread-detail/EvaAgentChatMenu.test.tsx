// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createStore, Provider } from "jotai";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  experimental_THREAD_ACTION_GROUPS,
  type PluginThreadActionRegistration,
} from "@get-bb/plugin-sdk";
import { makeThreadListEntry } from "@bb/test-helpers/domain-fixtures";
import { CompactViewportOverrideProvider } from "@bb/shared-ui/hooks/use-compact-viewport";
import { threadQueryKey } from "@/hooks/queries/query-keys";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { CORE_THREAD_ACTIONS } from "@/lib/thread-actions/core-thread-actions";
import { threadListEntryActionTarget } from "@/lib/thread-actions/thread-action-target";
import {
  ThreadActionCollectors,
  resetThreadActionRegistryForTest,
} from "@/lib/thread-actions/thread-action-registry";
import {
  cancelFreshEvaAgentChat,
  isFreshEvaAgentChatRequested,
} from "@/lib/eva-fresh-chat";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";
import { EvaAgentChatMenu } from "./EvaAgentChatMenu";

const sdkThreads = vi.hoisted(() => ({
  pin: vi.fn(),
  unpin: vi.fn(),
  markRead: vi.fn(),
  markUnread: vi.fn(),
  unarchive: vi.fn(),
  update: vi.fn(),
  get: vi.fn(),
  experimental_regenerateTitle: vi.fn(),
}));

vi.mock("@/lib/sdk", () => ({ sdk: { threads: sdkThreads } }));
vi.mock("@/components/thread/ThreadActionsProvider", () => ({
  useThreadActions: () => ({
    requestArchiveThreads: vi.fn(),
    requestDeleteThreads: vi.fn(),
  }),
}));

const notificationsRun = vi.fn();
const notificationsAction: PluginThreadActionRegistration = {
  id: "notifications",
  title: "Notifications",
  icon: "BellDot",
  group: experimental_THREAD_ACTION_GROUPS.state,
  item: () => ({
    label: "Notifications",
    detail: "Replies only",
    icon: "BellDot",
    choices: {
      items: [
        { id: "replies", label: "Replies only", selected: true },
        { id: "all", label: "All activity" },
        { id: "muted", label: "Mute" },
      ],
    },
    run: notificationsRun,
  }),
};
const otherPluginAction: PluginThreadActionRegistration = {
  id: "move",
  title: "Move to section",
  icon: "SectionMove",
  group: experimental_THREAD_ACTION_GROUPS.organize,
  item: () => ({ label: "Move to section", icon: "SectionMove", run: vi.fn() }),
};

const chat = makeThreadListEntry({
  id: "thr_chat",
  projectId: "proj_personal",
  parentThreadId: null,
  archivedAt: null,
  pinnedAt: null,
  lastReadAt: 10,
  latestAttentionAt: 5,
  agentId: "meta",
});

function renderMenu(onOpenAgentSettings?: () => void) {
  const queryClient = new QueryClient();
  queryClient.setQueryData(threadQueryKey(chat.id), chat);
  setPluginSlotRegistrations(
    "push-notifications",
    makePluginRegistrationSet({ threadActions: [notificationsAction] }),
  );
  setPluginSlotRegistrations(
    "fixture",
    makePluginRegistrationSet({ threadActions: [otherPluginAction] }),
  );
  return render(
    <QueryClientProvider client={queryClient}>
      <Provider store={createStore()}>
        <MemoryRouter>
          <CompactViewportOverrideProvider isCompactViewport={false}>
            <ThreadActionCollectors
              coreRegistrations={CORE_THREAD_ACTIONS}
              requestRename={vi.fn()}
            />
            <EvaAgentChatMenu
              thread={threadListEntryActionTarget(chat)}
              onOpenAgentSettings={onOpenAgentSettings}
            />
          </CompactViewportOverrideProvider>
        </MemoryRouter>
      </Provider>
    </QueryClientProvider>,
  );
}

async function openMenu(): Promise<string[]> {
  fireEvent.pointerDown(screen.getByRole("button", { name: "Agent menu" }), {
    button: 0,
  });
  const menu = await waitFor(() => {
    const element = screen.getByRole("menu");
    if (element.querySelector('[role="menuitem"]') === null) {
      throw new Error("menu not ready");
    }
    return element;
  });
  return Array.from(menu.querySelectorAll('[role="menuitem"]')).map(
    (item) => item.textContent ?? "",
  );
}

afterEach(() => {
  cleanup();
  resetPluginSlotStoreForTest();
  resetThreadActionRegistryForTest();
  cancelFreshEvaAgentChat(chat.id);
  vi.clearAllMocks();
});

describe("EvaAgentChatMenu", () => {
  it("offers notifications, mark unread, a fresh chat, and agent settings only", async () => {
    renderMenu(vi.fn());
    const rows = await openMenu();
    expect(rows.some((row) => row.startsWith("Notifications"))).toBe(true);
    expect(rows).toContain("Mark unread");
    expect(rows).toContain("Start a fresh chat");
    expect(rows).toContain("Agent settings");
    for (const hidden of [
      "Copy link",
      "Pin",
      "Rename",
      "Regenerate title",
      "Archive",
      "Delete",
      "Move to section",
      "Open in split",
    ]) {
      expect(rows.some((row) => row.includes(hidden))).toBe(false);
    }
  });

  it("hides agent settings from people who cannot manage the agent", async () => {
    renderMenu(undefined);
    const rows = await openMenu();
    expect(rows).not.toContain("Agent settings");
    expect(rows).toContain("Start a fresh chat");
  });

  it("opens the agent settings", async () => {
    const openSettings = vi.fn();
    renderMenu(openSettings);
    await openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: /Agent settings/u }));
    await waitFor(() => expect(openSettings).toHaveBeenCalledTimes(1));
  });

  it("asks before starting a fresh chat", async () => {
    renderMenu(undefined);
    await openMenu();
    fireEvent.click(
      screen.getByRole("menuitem", { name: /Start a fresh chat/u }),
    );
    const confirm = await screen.findByRole("button", {
      name: "Start fresh chat",
    });
    expect(screen.getByText(/Earlier messages stay visible/u)).toBeTruthy();
    expect(isFreshEvaAgentChatRequested(chat.id)).toBe(false);
    fireEvent.click(confirm);
    expect(isFreshEvaAgentChatRequested(chat.id)).toBe(true);
  });

  it("can cancel the fresh chat confirmation", async () => {
    renderMenu(undefined);
    await openMenu();
    fireEvent.click(
      screen.getByRole("menuitem", { name: /Start a fresh chat/u }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(isFreshEvaAgentChatRequested(chat.id)).toBe(false);
  });
});
