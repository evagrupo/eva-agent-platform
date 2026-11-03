import { useEffect, useState } from "react";
import { useSdk } from "@get-bb/plugin-sdk/app";

export function useEvaAgents() {
  const sdk = useSdk();
  const [data, setData] =
    useState<Awaited<ReturnType<typeof sdk.evaAgents.list>>>();
  useEffect(() => {
    const controller = new AbortController();
    void sdk.evaAgents
      .list({ signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) setData(result);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [sdk]);
  return { data };
}
