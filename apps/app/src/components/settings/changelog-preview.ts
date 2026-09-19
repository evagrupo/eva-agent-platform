import changelogSource from "../../../../../CHANGELOG.md?raw";
import {
  parseChangelog,
  type ChangelogEntry,
} from "../../../../../changelog-parser";
export { RELEASE_META } from "../../../../../changelog-metadata";
export type { ChangelogBlock } from "../../../../../changelog-parser";

function sanitizeChangelogText(text: string): string {
  return text
    .replace(/\bBB\b/gu, "EVA")
    .replace(/\bbb\b/gu, "EVA")
    .replace(/@get-bb\/plugin-sdk/gu, "EVA plugin SDK");
}

function sanitizeChangelogEntries(
  entries: readonly ChangelogEntry[],
): ChangelogEntry[] {
  return entries.map((entry) => ({
    ...entry,
    lede: entry.lede.map((block) =>
      block.kind === "list"
        ? { ...block, items: block.items.map(sanitizeChangelogText) }
        : { ...block, text: sanitizeChangelogText(block.text) },
    ),
    sections: entry.sections.map((section) => ({
      ...section,
      title: sanitizeChangelogText(section.title),
      blocks: section.blocks.map((block) =>
        block.kind === "list"
          ? { ...block, items: block.items.map(sanitizeChangelogText) }
          : { ...block, text: sanitizeChangelogText(block.text) },
      ),
    })),
  }));
}

export const CHANGELOG_ENTRIES = sanitizeChangelogEntries(
  parseChangelog(changelogSource),
);

export const LATEST_CHANGELOG_ENTRY: ChangelogEntry | null =
  CHANGELOG_ENTRIES[0] ?? null;

export async function fetchLatestChangelogEntry(
  fetchFn: typeof fetch,
  signal?: AbortSignal,
): Promise<ChangelogEntry> {
  void fetchFn;
  void signal;
  const [entry] = CHANGELOG_ENTRIES;
  if (entry === undefined) {
    throw new Error("The changelog has no releases");
  }
  return entry;
}
