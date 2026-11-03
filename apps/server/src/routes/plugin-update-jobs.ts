import type { Hono } from "hono";
import { assertPluginAllowed, isPluginAllowed } from "../access-policy.js";
import type { PluginUpdateJobs } from "../services/plugins/plugin-update-jobs.js";

export function registerPluginUpdateJobRoutes(
  app: Hono,
  jobs: PluginUpdateJobs,
): void {
  app.get("/plugins/update-jobs", (context) =>
    context.json({
      jobs: jobs.list().filter((job) => isPluginAllowed(context, job.pluginId)),
    }),
  );
  app.get("/plugins/update-jobs/:jobId", (context) => {
    const job = jobs.get(context.req.param("jobId"));
    if (job === undefined) {
      return context.json(
        { error: "unknown update job; the server may have restarted" },
        404,
      );
    }
    assertPluginAllowed(context, job.pluginId);
    return context.json({ job });
  });
}
