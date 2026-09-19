import { CURATED_PLUGIN_MARKETPLACE_NAME } from "@bb/server-contract";
import {
  BUNDLED_MARKETPLACE_NAME,
  BUILTIN_PUBLISHER_LABEL,
} from "./marketplace-manifest.js";

const RESERVED_PUBLISHER_LABELS: ReadonlySet<string> = new Set([
  BUILTIN_PUBLISHER_LABEL,
  "EVA Integrations",
]);

const LEGACY_PRODUCT_LABELS: ReadonlyMap<string, string> = new Map([
  ["BB Official", BUILTIN_PUBLISHER_LABEL],
  ["BB Community", "EVA Integrations"],
]);

export function evaProductLabel(value: string): string {
  return LEGACY_PRODUCT_LABELS.get(value) ?? value;
}

export function marketplaceDisplayNameForProduct(args: {
  marketplaceName: string;
  displayName?: string | null;
}): string {
  const displayName = evaProductLabel(
    args.displayName?.trim() || args.marketplaceName,
  );
  if (
    args.marketplaceName === CURATED_PLUGIN_MARKETPLACE_NAME ||
    args.marketplaceName === BUNDLED_MARKETPLACE_NAME
  ) {
    return displayName;
  }
  return RESERVED_PUBLISHER_LABELS.has(displayName)
    ? args.marketplaceName
    : displayName;
}

export function marketplacePublisherLabel(args: {
  marketplaceName: string;
  displayName: string;
}): string {
  return marketplaceDisplayNameForProduct(args);
}

export function pluginPublisherLabel(args: {
  sourceKind: "path" | "builtin" | "npm" | "git";
  provenance: "builtin" | "direct" | "catalog";
  catalogMarketplaceName: string | null;
  labels: ReadonlyMap<string, string>;
}): string | null {
  if (args.sourceKind === "builtin" || args.provenance === "builtin") {
    return BUILTIN_PUBLISHER_LABEL;
  }
  if (args.provenance !== "catalog") return null;
  const name = args.catalogMarketplaceName;
  if (name === null) return null;
  return evaProductLabel(args.labels.get(name) ?? name);
}
