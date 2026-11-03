export function agentReportName(
  path: string,
  storageRoot: string | null,
  threadId: string,
): string | null {
  const normalized = path.replaceAll("\\", "/");
  const prefix =
    storageRoot === null
      ? null
      : storageRoot.replaceAll("\\", "/").replace(/\/$/u, "") + "/reports/";
  const name =
    prefix !== null
      ? normalized.startsWith(prefix)
        ? normalized.slice(prefix.length)
        : null
      : normalized.split(`/thread-storage/${threadId}/reports/`)[1];
  return name && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,119}\.md$/iu.test(name)
    ? name
    : null;
}
