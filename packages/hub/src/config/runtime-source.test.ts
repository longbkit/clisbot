import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));

describe("HubConfig runtime source", () => {
  it("does not keep the old on-demand GitHub strategy alive", () => {
    const configIndex = readFileSync(join(here, "index.ts"), "utf8");

    assert.equal(existsSync(join(here, "strategies/github.ts")), false);
    assert.equal(configIndex.includes("loadHubConfig"), false);
    assert.equal(configIndex.includes("githubOctokit"), false);
  });
});
