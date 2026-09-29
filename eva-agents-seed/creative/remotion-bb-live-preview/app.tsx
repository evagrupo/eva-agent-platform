import { useEffect, useState } from "react";
import { Player } from "@remotion/player";
import {
  definePluginApp,
  useBbContext,
  useBbNavigate,
  useRpc,
  type BbNavigate,
  type JsonValue,
  type PluginThreadHeaderActionProps,
  type PluginThreadPanelProps,
} from "@get-bb/plugin-sdk/app";
import {
  COMPOSITION_CATALOG,
  DEFAULT_COMPOSITION_ID,
  getCompositionDefinition,
  type CompositionDefinition,
} from "./src/composition-registry";
import { CREATIVITY_PROJECT_ID } from "./src/preview-context";
import type { previewAvailabilityRpcContract } from "./server";
import "./app.css";

const PREVIEW_ACTION_ID = "live-preview";
const PREVIEW_TITLE = "Remotion Preview";

const PREVIEW_SCOPE_COPY =
  "The Remotion preview is only available in the Creativity agent.";
const PREVIEW_UNAVAILABLE_COPY =
  "Open a ready Creativity environment containing the Remotion project first.";

type PreviewAvailabilityState =
  | { readonly status: "checking" }
  | { readonly status: "allowed" }
  | {
      readonly status: "unavailable";
      readonly copy: string;
    };

