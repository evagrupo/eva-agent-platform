import path from "node:path";
import { describe, expect, it } from "vitest";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import {
  CREATIVITY_PROJECT_ID,
  REMOTION_PACKAGE_NAME,
  REMOTION_PROJECT_DIRECTORY,
} from "./src/preview-context";
import { getPreviewAvailability } from "./server";

const ROOT_PATH = "/workspace/creativity";
const HOST_ID = "host-creativity";
const THREAD_ID = "thr-current";
const VALID_MANIFEST = JSON.stringify({
  name: REMOTION_PACKAGE_NAME,
  dependencies: { remotion: "4.0.523" },
});

function createBb(thread: unknown, packageContent = VALID_MANIFEST) {
  const fileReads: unknown[] = [];
  const bb = {
    sdk: {
      threads: {
        get: async () => thread,
      },
      files: {
        read: async (args: unknown) => {
          fileReads.push(args);
          return {
            content: packageContent,
            contentEncoding: "utf8",
            sizeBytes: packageContent.length,
            sha256: "test-sha",
          };
        },
      },
    },
  } as unknown as BbPluginApi;
  return { bb, fileReads };
}

function readyThread(overrides: Record<string, unknown> = {}) {
  return {
    projectId: CREATIVITY_PROJECT_ID,
    environment: {
      id: "env-creativity",
      projectId: CREATIVITY_PROJECT_ID,
      hostId: HOST_ID,
      path: ROOT_PATH,
      status: "ready",
      ...overrides,
    },
  };
}

describe("Remotion Live Preview server scope", () => {
  it("enables the preview for the ready Creativity Remotion workspace", async () => {
    const { bb, fileReads } = createBb(readyThread());
    await expect(getPreviewAvailability(bb, THREAD_ID)).resolves.toEqual({
      enabled: true,
    });
    expect(fileReads).toEqual([
      {
        path: path.resolve(
          ROOT_PATH,
          REMOTION_PROJECT_DIRECTORY,
          "package.json",
        ),
        rootPath: ROOT_PATH,
        hostId: HOST_ID,
      },
    ]);
  });

  it("denies the preview for another BB project before reading files", async () => {
    const { bb, fileReads } = createBb({
      ...readyThread(),
      projectId: "proj-other",
    });
    await expect(getPreviewAvailability(bb, THREAD_ID)).resolves.toEqual({
      enabled: false,
      reason: "The Remotion preview is only available in the Creativity agent.",
    });
    expect(fileReads).toHaveLength(0);
  });

  it("denies the preview without a ready environment", async () => {
    const { bb, fileReads } = createBb({
      projectId: CREATIVITY_PROJECT_ID,
      environment: null,
    });
    await expect(getPreviewAvailability(bb, THREAD_ID)).resolves.toMatchObject({
      enabled: false,
    });
    expect(fileReads).toHaveLength(0);
  });

  it("denies the preview when the workspace is not the Remotion project", async () => {
    const { bb } = createBb(
      readyThread(),
      JSON.stringify({ name: "another-project", dependencies: {} }),
    );
    await expect(getPreviewAvailability(bb, THREAD_ID)).resolves.toEqual({
      enabled: false,
      reason: "The current Creativity workspace is not the Remotion project.",
    });
  });
});
