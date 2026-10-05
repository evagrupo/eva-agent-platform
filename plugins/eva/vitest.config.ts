import path from "node:path";
import {
  defineWorkspaceTestConfig,
  sharedWorkerProjects,
} from "../../vitest.shared.js";

export default defineWorkspaceTestConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    silent: "passed-only",
    projects: sharedWorkerProjects({
      pkgDir: __dirname,
      name: "bb-plugin-eva",
      include: ["**/*.test.{ts,tsx}"],
      aliases: { "@": path.resolve(__dirname, ".") },
    }),
  },
});
