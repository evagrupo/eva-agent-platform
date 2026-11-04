import { queueSplitDownload } from "@/lib/split-prefetch";
import { pluginDetailKeyFromRoute } from "@/components/plugin/plugin-detail-key";
import { useMemo } from "react";
import { disableGlobalCursorStyles } from "react-resizable-panels";
import { matchPath, Navigate, useLocation } from "react-router-dom";
import { useAtomValue } from "jotai";
import { splitLayoutAtom } from "@/lib/split-layout/atoms";
import { holdsPluginDetailPane } from "@/lib/split-layout/openPaneContentInSplit";
import "@bb/shared-ui/icon-extended";
import {
  APP_ROOT_ROUTE_PATH,
  LEGACY_PROJECT_COMPOSE_ROUTE_PATH,
  PLUGINS_ROUTE_PATH,
} from "@/lib/route-paths";
import type { PaneContent } from "@/lib/split-layout";
import { useRouteState } from "@/hooks/useRouteState";
import { LegacyProjectComposeRedirect } from "./LegacyProjectComposeRedirect";
import { SplitThreadArea } from "./thread-detail/SplitThreadArea";
import { paneContentForPathname } from "./thread-detail/splitThreadNavigation";
import { LazyPluginsView } from "./ToolsViewSplits";
import {
  canUseCoreCapability,
  canUseCorePlugin,
  useCoreAuth,
} from "@/lib/core-auth";

disableGlobalCursorStyles();

const ROOT_COMPOSE_CONTENT = { kind: "new-thread" } as const;

queueSplitDownload("markdown-html");

export default function SplitWorkspaceRoute() {
  const location = useLocation();
  const coreAuth = useCoreAuth();
  const { projectId, threadId, isThreadView } = useRouteState();
  const legacyProjectMatch = matchPath(
    LEGACY_PROJECT_COMPOSE_ROUTE_PATH,
    location.pathname,
  );

  const routeContent = useMemo<PaneContent | null>(() => {
    if (location.pathname === APP_ROOT_ROUTE_PATH) {
      return ROOT_COMPOSE_CONTENT;
    }
    if (isThreadView && projectId && threadId) {
      return { kind: "thread", projectId, threadId };
    }
    const content = paneContentForPathname(location.pathname);
    if (content?.kind === "plugin-detail" || content?.kind === "plugin-panel") {
      return content;
    }
    return null;
  }, [isThreadView, location.pathname, projectId, threadId]);

  const layout = useAtomValue(splitLayoutAtom);

  const threadReadAllowed =
    canUseCoreCapability(coreAuth, "threadOwnRead") ||
    canUseCoreCapability(coreAuth, "threadAllRead");
  const threadWriteAllowed =
    canUseCoreCapability(coreAuth, "threadOwnWrite") ||
    canUseCoreCapability(coreAuth, "threadAllWrite");

  const legacyProjectId = legacyProjectMatch?.params.projectId;
  if (legacyProjectId) {
    return <LegacyProjectComposeRedirect projectId={legacyProjectId} />;
  }
  if (routeContent === null) {
    return <Navigate to={APP_ROOT_ROUTE_PATH} replace />;
  }
  if (
    (routeContent.kind === "thread" && !threadReadAllowed) ||
    (routeContent.kind === "new-thread" && !threadWriteAllowed)
  ) {
    return (
      <main className="flex min-h-full items-center justify-center p-6">
        <p className="text-sm text-muted-foreground">
          This workspace area is unavailable under your current policy.
        </p>
      </main>
    );
  }
  if (
    (routeContent.kind === "plugin-detail" ||
      routeContent.kind === "plugin-panel") &&
    !canUseCorePlugin(coreAuth, routeContent.pluginId)
  ) {
    return <Navigate to={PLUGINS_ROUTE_PATH} replace />;
  }
  if (
    routeContent.kind === "plugin-detail" &&
    !holdsPluginDetailPane(layout, routeContent.pluginId)
  ) {
    return (
      <LazyPluginsView
        detailKey={pluginDetailKeyFromRoute(
          routeContent.pluginId,
          location.search,
        )}
      />
    );
  }
  return <SplitThreadArea routeContent={routeContent} />;
}
