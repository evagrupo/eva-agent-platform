export function modelPermits(rules: readonly string[], model: string): boolean {
  return rules.some((rule) => {
    if (rule === "*") return true;
    const qualifiedRule = rule.includes("/");
    const qualifiedModel = model.includes("/");
    const candidateRule =
      qualifiedRule && !qualifiedModel
        ? rule.slice(rule.lastIndexOf("/") + 1)
        : rule;
    const candidateModel =
      qualifiedModel && !qualifiedRule
        ? model.slice(model.lastIndexOf("/") + 1)
        : model;
    if (candidateRule.endsWith("*")) {
      return candidateModel.startsWith(candidateRule.slice(0, -1));
    }
    return candidateRule === candidateModel;
  });
}
