import { useEffect } from "react";
import { mountLocalization } from "@bb/shared-ui/language-content-script";

export function CoreLanguageMount() {
  useEffect(() => {
    const controller = new AbortController();
    mountLocalization({
      pluginId: "bb-core",
      generation: 1,
      signal: controller.signal,
    });
    return () => controller.abort();
  }, []);

  return null;
}
