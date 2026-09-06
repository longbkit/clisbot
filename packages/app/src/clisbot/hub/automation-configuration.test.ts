import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import {
  automationRouteBacklinks,
  automationChannelReplyGrant,
  automationOutputs,
  initialChannelReplyProviders,
  buildSingleAgentAutomationYaml,
  normalizeAutomationName,
  parseSingleAgentAutomationYaml,
} from "./automation-configuration";

describe("Automation configuration", () => {
  it("reflects the first compiled step's reply defaults without borrowing later event grants", () => {
    const value = { events: [{ name: "slack.mention" }], outputs: [] };
    expect(automationChannelReplyGrant(value, "slack")).toEqual({ type: "slack.reply" });
    expect(automationChannelReplyGrant(value, "telegram")).toBeUndefined();
    expect(
      automationChannelReplyGrant(
        { ...value, events: [{ name: "channel.message" }, ...value.events] },
        "slack",
      ),
    ).toBeUndefined();
    expect(
      automationChannelReplyGrant(
        { ...value, outputs: [{ type: "slack.reply", max: 2 }] },
        "slack",
      ),
    ).toEqual({ type: "slack.reply", max: 2 });
  });
  it("authors Channel-only work with explicit admission and without a manual entry point", () => {
    const yaml = buildSingleAgentAutomationYaml({
      name: "conversation-assistant",
      events: [],
      daemonId: "daemon",
      cwd: "/workspace",
      provider: "codex",
      instruction: "Answer the request",
      reuseBinding: true,
      outputs: [{ type: "telegram.reply", max: 1 }],
    });
    expect(parseSingleAgentAutomationYaml(yaml)).toMatchObject({
      events: [{ name: "channel.message", allowedUsers: ["*"] }],
      reuseBinding: true,
      outputs: [{ type: "telegram.reply", max: 1 }],
    });
    expect(yaml).toContain("name: conversation-assistant");
    expect(yaml.trimStart().startsWith("{")).toBe(false);
    expect(parse(yaml).on).toEqual({
      "channel.message": { filters: { from_users: ["*"] } },
    });
  });

  it("round-trips GitHub repository and comment filters", () => {
    const events = [
      {
        name: "github.issue_comment",
        connection: "github",
        allowedUsers: ["alice"],
        repository: "org/repo",
        contains: "@bot review",
      },
    ];
    const yaml = buildSingleAgentAutomationYaml({
      name: "review",
      instruction: "Review the change",
      events,
      daemonId: "host",
      cwd: "/workspace",
      provider: "pi",
    });
    expect(parse(yaml).on["github.issue_comment"].filters).toEqual({
      from_users: ["alice"],
      repo: "org/repo",
      contains: "@bot review",
    });
    expect(parseSingleAgentAutomationYaml(yaml)?.events).toEqual(events);
  });

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
    const document = parse(yaml) as Record<string, unknown>;

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

describe("Channel Automation reply authority", () => {
  it("gives a new Channel Automation only its explicitly displayed provider reply action", () => {
    const selected = initialChannelReplyProviders([], "telegram");
    expect(selected).toEqual(["telegram"]);
    expect(automationOutputs([], [{ name: "manual.run" }], {}, selected)).toEqual([
      { type: "telegram.reply" },
    ]);
    expect(automationOutputs([], [{ name: "manual.run" }], {}, [])).toEqual([]);
  });
  it("preserves authored Channel and unrelated output authority on structured edit", () => {
    const existing = [
      { type: "slack.reply", max: 2, required: true },
      { type: "telegram.reply", max: 3 },
      { type: "github.reply", max: 1 },
      { type: "custom.publish", required: true },
    ];
    const selected = initialChannelReplyProviders(existing);
    const output = automationOutputs(
      existing,
      [{ name: "manual.run" }],
      { "slack.reply": "2", "telegram.reply": "3" },
      selected,
    );
    expect(output).toEqual(expect.arrayContaining(existing));
    expect(output).toHaveLength(existing.length);
  });
  it("removes Channel reply authority when unchecked without removing the direct event or other provider outputs", () => {
    const existing = [{ type: "slack.reply", max: 2 }, { type: "telegram.reply" }];
    expect(automationOutputs(existing, [{ name: "manual.run" }], {}, ["telegram"])).toEqual([
      { type: "telegram.reply" },
    ]);
    expect(
      automationOutputs(
        existing,
        [{ name: "slack.mention", connection: "slack" }],
        { "slack.reply": "2" },
        ["telegram"],
      ),
    ).toEqual(
      expect.arrayContaining([{ type: "slack.reply", max: 2 }, { type: "telegram.reply" }]),
    );
  });
});
