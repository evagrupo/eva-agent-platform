import { useEffect, useState } from "react";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { ResponsiveDrawerShell } from "@bb/shared-ui/responsive-overlay";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { MarkdownPreview } from "@/components/ui/markdown-preview";
import { sdk } from "@/lib/sdk";

export function AgentReportPanel({
  threadId,
  name,
  onClose,
}: {
  threadId: string;
  name: string | null;
  onClose: () => void;
}) {
  const compact = useIsCompactViewport();
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (name === null) return;
    const controller = new AbortController();
    setContent(null);
    setError(null);
    void sdk.evaAgents
      .report({ threadId, name, signal: controller.signal })
      .then((report) => {
        if (!controller.signal.aborted) setContent(report.content);
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError("This report could not be opened. Please try again.");
      });
    return () => controller.abort();
  }, [threadId, name]);
  const body = (
    <>
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <h2 className="text-base font-medium">Report</h2>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Close report"
          onClick={onClose}
        >
          <Icon name="X" />
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        {error ? (
          <p role="alert">{error}</p>
        ) : content === null ? (
          <p role="status">Opening report…</p>
        ) : (
          <MarkdownPreview
            content={content}
            allowHtml={false}
            imagePolicy="alt-text"
          />
        )}
      </div>
    </>
  );
  if (compact)
    return (
      <ResponsiveDrawerShell
        open={name !== null}
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
        srLabel="Report"
        contentClassName="flex h-full flex-col"
      >
        {body}
      </ResponsiveDrawerShell>
    );
  return name === null ? null : (
    <aside
      aria-label="Report"
      className="fixed inset-y-0 right-0 z-50 flex w-full max-w-xl flex-col border-l border-border bg-background shadow-xl"
    >
      {body}
    </aside>
  );
}