function usePreviewAvailability(
  threadId: string,
  projectId: string | null,
): PreviewAvailabilityState {
  const rpc = useRpc<typeof previewAvailabilityRpcContract>();
  const eligibleSurface =
    projectId === CREATIVITY_PROJECT_ID && threadId.trim().length > 0;
  const [remoteState, setRemoteState] = useState<PreviewAvailabilityState>({
    status: "checking",
  });

  useEffect(() => {
    let cancelled = false;

    if (!eligibleSurface) {
      setRemoteState({ status: "unavailable", copy: PREVIEW_SCOPE_COPY });
      return () => {
        cancelled = true;
      };
    }

    setRemoteState({ status: "checking" });
    void rpc
      .call("getPreviewAvailability", { threadId })
      .then((availability) => {
        if (cancelled) return;
        setRemoteState(
          availability.enabled
            ? { status: "allowed" }
            : {
                status: "unavailable",
                copy: availability.reason ?? PREVIEW_UNAVAILABLE_COPY,
              },
        );
      })
      .catch(() => {
        if (cancelled) return;
        setRemoteState({
          status: "unavailable",
          copy: PREVIEW_UNAVAILABLE_COPY,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [eligibleSurface, rpc, threadId]);

  if (!eligibleSurface) {
    return {
      status: "unavailable",
      copy: PREVIEW_SCOPE_COPY,
    };
  }

  return remoteState;
}

type PreviewParams = {
  readonly compositionId: string;
} & Record<string, JsonValue>;

function isPreviewParams(value: JsonValue | null): value is PreviewParams {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof value.compositionId === "string" &&
    value.compositionId.trim().length > 0
  );
}

function getPreviewTitle(compositionId: string): string {
  const definition = getCompositionDefinition(compositionId);
  return definition
    ? PREVIEW_TITLE + " · " + definition.title
    : PREVIEW_TITLE;
}

function openPreview(
  navigate: BbNavigate,
  compositionId: string = DEFAULT_COMPOSITION_ID,
): boolean {
  return navigate.openThreadPanel({
    actionId: PREVIEW_ACTION_ID,
    title: getPreviewTitle(compositionId),
    params: { compositionId },
  });
}

function ThreadPreviewAction({
  threadId,
  projectId,
  isCompactViewport,
}: PluginThreadHeaderActionProps) {
  const navigate = useBbNavigate();
  const availability = usePreviewAvailability(threadId, projectId);

  if (availability.status !== "allowed") {
    return null;
  }

  return (
    <button
      className="remotion-thread-header-action"
      onClick={() => openPreview(navigate)}
      type="button"
      aria-label="Open Remotion preview"
      title="Open Remotion preview in this thread"
    >
      <span aria-hidden="true">▶</span>
      {isCompactViewport ? null : <span>Preview</span>}
    </button>
  );
}

function PreviewState({
  title,
  copy,
}: {
  readonly title: string;
  readonly copy: string;
}) {
  return (
    <div className="remotion-preview-state bg-background text-foreground">
      <div className="remotion-preview-state__content">
        <h2 className="remotion-preview-state__title">{title}</h2>
        <p className="remotion-preview-state__copy">{copy}</p>
      </div>
    </div>
  );
}

function formatDuration(definition: CompositionDefinition): string {
  const seconds = definition.durationInFrames / definition.fps;
  const value = Number.isInteger(seconds) ? String(seconds) : seconds.toFixed(1);
  return value + " seconds";
}

function RemotionPreviewPanel({
  threadId,
  params,
}: PluginThreadPanelProps) {
  const navigate = useBbNavigate();
  const { projectId: activeProjectId, threadId: activeThreadId } = useBbContext();
  const availability = usePreviewAvailability(
    threadId,
    activeThreadId === threadId ? activeProjectId : null,
  );

  if (availability.status === "checking") {
    return (
      <PreviewState
        title="Checking Remotion project"
        copy="Confirming that this thread is the active Creativity Remotion workspace."
      />
    );
  }

  if (availability.status === "unavailable") {
    return <PreviewState title="Preview unavailable" copy={availability.copy} />;
  }

  if (params !== null && !isPreviewParams(params)) {
    return (
      <PreviewState
        title="Preview unavailable"
        copy="This thread tab received an invalid composition target. Open Remotion Preview again from the thread header."
      />
    );
  }

  const compositionId = isPreviewParams(params)
    ? params.compositionId
    : DEFAULT_COMPOSITION_ID;
  const definition = getCompositionDefinition(compositionId);

  if (!definition) {
    return (
      <PreviewState
        title="Composition not found"
        copy={
          "No local composition named “" +
          compositionId +
          "” is registered in this project."
        }
      />
    );
  }

  return (
    <section
      className="remotion-preview-panel"
      aria-label="Remotion video preview attached to this thread"
    >
      <header className="remotion-preview-panel__topline">
        <div>
          <p className="remotion-preview-panel__eyebrow">Current BB thread</p>
          <h1 className="remotion-preview-panel__title">{definition.title}</h1>
        </div>
        <span className="remotion-preview-panel__meta">{definition.id}</span>
      </header>

      <div
        className="remotion-preview-picker"
        role="group"
        aria-label="Remotion templates"
      >
        <div className="remotion-preview-picker__heading">
          <p className="remotion-preview-picker__eyebrow">Templates</p>
          <span className="remotion-preview-picker__hint">
            Open another as a new BB tab
          </span>
        </div>
        <div className="remotion-preview-picker__options">
          {COMPOSITION_CATALOG.map((option) => {
            const isActive = option.id === definition.id;
            return (
              <button
                key={option.id}
                type="button"
                className={
                  isActive
                    ? "remotion-preview-picker__option remotion-preview-picker__option--active"
                    : "remotion-preview-picker__option"
                }
                aria-pressed={isActive}
                aria-label={"Open " + option.title + " preview"}
                onClick={() => {
                  openPreview(navigate, option.id);
                }}
              >
                <span className="remotion-preview-picker__option-title">
                  {option.title}
                </span>
                <span className="remotion-preview-picker__option-meta">
                  {option.width}×{option.height} · {option.fps} fps
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="remotion-preview-panel__player">
        <Player
          acknowledgeRemotionLicense
          component={definition.component}
          compositionHeight={definition.height}
          compositionWidth={definition.width}
          controls
          durationInFrames={definition.durationInFrames}
          fps={definition.fps}
          inputProps={definition.inputProps}
          loop
          style={{ width: "100%", height: "100%" }}
        />
      </div>

      <div
        className="remotion-preview-panel__details"
        aria-label="Video details"
      >
        <span>{formatDuration(definition)}</span>
        <span>
          {definition.width}×{definition.height}
        </span>
        <span>{definition.fps} fps</span>
      </div>
      <p className="remotion-preview-panel__hint">
        Select a template to open it as a sibling tab in this thread. Edit
        <code>src/Composition.tsx</code>, run <code>npm run build:plugin</code>,
        then reload the installed BB plugin to update the previews.
      </p>
    </section>
  );
}

export default definePluginApp((app) => {
  app.slots.threadPanelAction({
    id: PREVIEW_ACTION_ID,
    title: PREVIEW_TITLE,
    icon: "Play",
    component: RemotionPreviewPanel,
    layout: "flush",
  });
  app.slots.experimental_threadHeaderAction({
    id: "open-preview",
    title: "Remotion Preview",
    component: ThreadPreviewAction,
  });
});
