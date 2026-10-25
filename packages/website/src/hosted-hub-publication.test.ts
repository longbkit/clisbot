import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildDocsNavTree, getDoc, getDocs, resolveDocMarkdownPath } from "~/docs";
import { LOCALES, withLocalePrefix } from "~/i18n";

describe("Clisbot Hub documentation publication", () => {
  it.each(LOCALES)("does not publish the retired hosted service in %s", (locale) => {
    expect(getDoc("hub/hosted", locale)).toBeUndefined();
    expect(getDocs(locale).some((doc) => doc.slug === "hub/hosted")).toBe(false);
    expect(JSON.stringify(buildDocsNavTree(getDocs(locale)))).not.toContain('"/docs/hub/hosted"');
    expect(resolveDocMarkdownPath(withLocalePrefix("/docs/hub/hosted.md", locale))).toEqual({
      doc: undefined,
    });
    expect(getDoc("hub/self-hosting", locale)).toBeDefined();
    for (const doc of getDocs(locale)) {
      expect(doc.content, doc.sourcePath).not.toMatch(/https:\/\/hub\.(?:clisbot\.com|paseo\.sh)/);
      expect(doc.content, doc.sourcePath).not.toContain("/docs/hub/hosted");
    }
  });

  it("preserves the inherited translation as explicit upstream evidence outside public docs", () => {
    const archived = readFileSync(
      new URL("../../../docs/audits/upstream-public-docs/hub/hosted.zh-CN.md", import.meta.url),
      "utf8",
    );
    expect(archived).toContain("Archived upstream Hosted Hub documentation");
    expect(archived).toContain("Excluded from clisbot.com/docs");
    expect(archived).toContain("7e68c03e28dea323adc3c52356cea0d2698313c1");
    expect(archived).toContain("[Paseo Hub](https://hub.paseo.sh)");
    expect(archived).not.toContain("https://hub.clisbot.com");
  });
});
