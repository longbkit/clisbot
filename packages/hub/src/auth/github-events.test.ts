import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { readGitHubTriggerUrl } from "./github-events.js";

describe("GitHub event helpers", () => {
  it("uses push compare URLs for trigger links", () => {
    assert.equal(
      readGitHubTriggerUrl({
        compare: "https://github.com/boudra/faro/compare/old...new",
        repository: {
          html_url: "https://github.com/boudra/faro",
        },
      }),
      "https://github.com/boudra/faro/compare/old...new",
    );
  });

  it("falls back to the repository URL for push payloads without compare URLs", () => {
    assert.equal(
      readGitHubTriggerUrl({
        repository: {
          html_url: "https://github.com/boudra/faro",
        },
      }),
      "https://github.com/boudra/faro",
    );
  });
});
