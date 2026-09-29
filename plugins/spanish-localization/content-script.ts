import {
  LANGUAGE_EVENT,
  LANGUAGE_STORAGE_KEY,
  languageFromPayload,
  readStoredLanguage,
  translateText,
  type Language,
} from "./localization.js";

const translatedAttributes = [
  "aria-label",
  "aria-description",
  "aria-placeholder",
  "aria-roledescription",
  "aria-valuetext",
  "title",
  "placeholder",
  "alt",
  "data-tooltip",
  "data-tooltip-content",
] as const;

const ignoredTags = new Set([
  "CODE",
  "PRE",
  "SCRIPT",
  "STYLE",
  "NOSCRIPT",
  "TEMPLATE",
]);

type TranslationEntry = {
  source: string;
  translated: string;
};

function isIgnoredTextNode(node: Text): boolean {
  const parent = node.parentElement;
  if (parent === null) return true;
  if (
    parent.closest(
      '[contenteditable="true"], [data-bb-i18n-ignore], [data-bb-spanish-localization-ignore]',
    ) !== null
  ) {
    return true;
  }

  let current: Element | null = parent;
  while (current !== null) {
    if (ignoredTags.has(current.tagName)) return true;
    current = current.parentElement;
  }
  return false;
}

function isIgnoredAttribute(element: Element): boolean {
  if (ignoredTags.has(element.tagName)) return true;
  return (
    element.closest(
      "[data-bb-i18n-ignore], [data-bb-spanish-localization-ignore]",
    ) !== null
  );
}

function restoreText(
  node: Text,
  entries: WeakMap<Text, TranslationEntry>,
): void {
  const entry = entries.get(node);
  if (entry === undefined) return;
  if (node.nodeValue === entry.translated) node.nodeValue = entry.source;
  entries.delete(node);
}

function translateTextNode(
  node: Text,
  language: Language,
  entries: WeakMap<Text, TranslationEntry>,
  trackedNodes: Set<Text>,
): void {
  if (language === "en" || isIgnoredTextNode(node)) {
    restoreText(node, entries);
    return;
  }

  const current = node.nodeValue ?? "";
  const previous = entries.get(node);
  const source =
    previous !== undefined && current === previous.translated
      ? previous.source
      : current;
  const translated = translateText(source, language);
  entries.set(node, { source, translated });
  trackedNodes.add(node);
  if (current !== translated) node.nodeValue = translated;
}

function attributeEntriesFor(
  element: Element,
  entries: WeakMap<Element, Map<string, TranslationEntry>>,
): Map<string, TranslationEntry> {
  const existing = entries.get(element);
  if (existing !== undefined) return existing;
  const created = new Map<string, TranslationEntry>();
  entries.set(element, created);
  return created;
}

function restoreAttribute(
  element: Element,
  name: string,
  entries: WeakMap<Element, Map<string, TranslationEntry>>,
): void {
  const elementEntries = entries.get(element);
  const entry = elementEntries?.get(name);
  if (entry === undefined) return;
  if (element.getAttribute(name) === entry.translated) {
    element.setAttribute(name, entry.source);
  }
  elementEntries?.delete(name);
}

function translateAttribute(
  element: Element,
  name: string,
  language: Language,
  entries: WeakMap<Element, Map<string, TranslationEntry>>,
  trackedElements: Set<Element>,
): void {
  if (language === "en" || isIgnoredAttribute(element)) {
    restoreAttribute(element, name, entries);
    return;
  }

  const current = element.getAttribute(name);
  if (current === null || current.trim() === "") return;
  const elementEntries = attributeEntriesFor(element, entries);
  const previous = elementEntries.get(name);
  const source =
    previous !== undefined && current === previous.translated
      ? previous.source
      : current;
  const translated = translateText(source, language);
  elementEntries.set(name, { source, translated });
  trackedElements.add(element);
  if (current !== translated) element.setAttribute(name, translated);
}

function scanDocument(
  language: Language,
  textEntries: WeakMap<Text, TranslationEntry>,
  attributeEntries: WeakMap<Element, Map<string, TranslationEntry>>,
  trackedTextNodes: Set<Text>,
  trackedElements: Set<Element>,
): void {
  const root = document.documentElement;
  if (root === null) return;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node !== null) {
    translateTextNode(node as Text, language, textEntries, trackedTextNodes);
    node = walker.nextNode();
  }

  const elements = [root, ...Array.from(root.querySelectorAll("*"))];
  for (const element of elements) {
    for (const attribute of translatedAttributes) {
      translateAttribute(
        element,
        attribute,
        language,
        attributeEntries,
        trackedElements,
      );
    }
  }
}

function languageFromEvent(event: Event): Language | null {
  return languageFromPayload((event as CustomEvent<unknown>).detail);
}

export function mountLocalization({
  pluginId,
  signal,
}: {
  pluginId: string;
  generation: number;
  signal: AbortSignal;
}): () => void {
  let disposed = false;
  let language: Language = readStoredLanguage();
  let scanScheduled = false;
  const textEntries = new WeakMap<Text, TranslationEntry>();
  const attributeEntries = new WeakMap<
    Element,
    Map<string, TranslationEntry>
  >();
  const trackedTextNodes = new Set<Text>();
  const trackedElements = new Set<Element>();

  const scan = () => {
    if (disposed) return;
    scanDocument(
      language,
      textEntries,
      attributeEntries,
      trackedTextNodes,
      trackedElements,
    );
  };

  const scheduleScan = () => {
    if (disposed || scanScheduled) return;
    scanScheduled = true;
    Promise.resolve().then(() => {
      scanScheduled = false;
      scan();
    });
  };

  const applyLanguage = (next: Language) => {
    if (disposed) return;
    language = next;
    try {
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, next);
    } catch {
      // The current document still updates when browser storage is off.
    }
    scan();
  };

  const onLanguageEvent = (event: Event) => {
    const next = languageFromEvent(event);
    if (next !== null) applyLanguage(next);
  };

  const onStorage = (event: StorageEvent) => {
    if (event.key !== LANGUAGE_STORAGE_KEY) return;
    const next = languageFromPayload({ language: event.newValue });
    if (next !== null) applyLanguage(next);
  };

  const observer = new MutationObserver(scheduleScan);
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: [...translatedAttributes],
  });

  window.addEventListener(LANGUAGE_EVENT, onLanguageEvent);
  window.addEventListener("storage", onStorage);
  signal.addEventListener("abort", dispose, { once: true });

  // The settings app and content script can be mounted in separate BB
  // surfaces. Both share browser localStorage, but a native storage event is
  // not delivered to the document that performed the write. This short poll
  // keeps the visible shell synchronized in that case as well.
  const storageSyncTimer = window.setInterval(() => {
    const stored = readStoredLanguage();
    if (stored !== language) applyLanguage(stored);
  }, 250);

  scan();

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    observer.disconnect();
    window.clearInterval(storageSyncTimer);
    for (const node of trackedTextNodes) restoreText(node, textEntries);
    for (const element of trackedElements) {
      for (const attribute of translatedAttributes) {
        restoreAttribute(element, attribute, attributeEntries);
      }
    }
    trackedTextNodes.clear();
    trackedElements.clear();
    window.removeEventListener(LANGUAGE_EVENT, onLanguageEvent);
    window.removeEventListener("storage", onStorage);
    signal.removeEventListener("abort", dispose);
  }

  return dispose;
}
