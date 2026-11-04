import { useMemo, useState } from "react";
import {
  experimental_THREAD_ACTION_GROUPS as GROUPS,
  type PluginThreadActionTarget,
} from "@get-bb/plugin-sdk";
import { Button } from "@bb/shared-ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@bb/shared-ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import { Icon } from "@bb/shared-ui/icon";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { cn } from "@bb/shared-ui/lib/utils";
import { HEADER_ICON_BUTTON_CLASS } from "@/components/layout/AppPageHeader";
import {
  ThreadActionMenuRows,
  type ThreadActionMenuEntry,
} from "@/components/thread/ThreadActionMenuItems";
import {
  bindThreadAction,
  CORE_THREAD_ACTION_OWNER,
  useThreadActionEntries,
} from "@/lib/thread-actions/thread-action-registry";
import { requestFreshEvaAgentChat } from "@/lib/eva-fresh-chat";

const MENU_LABEL = "Agent menu";

/** Thread actions an agent chat keeps; everything else stays hidden there. */
export const EVA_AGENT_CHAT_MENU_ACTION_KEYS = [
  "push-notifications/notifications",
  `${CORE_THREAD_ACTION_OWNER}/read`,
] as const;

const noRename = () => {};

interface EvaAgentChatMenuProps {
  thread: PluginThreadActionTarget;
  onOpenAgentSettings?: () => void;
  onCloseAutoFocus?: (event: Event) => void;
}

/**
 * The header menu of an EVA agent chat: notifications, mark unread, start a
 * fresh chat, and (for administrators) the agent's settings. Thread actions
 * such as copy link, pin, rename, archive, and delete are not offered here.
 */
export function EvaAgentChatMenu({
  thread,
  onOpenAgentSettings,
  onCloseAutoFocus,
}: EvaAgentChatMenuProps) {
  const isCompactViewport = useIsCompactViewport();
  const [drawerStep, setDrawerStep] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const entries = useThreadActionEntries(thread, { requestRename: noRename });
  const groups = useMemo(() => {
    const byKey = new Map(entries.map((entry) => [entry.key, entry]));
    const kept = EVA_AGENT_CHAT_MENU_ACTION_KEYS.flatMap((key) => {
      const entry = byKey.get(key);
      return entry === undefined ? [] : [{ ...entry, group: GROUPS.state }];
    });
    const chat: ThreadActionMenuEntry[] =
      thread.archivedAt === null
        ? [
            {
              key: "eva-agent-chat/fresh",
              group: GROUPS.organize,
              action: bindThreadAction(
                "eva-agent-chat/fresh",
                {
                  label: "Start a fresh chat",
                  icon: "MessageSquarePlus",
                  run: () => {
                    window.setTimeout(() => setConfirmOpen(true), 0);
                  },
                },
                noRename,
              ),
            },
          ]
        : [];
    const settings: ThreadActionMenuEntry[] = onOpenAgentSettings
      ? [
          {
            key: "eva-agent-chat/settings",
            group: GROUPS.settings,
            action: bindThreadAction(
              "eva-agent-chat/settings",
              {
                label: "Agent settings",
                icon: "Settings",
                run: () => onOpenAgentSettings(),
              },
              noRename,
            ),
          },
        ]
      : [];
    return [kept, chat, settings].filter((group) => group.length > 0);
  }, [entries, onOpenAgentSettings, thread.archivedAt]);

  return (
    <>
      <DropdownMenu
        modal={false}
        onOpenChange={(open) => {
          if (!open) setDrawerStep(null);
        }}
      >
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn(
              "rounded-md p-0",
              "data-[state=open]:bg-state-active data-[state=open]:text-foreground",
              HEADER_ICON_BUTTON_CLASS,
            )}
            aria-label={MENU_LABEL}
            onClick={(event) => event.stopPropagation()}
          >
            <Icon name="MoreHorizontal" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          mobileTitle={MENU_LABEL}
          onCloseAutoFocus={onCloseAutoFocus}
        >
          <ThreadActionMenuRows
            groups={groups}
            surface="dropdown"
            isDrawer={isCompactViewport}
            drawerStep={drawerStep}
            onDrawerStepChange={setDrawerStep}
          />
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Start a fresh chat?</DialogTitle>
            <DialogDescription>
              Your next message starts a new conversation. Earlier messages
              stay visible above, and what the agent remembers about you is
              kept.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => {
                requestFreshEvaAgentChat(thread.id);
                setConfirmOpen(false);
              }}
            >
              Start fresh chat
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
