import { cn } from "@bb/shared-ui/lib/utils";
import { Icon } from "@bb/shared-ui/icon";
import {
  BannerActionSlot,
  PromptBannerActionButton,
} from "@bb/shared-ui/prompt-banner-actions";
import {
  PromptStackCard,
  PROMPT_STACK_CARD_ROW_HEIGHT,
  PROMPT_STACK_INLAY_INSET_CLASS,
  PROMPT_STACK_INLAY_SEGMENT_CLASS,
} from "@/components/promptbox/banner/PromptStackCard";

/** Above the composer once the person chose "Start a fresh chat". */
export function EvaAgentFreshChatNotice({ onCancel }: { onCancel: () => void }) {
  return (
    <PromptStackCard
      ariaLabel="Fresh chat"
      className="overflow-hidden"
      style={{ minHeight: PROMPT_STACK_CARD_ROW_HEIGHT }}
    >
      <div
        className={cn(
          "flex items-center gap-0.5 text-xs text-muted-foreground",
          PROMPT_STACK_INLAY_INSET_CLASS,
        )}
      >
        <div
          role="status"
          className={cn(
            "flex min-w-0 flex-1 items-center gap-1.5 text-xs",
            PROMPT_STACK_INLAY_SEGMENT_CLASS,
          )}
        >
          <Icon name="MessageSquarePlus" className="size-3.5 shrink-0" />
          <span className="min-w-0 truncate">
            Your next message starts a fresh chat
          </span>
        </div>
        <BannerActionSlot hideInTiny={false}>
          <PromptBannerActionButton onClick={onCancel}>
            Cancel
          </PromptBannerActionButton>
        </BannerActionSlot>
      </div>
    </PromptStackCard>
  );
}
