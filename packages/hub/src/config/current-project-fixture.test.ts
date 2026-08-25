import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { currentProjectConfigurationFiles } from "../test-utils/current-project-configuration.js";
import { compileHubBundle } from "./bundle.js";

describe("current project configuration proof", () => {
  it("compiles provider workflows without duplicated routing branches", async () => {
    const bundle = compileHubBundle(await currentProjectConfigurationFiles());
    assert.deepEqual(
      bundle.configuration.triggers.map(({ name, sourceFile }) => ({ name, sourceFile })),
      [
        { name: "discord-request", sourceFile: ".paseo/workflows/discord.yml" },
        { name: "github-hub", sourceFile: ".paseo/workflows/github-hub.yml" },
        { name: "github-paseo", sourceFile: ".paseo/workflows/github-paseo.yml" },
        { name: "slack-request", sourceFile: ".paseo/workflows/slack.yml" },
      ],
    );
    for (const provider of ["slack-request", "discord-request"]) {
      const trigger = bundle.configuration.triggers.find(({ name }) => name === provider)!;
      assert.deepEqual(
        trigger.steps.map(({ id }) => id),
        ["classify", "work"],
      );
      const worker = trigger.steps[1]!;
      assert.ok("selector" in worker.agent);
      if (!("selector" in worker.agent)) continue;
      assert.deepEqual(worker.agent.choices["codex"]?.options, {
        sandbox_workspace_write: {
          writable_roots: ["/var/cache/npm"],
          network_access: false,
        },
      });
      assert.deepEqual(worker.allowOutputs, [
        {
          type: provider.startsWith("slack") ? "slack.reply" : "discord.reply",
          max: 1,
          required: true,
        },
      ]);
    }
  });
});
