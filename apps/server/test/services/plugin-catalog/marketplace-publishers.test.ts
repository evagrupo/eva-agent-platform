import { describe, expect, it } from "vitest";
import {
  marketplacePublisherLabel,
  pluginPublisherLabel,
} from "../../../src/services/plugin-catalog/marketplace-publishers.js";
import { BUNDLED_CURATED_MARKETPLACE } from "../../../src/services/plugin-catalog/curated-marketplace.js";

function publisherLabels(
  marketplaces: Array<{ marketplaceName: string; displayName: string }>,
): Map<string, string> {
  return new Map(
    marketplaces.map((marketplace) => [
      marketplace.marketplaceName,
      marketplacePublisherLabel(marketplace),
    ]),
  );
}

describe("marketplace publisher labels", () => {
  it("names each marketplace by its own product display name", () => {
    const labels = publisherLabels([
      { marketplaceName: "bb-community", displayName: "EVA Integrations" },
      { marketplaceName: "acme", displayName: "Acme Plugins" },
    ]);

    expect(
      pluginPublisherLabel({
        sourceKind: "git",
        provenance: "catalog",
        catalogMarketplaceName: "bb-community",
        labels,
      }),
    ).toBe("EVA Integrations");
    expect(
      pluginPublisherLabel({
        sourceKind: "npm",
        provenance: "catalog",
        catalogMarketplaceName: "acme",
        labels,
      }),
    ).toBe("Acme Plugins");
  });

  it("refuses a reserved label to a marketplace that is not EVA's", () => {
    const labels = publisherLabels([
      { marketplaceName: "acme", displayName: "BB Official" },
    ]);

    expect(
      pluginPublisherLabel({
        sourceKind: "git",
        provenance: "catalog",
        catalogMarketplaceName: "acme",
        labels,
      }),
    ).toBe("acme");
    expect(
      marketplacePublisherLabel({
        marketplaceName: "acme",
        displayName: "BB Community",
      }),
    ).toBe("acme");
    expect(
      marketplacePublisherLabel({
        marketplaceName: "bb-community",
        displayName: "EVA Integrations",
      }),
    ).toBe("EVA Integrations");
  });

  it("keeps a store-installed bundled plugin on EVA Official", () => {
    const labels = publisherLabels([
      { marketplaceName: "bb-community", displayName: "EVA Integrations" },
    ]);

    expect(
      pluginPublisherLabel({
        sourceKind: "builtin",
        provenance: "catalog",
        catalogMarketplaceName: "bb-community",
        labels,
      }),
    ).toBe("EVA Official");
  });

  it("badges bundled plugins EVA Official and user installs not at all", () => {
    const labels = publisherLabels([]);

    expect(
      pluginPublisherLabel({
        sourceKind: "builtin",
        provenance: "builtin",
        catalogMarketplaceName: null,
        labels,
      }),
    ).toBe("EVA Official");
    expect(
      pluginPublisherLabel({
        sourceKind: "git",
        provenance: "direct",
        catalogMarketplaceName: null,
        labels,
      }),
    ).toBeNull();
  });

  it("does not reuse EVA Official for the marketplace EVA curates", () => {
    expect(BUNDLED_CURATED_MARKETPLACE.displayName).toBe("EVA Integrations");
  });
});
