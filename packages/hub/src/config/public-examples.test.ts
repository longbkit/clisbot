import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it } from "vitest";
import { compileHubBundle, type HubBundleFile } from "./bundle.js";

const exampleRoot = "examples/single-repo-team-bot";
const exampleFiles = [
  ".paseo/hub.yml",
  ".paseo/workflows/discord.yml",
  ".paseo/workflows/github.yml",
  ".paseo/workflows/slack.yml",
  ".paseo/workflows/partials/classifier.md",
  ".paseo/workflows/partials/github-progress.md",
  ".paseo/workflows/partials/progress.md",
  ".paseo/workflows/partials/safety.md",
  ".paseo/workflows/partials/worker.md",
] as const;

describe("public Hub examples", () => {
  it("keeps the single-repository team bot deployable", async () => {
    const files: HubBundleFile[] = await Promise.all(
      exampleFiles.map(async (path) => ({
        path,
        content: await readFile(join(exampleRoot, path), "utf8"),
      })),
    );

    const bundle = compileHubBundle(files);

    assert.deepEqual(
      bundle.configuration.triggers.map(({ name }) => name),
      ["discord-mention", "github-issue-comment", "slack-mention"],
    );
    for (const trigger of bundle.configuration.triggers) {
      assert.deepEqual(
        trigger.steps.map(({ id, environment }) => ({ id, environment })),
        [
          { id: "classify", environment: "repository" },
          { id: "work", environment: "repository" },
        ],
      );
    }
    assert.deepEqual(bundle.agentValidationTargets.map(({ name }) => name).sort(), [
      "classifier",
      "worker",
    ]);
  });
});
