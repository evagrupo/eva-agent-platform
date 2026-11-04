import { composerRendererProviderAtom } from "@/components/promptbox/composer-provider";
import {
  diffRendererProviderAtom,
  sourceCodeRendererProviderAtom,
} from "@/components/code/codeRendererProvider";
import { usePluginSlots } from "@/lib/plugin-slots";
import { ReplacementProviderSetting } from "./ReplacementProviderSetting";

export function CodeRendererSettings() {
  const { sourceCodeRenderers, diffRenderers, composers } = usePluginSlots();
  return (
    <>
      <ReplacementProviderSetting
        label="Source code"
        triggerAriaLabel="Source code"
        description="Choose automatic activation, EVA's viewer, or a specific integration on this device."
        builtInDescription="Syntax highlighting and gutters from the EVA code theme."
        preferenceAtom={sourceCodeRendererProviderAtom}
        slots={sourceCodeRenderers}
      />
      <ReplacementProviderSetting
        label="Diffs"
        triggerAriaLabel="Diffs"
        description="Applies to file diffs in threads, the diff panel, and plugin views."
        builtInDescription="Unified and split diffs from the EVA code theme."
        preferenceAtom={diffRendererProviderAtom}
        slots={diffRenderers}
      />
      <ReplacementProviderSetting
        label="Composer"
        triggerAriaLabel="Composer"
        description="The prompt box in threads, the New thread screen, and message editors."
        preferenceAtom={composerRendererProviderAtom}
        slots={composers}
      />
    </>
  );
}
