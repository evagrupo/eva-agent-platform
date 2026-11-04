/**
 * Platform rules for which models each provider may run, independent of any
 * user's access policy. Cursor is used only for its own Composer models and
 * for Grok; other vendors' models are run through their own providers.
 */
const PROVIDER_MODEL_RULES: Readonly<Record<string, (model: string) => boolean>> =
  {
    "acp-cursor": (model) => /^(composer|grok)(?:[-.:[]|$)/iu.test(model),
  };

export function isProviderModelSupported(
  providerId: string,
  model: string,
): boolean {
  const rule = PROVIDER_MODEL_RULES[providerId];
  if (rule === undefined) return true;
  // Runtime ids may carry a provider prefix, e.g. "acp-cursor/grok-4.7".
  const modelId = model.slice(model.lastIndexOf("/") + 1);
  return rule(modelId);
}

/**
 * The model to use when a thread's inherited model is not allowed on its
 * provider (for example older Cursor threads that recorded a GPT model).
 */
const PROVIDER_FALLBACK_MODELS: Readonly<Record<string, string>> = {
  "acp-cursor": "grok-4.7",
};

export function providerFallbackModel(providerId: string): string | undefined {
  return PROVIDER_FALLBACK_MODELS[providerId];
}
