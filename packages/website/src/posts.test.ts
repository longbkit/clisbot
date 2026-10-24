import { describe, expect, it } from "vitest";
import { getPost, getPosts } from "./posts";
import { LOCALES } from "./i18n";

describe("Clisbot editorial publication", () => {
  it("excludes archived upstream articles from normal and draft listings", () => {
    for (const locale of LOCALES)
      for (const includeDrafts of [false, true]) {
        const slugs = getPosts(locale, includeDrafts).map((post) => post.slug);
        expect(slugs).not.toContain("hello-world");
        expect(slugs).not.toContain("i-was-wrong-about-electron");
      }
  });

  it("does not expose archived articles through direct blog URLs", () => {
    for (const locale of LOCALES)
      for (const slug of [
        "hello-world",
        "i-was-wrong-about-electron",
        "upstream/hello-world",
        "drafts/hello-world",
      ]) {
        expect(getPost(slug, locale)).toBeUndefined();
      }
  });

  it("retains draft previews with a Clisbot byline", () => {
    for (const locale of LOCALES) {
      const draft = getPost("drafts/draft-example", locale);
      expect(draft?.frontmatter.author).toBe("Clisbot");
      expect(getPosts(locale, false).some((post) => post.frontmatter.draft)).toBe(false);
    }
  });
});
