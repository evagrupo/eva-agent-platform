import path from "node:path";
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  CREATIVITY_PROJECT_ID,
  REMOTION_PACKAGE_NAME,
  REMOTION_PROJECT_DIRECTORY,
} from "./src/preview-context";

export const previewAvailabilityRpcContract = defineRpcContract({
  getPreviewAvailability: {
    input: z.object({ threadId: z.string().trim().min(1) }).strict(),
    output: z
      .object({
        enabled: z.boolean(),
        reason: z.string().optional(),
      })
      .strict(),
  },
});

type PreviewAvailability = {
  enabled: boolean;
  reason?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasRemotionDependency(manifest: Record<string, unknown>): boolean {
  for (const group of ["dependencies", "devDependencies"]) {
    const dependencies = manifest[group];
    if (isRecord(dependencies) && typeof dependencies.remotion === "string") {
      return true;
    }
  }
  return false;
}

function unavailable(reason: string): PreviewAvailability {
  return { enabled: false, reason };
}

export async function getPreviewAvailability(
  bb: BbPluginApi,
  threadId: string,
): Promise<PreviewAvailability> {
  let thread;
  try {
    thread = await bb.sdk.threads.get({
      threadId,
      include: "environment",
    });
  } catch {
    return unavailable(
      "The current BB thread could not be checked for a Remotion workspace.",
    );
  }

  if (thread.projectId !== CREATIVITY_PROJECT_ID) {
    return unavailable(
      "The Remotion preview is only available in the Creativity agent.",
    );
  }

  if (!("environment" in thread) || !thread.environment) {
    return unavailable(
      "Open a ready Creativity environment containing the Remotion project first.",
    );
  }

  const environment = thread.environment;
  if (
    environment.projectId !== CREATIVITY_PROJECT_ID ||
    environment.status !== "ready" ||
    typeof environment.path !== "string" ||
    typeof environment.hostId !== "string"
  ) {
    return unavailable(
      "Open a ready Creativity environment containing the Remotion project first.",
    );
  }

  const rootPath = environment.path;
  const packageJsonPath = path.resolve(
    rootPath,
    REMOTION_PROJECT_DIRECTORY,
    "package.json",
  );

  let packageFile;
  try {
    packageFile = await bb.sdk.files.read({
      path: packageJsonPath,
      rootPath,
      hostId: environment.hostId,
    });
  } catch {
    return unavailable(
      "The Creativity environment does not contain the Remotion project.",
    );
  }

  if (
    packageFile.contentEncoding !== "utf8" ||
    typeof packageFile.content !== "string"
  ) {
    return unavailable(
      "The Remotion project manifest could not be read as text.",
    );
  }

  let manifest: unknown;
  try {
    manifest = JSON.parse(packageFile.content);
  } catch {
    return unavailable("The Remotion project manifest is not valid JSON.");
  }

  if (
    !isRecord(manifest) ||
    manifest.name !== REMOTION_PACKAGE_NAME ||
    !hasRemotionDependency(manifest)
  ) {
    return unavailable(
      "The current Creativity workspace is not the Remotion project.",
    );
  }

  return { enabled: true };
}

export default function plugin(bb: BbPluginApi) {
  bb.rpc.register(previewAvailabilityRpcContract, {
    getPreviewAvailability: ({ threadId }) =>
      getPreviewAvailability(bb, threadId),
  });
  bb.log.info("Remotion Live Preview loaded");
}
