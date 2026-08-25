import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { buildLaunchMachineIntent } from "./launch-machine-intent.js";

describe("LaunchMachineIntent", () => {
  it("builds the dispatcher intent from a trigger match", async () => {
    const intent = buildLaunchMachineIntent({
      organizationId: "org_1",
      projectId: "project-1",
      triggerRunId: "trigger-run-1",
      configurationRevisionId: "config-version-1",
      triggerName: "discord-ping",
      environmentName: "hetzner-faro",
      environment: {
        kind: "daemon",
        daemonId: "daemon-1",
        authoredSlug: "hetzner-faro",
        cwd: "/home/moboudra/dev/faro",
      },
      prompt: "Reply pong",
      agent: {
        provider: "codex",
        model: "gpt-5.6-sol",
        mode: "full-access",
        thinkingOptionId: "xhigh",
        options: { sandbox_workspace_write: { writable_roots: ["/var/cache/npm"] } },
      },
      allowOutputs: [{ type: "discord.reply", max: 1 }],
      timeoutMs: 3_600_000,
      idleTimeoutMs: 300_000,
      autoArchive: true,
      triggerContext: { messageId: "message-1" },
      outputContext: { messageId: "message-1" },
      hubConfig: { triggers: [] },
    });

    assert.deepEqual(intent, {
      kind: "launch_machine",
      organizationId: "org_1",
      projectId: "project-1",
      triggerRunId: "trigger-run-1",
      triggerName: "discord-ping",
      environmentName: "hetzner-faro",
      environment: {
        kind: "daemon",
        daemonId: "daemon-1",
        authoredSlug: "hetzner-faro",
        cwd: "/home/moboudra/dev/faro",
      },
      prompt: "Reply pong",
      agent: {
        provider: "codex",
        model: "gpt-5.6-sol",
        mode: "full-access",
        thinkingOptionId: "xhigh",
        options: { sandbox_workspace_write: { writable_roots: ["/var/cache/npm"] } },
      },
      allowOutputs: [{ type: "discord.reply", max: 1 }],
      timeoutMs: 3_600_000,
      idleTimeoutMs: 300_000,
      autoArchive: true,
      triggerContext: { messageId: "message-1" },
      outputContext: { messageId: "message-1" },
      configurationRevisionId: "config-version-1",
      hubConfig: { triggers: [] },
    });
  });
});
