import { describe, expect, it } from "vitest";
import { getPost, getPosts } from "./posts";

describe("Clisbot editorial publication", () => {
  it("excludes archived upstream articles from normal and draft listings", () => {
    for (const includeDrafts of [false, true]) {
      const slugs = getPosts(includeDrafts).map((post) => post.slug);
      expect(slugs).not.toContain("hello-world");
      expect(slugs).not.toContain("i-was-wrong-about-electron");
    }
  });

  it("does not expose archived articles through direct blog URLs", () => {
    for (const slug of [
      "hello-world",
      "i-was-wrong-about-electron",
      "upstream/hello-world",
      "drafts/hello-world",
    ]) {
      expect(getPost(slug)).toBeUndefined();
    }
  });

  it("retains draft previews with a Clisbot byline", () => {
    const draft = getPost("drafts/draft-example");
    expect(draft?.frontmatter.author).toBe("Clisbot");
    expect(getPosts(false).some((post) => post.frontmatter.draft)).toBe(false);
  });
});
