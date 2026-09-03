import { describe, expect, it } from "vitest";
import {
  automationRouteBacklinks,
  buildSingleAgentAutomationYaml,
  normalizeAutomationName,
  parseSingleAgentAutomationYaml,
} from "./automation-configuration";

describe("Automation configuration", () => {
  it("normalizes a durable resource name", () => {
    expect(normalizeAutomationName("  12 Customer Handoff! ")).toBe("customer-handoff");
  });

  it("creates a one-Agent Automation with events, declared inputs, limits, and output", () => {
    const yaml = buildSingleAgentAutomationYaml({
      name: "Customer Handoff",
      description: "Triage incoming customer requests.",
      events: [
        { name: "manual.run" },
        {
          name: "slack.mention",
          connection: "support-workspace",
          allowedUsers: ["U123"],
        },
      ],
      inputs: [
        {
          name: "Urgency",
          type: "string",
          required: true,
          choices: ["normal", "urgent"],
        },
      ],
      daemonId: "daemon-1",
      projectId: "project-support",
      cwd: "/workspace/support",
      worktree: {
        mode: "branch-off",
        newBranch: "support/customer-request",
        base: "main",
      },
      provider: "codex",
      model: "gpt-5.6",
      mode: "full-access",
      thinkingOptionId: "high",
      featureValues: { fast_mode: true },
      options: { sandbox: "workspace-write" },
      instruction: "Resolve this customer request.",
      reuseBinding: true,
      maxRuntime: "45m",
      idleTimeout: "5m",
      autoArchive: false,
      outputSchema: {
        type: "object",
        properties: { summary: { type: "string" } },
      },
      outputs: [{ type: "slack.reply", max: 2 }],
    });
    const document = JSON.parse(yaml) as Record<string, unknown>;

    expect(document).toMatchObject({
      name: "customer-handoff",
      description: "Triage incoming customer requests.",
      enabled: true,
      on: {
        "manual.run": {},
        "slack.mention": {
          connection: "support-workspace",
          filters: { from_users: ["U123"] },
        },
      },
      inputs: {
        urgency: {
          type: "string",
          required: true,
          choices: ["normal", "urgent"],
        },
      },
      run: {
        target: {
          daemon: "daemon-1",
          projectId: "project-support",
          cwd: "/workspace/support",
          worktree: {
            mode: "branch-off",
            newBranch: "support/customer-request",
            base: "main",
          },
        },
        agent: {
          provider: "codex",
          model: "gpt-5.6",
          mode: "full-access",
          thinkingOptionId: "high",
          featureValues: { fast_mode: true },
          options: { sandbox: "workspace-write" },
        },
        reuse: "binding",
        max_runtime: "45m",
        idle_timeout: "5m",
        auto_archive: false,
        output: {
          schema: {
            type: "object",
            properties: { summary: { type: "string" } },
          },
        },
        outputs: { "slack.reply": { max: 2 } },
      },
    });
    expect(yaml).toContain("${{ paseo.prompt }}");
    expect(parseSingleAgentAutomationYaml(yaml)).toEqual({
      name: "customer-handoff",
      description: "Triage incoming customer requests.",
      enabled: true,
      events: [
        { name: "manual.run" },
        {
          name: "slack.mention",
          connection: "support-workspace",
          allowedUsers: ["U123"],
        },
      ],
      inputs: [
        {
          name: "urgency",
          type: "string",
          required: true,
          choices: ["normal", "urgent"],
        },
      ],
      daemonId: "daemon-1",
      projectId: "project-support",
      cwd: "/workspace/support",
      worktree: {
        mode: "branch-off",
        newBranch: "support/customer-request",
        base: "main",
      },
      provider: "codex",
      model: "gpt-5.6",
      mode: "full-access",
      thinkingOptionId: "high",
      featureValues: { fast_mode: true },
      options: { sandbox: "workspace-write" },
      instruction: "Resolve this customer request.",
      reuseBinding: true,
      maxRuntime: "45m",
      idleTimeout: "5m",
      autoArchive: false,
      outputSchema: {
        type: "object",
        properties: { summary: { type: "string" } },
      },
      outputs: [{ type: "slack.reply", max: 2 }],
    });
  });

  it("does not structurally edit an Automation whose unknown fields would be lost", () => {
    const yaml = [
      "name: custom",
      "enabled: true",
      "on:",
      "  channel.message: {}",
      "run:",
      "  target:",
      "    daemon: daemon-1",
      "    cwd: /workspace",
      "    worktree:",
      "      mode: checkout-branch",
      "      branch: main",
      "    custom_target_option: true",
      "  agent:",
      "    provider: codex",
      "  prompt: ${{ paseo.prompt }}",
      "  max_runtime: 2h",
      "  idle_timeout: 10m",
      "  auto_archive: true",
      "",
    ].join("\n");
    expect(parseSingleAgentAutomationYaml(yaml)).toBeNull();
  });

  it("finds Channel routes that invoke an Automation without inventing route IDs", () => {
    expect(
      automationRouteBacklinks(
        [
          {
            channel: "slack",
            accountId: "support",
            routes: [
              { match: { kind: "channel" }, workflow: "customer-handoff" },
              { match: { kind: "dm" }, agent: "assistant" },
            ],
            fallback: { workflow: "customer-handoff" },
          },
          { channel: "telegram", accountId: "alerts", routes: [] },
        ],
        "customer-handoff",
      ),
    ).toEqual([
      { channel: "slack", accountId: "support", routePosition: 0 },
      { channel: "slack", accountId: "support", routePosition: "fallback" },
    ]);
  });
});
