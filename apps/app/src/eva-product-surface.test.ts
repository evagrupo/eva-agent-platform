import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const productFiles = [
  "../index.html",
  "./views/SettingsView.tsx",
  "./components/settings/settings-sections.ts",
  "./components/plugin/browse-hero/browse-hero-archetypes.ts",
  "./components/sidebar/SidebarNavigationRegion.tsx",
  "./components/sidebar/AppSidebar.tsx",
  "./components/sidebar/sidebarFooterPreferences.ts",
  "./components/AppErrorBoundary.tsx",
  "./components/plugin/management/AddPluginDialog.tsx",
  "./components/plugin/management/PluginMarketplaceListing.tsx",
  "./components/plugin/management/BrowsePluginsTab.tsx",
  "./components/plugin/plugins-collection-copy.ts",
  "./components/plugin/management/PluginUpdatesCard.tsx",
  "./components/plugin/management/UpdatePluginDialog.tsx",
  "./components/plugin/management/PluginRowSignal.stories.tsx",
  "./components/plugin/management/plugin-status.ts",
  "./components/dialogs/AddMachineDialog.stories.tsx",
  "./components/tools/PluginDetail.tsx",
  "./components/tools/ProvenancePill.tsx",
  "./components/tools/SkillsCollection.tsx",
  "./components/tools/PluginsAndSkillsDetailStates.stories.tsx",
  "./components/settings/MarketplacesSettingsSection.tsx",
  "./components/settings/CliSkillsSettingsSection.tsx",
  "./components/settings/InstallCliSkillsDialog.tsx",
  "./components/settings/UpdatesSettingsSection.tsx",
  "./components/provider-cli/provider-cli-install.tsx",
  "./lib/core-auth.tsx",
  "./lib/plugin-frontend.ts",
  "./views/EvaAdminDashboardView.tsx",
  "./views/EvaAgentsView.tsx",
  "./components/sidebar/BuiltInSidebarNavigation.tsx",
];

describe("EVA product surface", () => {
  it.each(productFiles)(
    "does not expose upstream product labels in %s",
    (file) => {
      const source = readFileSync(new URL(file, import.meta.url), "utf8");
      expect(source).not.toMatch(
        /Report a bug|Plugin marketplaces|github\.com\/get-bb|BB Official|BB Community|without leaving bb|(?:requires|running|this|with|update|restart|reinstall|compatible with your|cannot connect to) bb\b/iu,
      );
    },
  );

  it("uses the EVA title and logo asset", () => {
    const source = readFileSync(
      new URL("../index.html", import.meta.url),
      "utf8",
    );
    expect(source).toContain("EVA Internal Agent Platform");
    expect(source).toContain("/eva/favicon-leaf-32.png");
    expect(source).toContain("/eva/favicon-leaf-16.png");
  });
});
