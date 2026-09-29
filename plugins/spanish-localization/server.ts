import type { BbPluginApi } from "@get-bb/plugin-sdk";

/**
 * The language preference is intentionally browser-local.
 * This required BB server entry does not persist or broadcast any language.
 */
export default function plugin(bb: BbPluginApi): void {
  bb.log.info("loaded; language preference is stored per browser profile");
}
