import { describe, expect, it } from "vitest";
import { getAlternativePages } from "~/data/alternative-pages";
import { getDocs, parseHeadings } from "~/docs";
import type { Locale } from "~/i18n";
import { getLegalDocument, type LegalDocumentName } from "~/legal";
import { getPosts } from "~/posts";

/**
 * First-party pages in both languages, paired by path. Chinese coverage is required except for
 * the reviewed Clisbot English fallbacks below; unknown missing translations remain failures.
 */
interface ContentPair {
  path: string;
  /** Whether headings render with `#` anchors; blog posts and legal pages have none. */
  anchored: boolean;
  english: { content: string; locale: Locale };
  chinese: { content: string; locale: Locale };
}

const LEGAL_DOCUMENTS: LegalDocumentName[] = ["privacy", "terms"];

// These upstream Chinese guides diverge from the reviewed Clisbot English contract.
// Originals are preserved in docs/audits/upstream-public-docs, outside the publication glob.
const DIVERGENT_DOC_FALLBACK_PATHS = [
  "/docs",
  "/docs/connectivity",
  "/docs/docker",
  "/docs/web-ui",
  "/docs/cli",
  "/docs/hub",
  "/docs/hub/quickstart",
  "/docs/hub/concepts",
  "/docs/hub/daemons",
  "/docs/hub/triggers/github",
  "/docs/hub/configuration",
  "/docs/hub/configuration/hub-yml",
  "/docs/hub/activity",
  "/docs/hub/faq",
  "/docs/hub/security",
] as const;

// Reviewed Clisbot pages already present before the v0.13.0 sync (c2dc4ad9).
// The loader and UntranslatedNotice intentionally expose their English fallback.
// New untranslated pages remain failures; adding an exception requires review.
const ENGLISH_FALLBACK_PATHS = new Set([
  "/privacy",
  "/terms",
  "/docs/bots-and-chats",
  "/docs/upgrade-v2",
  "/docs/hub/managed-access",
  "/docs/hub/automations",
  "/docs/hub/channels",
  "/docs/hub/channels/commands",
  "/docs/hub/channels/discord",
  "/docs/hub/channels/feishu",
  "/docs/hub/channels/googlechat",
  "/docs/hub/channels/slack",
  "/docs/hub/channels/telegram",
  "/docs/hub/channels/whatsapp",
  "/docs/hub/channels/zalo",
  "/docs/hub/channels/zalouser",
  ...DIVERGENT_DOC_FALLBACK_PATHS,
]);

function pairs<T extends { content: string; locale: Locale }>(
  english: T[],
  chinese: T[],
  pathOf: (page: T) => string,
  anchored: boolean,
): ContentPair[] {
  const byPath = new Map(chinese.map((page) => [pathOf(page), page]));
  return english.map((page) => ({
    path: pathOf(page),
    anchored,
    english: page,
    chinese: byPath.get(pathOf(page)) ?? { content: "", locale: "en" },
  }));
}

const CONTENT: ContentPair[] = [
  ...pairs(getDocs("en"), getDocs("zh-CN"), (doc) => doc.href, true),
  ...pairs(getPosts("en"), getPosts("zh-CN"), (post) => `/blog/${post.slug}`, false),
  ...pairs(getAlternativePages("en"), getAlternativePages("zh-CN"), (page) => page.href, true),
  ...LEGAL_DOCUMENTS.map((name) => ({
    path: `/${name}`,
    anchored: false,
    english: getLegalDocument(name, "en"),
    chinese: getLegalDocument(name, "zh-CN"),
  })),
];

/** Sections in page order, with the anchor `#` links land on where the page renders one. */
function sections(content: string, anchored: boolean): string[] {
  return parseHeadings(content).map(
    (heading) => `h${heading.depth}${anchored ? ` #${heading.id}` : ""}`,
  );
}

function untranslated(pair: ContentPair): boolean {
  return pair.chinese.locale !== "zh-CN";
}

/** The sections a translation adds, drops, reorders, or anchors differently, as a readable diff. */
function sectionMismatch(pair: ContentPair): string[] {
  const english = sections(pair.english.content, pair.anchored);
  const chinese = sections(pair.chinese.content, pair.anchored);
  if (english.join() === chinese.join()) return [];
  return [`${pair.path}: English ${english.join(" ")} | Chinese ${chinese.join(" ")}`];
}

describe("Chinese content", () => {
  it("covers every first-party page", () => {
    expect(CONTENT.length).toBeGreaterThan(70);
    expect(
      CONTENT.filter(untranslated)
        .filter((pair) => !ENGLISH_FALLBACK_PATHS.has(pair.path))
        .map((pair) => pair.path),
    ).toEqual([]);
  });

  it("keeps reviewed fallback paths present and serves their actual English content", () => {
    const reviewed = CONTENT.filter((pair) => ENGLISH_FALLBACK_PATHS.has(pair.path));
    expect(reviewed.map((pair) => pair.path).sort()).toEqual([...ENGLISH_FALLBACK_PATHS].sort());
    for (const pair of reviewed.filter(untranslated)) {
      expect(pair.chinese.content).toBe(pair.english.content);
    }
  });

  it("serves the reviewed fork contracts instead of incompatible upstream translations", () => {
    for (const path of DIVERGENT_DOC_FALLBACK_PATHS) {
      const pair = CONTENT.find((candidate) => candidate.path === path);
      expect(pair, path).toBeDefined();
      expect(pair!.chinese.locale, path).toBe("en");
      expect(pair!.chinese.content, path).toBe(pair!.english.content);
    }
    // An unrelated, reviewed translation remains Chinese; this is not a locale-wide fallback.
    const api = CONTENT.find((pair) => pair.path === "/docs/hub/api");
    expect(api?.chinese.locale).toBe("zh-CN");
  });

  it("has every English section, in order, under the English anchor", () => {
    // Pin each translated heading with the English anchor: `## 运行 Agent {#running-agents}`.
    expect(CONTENT.flatMap(sectionMismatch)).toEqual([]);
  });
});
