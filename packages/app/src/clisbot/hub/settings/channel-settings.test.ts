import { describe, expect, it } from "vitest";
import {
  buildChannelAccountCandidate,
  buildChannelRouteCandidate,
  DEFAULT_OPEN_AUDIENCE_ROUTE_LIMITS,
  formatChannelConfigurationYaml,
  hasRequiredChannelConversationIds,
  insertChannelRoute,
  parseChannelConfigurationYaml,
  replaceChannelRouteCandidate,
  channelRouteFollowUp,
  DEFAULT_MEMBER_ROUTE_BEHAVIOR,
  parseChannelFollowUpTtlMinutes,
} from "../channel-configuration";

describe("buildChannelAccountCandidate", () => {
  it("requires explicit Conversation IDs only for public access", () => {
    expect(hasRequiredChannelConversationIds("conversationParticipants", "  , ")).toBe(false);
    expect(hasRequiredChannelConversationIds("conversationParticipants", " C_CUSTOMER ")).toBe(
      true,
    );
    expect(hasRequiredChannelConversationIds("members", "")).toBe(true);
  });

  it("round-trips the one Advanced YAML candidate without creating another store", () => {
    const candidate = {
      resource: { agents: { support: { provider: "codex" } } },
      policy: { enabled: true },
      accounts: [
        {
          channel: "telegram",
          accountId: "support",
          connectionId: "connection-1",
        },
      ],
    };

    expect(parseChannelConfigurationYaml(formatChannelConfigurationYaml(candidate))).toEqual(
      candidate,
    );
    expect(() => parseChannelConfigurationYaml("policy: {}\naccounts: []\nextra: true\n")).toThrow(
      /only resource, policy, and accounts/u,
    );
  });

  it("compiles a direct Agent route into the existing Channel resource shape", () => {
    const result = buildChannelAccountCandidate({
      connection: { id: "telegram-connection", provider: "telegram" },
      accountId: " Customer Support ",
      matchKind: "channel",
      conversationIds: " C1, C2\nC1\r\n, C2 ",
      contains: " #triage ",
      target: {
        kind: "agent",
        daemonId: "daemon-1",
        projectId: "project-support",
        cwd: "/workspace/support",
        worktree: {
          mode: "checkout-branch",
          branch: "release/next",
        },
        provider: "codex",
        model: "gpt-5.6",
        mode: "full-access",
        thinkingOptionId: "high",
        featureValues: { fast_mode: true },
        options: { sandbox: "workspace-write" },
      },
      resource: {
        name: "organization",
        agents: { existing: { provider: "claude" } },
      },
    });

    expect(result.account).toEqual({
      channel: "telegram",
      accountId: "Customer Support",
      enabled: true,
      connectionId: "telegram-connection",
      transport: { mode: "polling" },
      routes: [
        {
          match: {
            kind: "channel",
            ids: ["C1", "C2"],
            contains: "#triage",
          },
          audience: { kind: "members" },
          agent: "channel-customer-support",
          environment: "channel-customer-support",
        },
      ],
      fallback: { deny: true },
    });
    expect(result.resource).toMatchObject({
      name: "organization",
      agents: {
        existing: { provider: "claude" },
        "channel-customer-support": {
          provider: "codex",
          model: "gpt-5.6",
          mode: "full-access",
          thinkingOptionId: "high",
          featureValues: { fast_mode: true },
          options: { sandbox: "workspace-write" },
        },
      },
      environments: {
        "channel-customer-support": {
          kind: "daemon",
          daemon: "daemon-1",
          projectId: "project-support",
          cwd: "/workspace/support",
          worktree: {
            mode: "checkout-branch",
            branch: "release/next",
          },
        },
      },
    });
  });

  it("references an Automation without inventing a Route identity or Agent resource", () => {
    const resource = { agents: { existing: { provider: "codex" } } };
    const result = buildChannelAccountCandidate({
      connection: { id: "slack-connection", provider: "slack" },
      accountId: "triage",
      matchKind: "dm",
      conversationIds: "",
      target: { kind: "automation", automationName: "customer-handoff" },
      resource,
    });

    expect(result.resource).toBe(resource);
    expect(result.account).toEqual({
      channel: "slack",
      accountId: "triage",
      enabled: true,
      connectionId: "slack-connection",
      transport: { mode: "socket" },
      routes: [
        {
          match: { kind: "dm" },
          audience: { kind: "members" },
          workflow: "customer-handoff",
        },
      ],
      fallback: { deny: true },
    });
    expect(JSON.stringify(result.account)).not.toContain("routeId");
  });

  it("makes an external-participant Route text-only and disables Fast mode", () => {
    const result = buildChannelRouteCandidate({
      accountId: "support",
      matchKind: "channel",
      conversationIds: "C_CUSTOMER",
      audience: "conversationParticipants",
      target: {
        kind: "agent",
        daemonId: "daemon-1",
        projectId: "project-support",
        cwd: "/workspace/support",
        provider: "codex",
        featureValues: { fast_mode: true, another_feature: "kept" },
      },
      resource: {},
    });

    expect(result.route).toMatchObject({
      audience: { kind: "conversationParticipants" },
      interaction: { requireMention: true },
      sync: {
        finalAnswers: true,
        toolCalls: false,
        threadLink: "none",
      },
      approval: [{ match: "*", mode: "auto-deny" }],
      limits: DEFAULT_OPEN_AUDIENCE_ROUTE_LIMITS,
    });
    expect(result.resource).toMatchObject({
      agents: {
        "channel-support": {
          featureValues: { another_feature: "kept" },
        },
      },
    });
  });

  it("writes supported Member reply and approval controls without weakening public Routes", () => {
    const member = buildChannelRouteCandidate({
      accountId: "support",
      matchKind: "channel",
      conversationIds: "C_SUPPORT",
      behavior: {
        requireMention: false,
        followUpMode: "mention-only",
        followUpTtlMinutes: 5,
        replyAnchor: "thread",
        outboundPath: "relay",
        finalAnswers: true,
        progressMessage: false,
        typingIndicator: true,
        toolCalls: true,
        approvalMode: "require",
      },
      target: { kind: "automation", automationName: "triage" },
      resource: {},
    });
    expect(member.route).toMatchObject({
      interaction: { requireMention: false },
      reply: { anchor: "thread" },
      outbound: { path: "relay" },
      sync: {
        finalAnswers: true,
        progress: {
          progressMessage: false,
          typingIndicator: true,
        },
        toolCalls: true,
      },
      approval: [{ match: "*", mode: "require" }],
    });

    const open = buildChannelRouteCandidate({
      accountId: "support",
      matchKind: "channel",
      conversationIds: "C_PUBLIC",
      audience: "conversationParticipants",
      behavior: {
        requireMention: false,
        followUpMode: "mention-only",
        followUpTtlMinutes: 5,
        replyAnchor: "thread",
        outboundPath: "tool",
        finalAnswers: false,
        progressMessage: true,
        typingIndicator: true,
        toolCalls: true,
        approvalMode: "auto-allow",
      },
      target: { kind: "automation", automationName: "triage" },
      resource: {},
    });
    expect(open.route).toMatchObject({
      interaction: { requireMention: true },
      outbound: { path: "relay" },
      sync: { finalAnswers: true, toolCalls: false, threadLink: "none" },
      approval: [{ match: "*", mode: "auto-deny" }],
    });
  });

  it("adds a specific Route before a catch-all and keeps direct resources unique", () => {
    const first = buildChannelRouteCandidate({
      accountId: "support",
      matchKind: "channel",
      conversationIds: "C1",
      target: {
        kind: "agent",
        daemonId: "daemon-1",
        projectId: "project-support",
        cwd: "/workspace/support",
        provider: "codex",
      },
      resource: {},
    });
    const second = buildChannelRouteCandidate({
      accountId: "support",
      matchKind: "channel",
      conversationIds: "C1",
      contains: "#triage",
      target: {
        kind: "agent",
        daemonId: "daemon-1",
        projectId: "project-support",
        cwd: "/workspace/support",
        provider: "codex",
      },
      resource: first.resource,
    });

    expect(insertChannelRoute([first.route], second.route)).toEqual([
      expect.objectContaining({
        match: { kind: "channel", ids: ["C1"], contains: "#triage" },
        agent: "channel-support-2",
      }),
      expect.objectContaining({
        match: { kind: "channel", ids: ["C1"] },
        agent: "channel-support",
      }),
    ]);
  });

  it("edits an exclusively owned direct Agent resource in place", () => {
    const route = {
      match: { kind: "channel", ids: ["C1"] },
      audience: { kind: "members" },
      agent: "support-agent",
      environment: "support-agent",
      binding: { key: "thread" },
      sync: {
        progress: { messageReaction: "hourglass_flowing_sand" },
        subagents: { finalAnswers: true },
      },
      approval: [
        { match: "command.destructive", mode: "require" },
        { match: "*", mode: "auto-deny" },
      ],
    };
    const account = { accountId: "support", routes: [route] };
    const result = replaceChannelRouteCandidate({
      accountId: "support",
      matchKind: "channel",
      conversationIds: "C2",
      behavior: {
        requireMention: false,
        followUpMode: "mention-only",
        followUpTtlMinutes: 5,
        replyAnchor: "thread",
        outboundPath: "relay",
        finalAnswers: true,
        progressMessage: false,
        typingIndicator: true,
        toolCalls: false,
      },
      target: {
        kind: "agent",
        daemonId: "daemon-2",
        projectId: "project-2",
        cwd: "/workspace/two",
        provider: "claude",
      },
      resource: {
        agents: { "support-agent": { provider: "codex" } },
        environments: {
          "support-agent": {
            kind: "daemon",
            daemon: "daemon-1",
            projectId: "project-1",
            cwd: "/workspace/one",
          },
        },
      },
      currentRoute: route,
      accounts: [account],
    });

    expect(result.route).toEqual({
      binding: { key: "thread" },
      sync: {
        finalAnswers: true,
        progress: {
          messageReaction: "hourglass_flowing_sand",
          progressMessage: false,
          typingIndicator: true,
        },
        subagents: { finalAnswers: true },
        toolCalls: false,
      },
      approval: [
        { match: "command.destructive", mode: "require" },
        { match: "*", mode: "auto-deny" },
      ],
      interaction: { requireMention: false },
      reply: { anchor: "thread" },
      outbound: { path: "relay" },
      match: { kind: "channel", ids: ["C2"] },
      audience: { kind: "members" },
      agent: "support-agent",
      environment: "support-agent",
    });
    expect(result.resource).toMatchObject({
      agents: { "support-agent": { provider: "claude" } },
      environments: {
        "support-agent": {
          daemon: "daemon-2",
          projectId: "project-2",
          cwd: "/workspace/two",
        },
      },
    });
  });

  it("uses copy-on-write for a shared Agent and removes an orphan when switching to Automation", () => {
    const sharedRoute = {
      match: { kind: "channel" },
      agent: "shared",
      environment: "shared",
    };
    const siblingRoute = {
      match: { kind: "dm" },
      agent: "shared",
      environment: "shared",
    };
    const sharedResource = {
      agents: { shared: { provider: "codex" } },
      environments: {
        shared: { kind: "daemon", daemon: "daemon-1", cwd: "/workspace" },
      },
    };
    const copied = replaceChannelRouteCandidate({
      accountId: "support",
      matchKind: "channel",
      conversationIds: "",
      target: {
        kind: "agent",
        daemonId: "daemon-2",
        projectId: "project-2",
        cwd: "/workspace/two",
        provider: "claude",
      },
      resource: sharedResource,
      currentRoute: sharedRoute,
      accounts: [{ routes: [sharedRoute, siblingRoute] }],
    });
    expect(copied.route).toMatchObject({
      agent: "channel-support",
      environment: "channel-support",
    });
    expect(copied.resource).toMatchObject({
      agents: {
        shared: { provider: "codex" },
        "channel-support": { provider: "claude" },
      },
    });

    const automated = replaceChannelRouteCandidate({
      accountId: "solo",
      matchKind: "dm",
      conversationIds: "",
      target: { kind: "automation", automationName: "triage" },
      resource: {
        agents: { solo: { provider: "codex" } },
        environments: {
          solo: { kind: "daemon", daemon: "daemon-1", cwd: "/workspace" },
        },
      },
      currentRoute: {
        match: { kind: "dm" },
        agent: "solo",
        environment: "solo",
      },
      accounts: [
        {
          routes: [
            {
              match: { kind: "dm" },
              agent: "solo",
              environment: "solo",
            },
          ],
        },
      ],
    });
    expect(automated.route).toEqual({
      match: { kind: "dm" },
      audience: { kind: "members" },
      workflow: "triage",
    });
    expect(automated.resource).toEqual({ agents: {}, environments: {} });
  });
});

describe("Route follow-up policy", () => {
  function memberRoute(
    behavior: Partial<typeof DEFAULT_MEMBER_ROUTE_BEHAVIOR>,
    matchKind: "channel" | "dm" = "channel",
  ) {
    return buildChannelRouteCandidate({
      accountId: "support",
      matchKind,
      conversationIds: "C_SUPPORT",
      behavior: { ...DEFAULT_MEMBER_ROUTE_BEHAVIOR, ...behavior },
      target: { kind: "automation", automationName: "triage" },
      resource: {},
    }).route;
  }

  /** Loads `interaction` into the form, applies the user's edits, and saves over it. */
  function savedInteraction(
    interaction: Record<string, unknown>,
    edits: Partial<typeof DEFAULT_MEMBER_ROUTE_BEHAVIOR> = {},
    matchKind: "channel" | "dm" = "channel",
  ) {
    const currentRoute = {
      match: { kind: matchKind, ids: ["C_SUPPORT"] },
      audience: { kind: "members" },
      workflow: "triage",
      interaction,
    };
    return replaceChannelRouteCandidate({
      accountId: "support",
      matchKind,
      conversationIds: "C_SUPPORT",
      behavior: {
        ...DEFAULT_MEMBER_ROUTE_BEHAVIOR,
        ...channelRouteFollowUp(interaction),
        ...edits,
      },
      target: { kind: "automation", automationName: "triage" },
      resource: {},
      currentRoute,
      accounts: [{ accountId: "support", routes: [currentRoute] }],
    }).route["interaction"];
  }

  it("leaves an inherited policy unwritten until the user changes it", () => {
    expect(memberRoute({}).interaction).toEqual({ requireMention: true });
    expect(savedInteraction({ requireMention: true })).toEqual({ requireMention: true });
  });

  it("writes back an authored policy the user did not change, window included", () => {
    const followUp = { mode: "mention-only", ttlMinutes: 15, note: "kept" };
    expect(savedInteraction({ requireMention: true, followUp })).toEqual({
      requireMention: true,
      followUp,
    });
  });

  it("writes auto with its window when the user turns it on", () => {
    expect(
      savedInteraction({ requireMention: true }, { followUpMode: "auto", followUpEdited: true }),
    ).toEqual({ requireMention: true, followUp: { mode: "auto", ttlMinutes: 5 } });
    expect(
      savedInteraction(
        { followUp: { mode: "mention-only", ttlMinutes: 15 } },
        { followUpMode: "auto", followUpEdited: true },
      ),
    ).toEqual({ requireMention: true, followUp: { mode: "auto", ttlMinutes: 15 } });
  });

  it("keeps a known window when the user turns auto off", () => {
    const off = { followUpMode: "mention-only", followUpEdited: true } as const;
    expect(savedInteraction({ followUp: { mode: "auto", ttlMinutes: 20 } }, off)).toEqual({
      requireMention: true,
      followUp: { mode: "mention-only", ttlMinutes: 20 },
    });
    expect(savedInteraction({ followUp: { mode: "auto" } }, off)).toEqual({
      requireMention: true,
      followUp: { mode: "mention-only" },
    });
    expect(
      savedInteraction(
        { followUp: { mode: "auto" } },
        { ...off, followUpTtlMinutes: 9, followUpTtlAuthored: true },
      ),
    ).toEqual({ requireMention: true, followUp: { mode: "mention-only", ttlMinutes: 9 } });
  });

  it("never adds a policy to a DM Route but keeps one it already has", () => {
    const edited = { followUpMode: "auto", followUpEdited: true } as const;
    expect(memberRoute(edited, "dm").interaction).toEqual({ requireMention: true });
    expect(savedInteraction({ requireMention: true }, edited, "dm")).toEqual({
      requireMention: true,
    });
    const followUp = { mode: "auto", ttlMinutes: 7 };
    expect(savedInteraction({ followUp }, edited, "dm")).toEqual({
      requireMention: true,
      followUp,
    });
  });

  it("reads the authored policy and defaults what is missing or invalid", () => {
    expect(channelRouteFollowUp({ followUp: { mode: "auto", ttlMinutes: 12 } })).toEqual({
      followUpMode: "auto",
      followUpTtlMinutes: 12,
      followUpTtlAuthored: true,
      followUpAuthored: { mode: "auto", ttlMinutes: 12 },
    });
    expect(channelRouteFollowUp({ requireMention: true })).toEqual({
      followUpMode: "mention-only",
      followUpTtlMinutes: 5,
      followUpTtlAuthored: false,
    });
    expect(channelRouteFollowUp({ followUp: { mode: "auto", ttlMinutes: -1 } })).toEqual({
      followUpMode: "auto",
      followUpTtlMinutes: 5,
      followUpTtlAuthored: false,
      followUpAuthored: { mode: "auto", ttlMinutes: -1 },
    });
  });

  it("accepts only positive whole minutes", () => {
    expect(parseChannelFollowUpTtlMinutes(" 5 ")).toBe(5);
    for (const draft of ["", "0", "-3", "2.5", "1e3", "abc"]) {
      expect(parseChannelFollowUpTtlMinutes(draft)).toBeNull();
    }
  });

  it("keeps the fixed policy on public Routes", () => {
    const open = buildChannelRouteCandidate({
      accountId: "support",
      matchKind: "channel",
      conversationIds: "C_PUBLIC",
      audience: "conversationParticipants",
      behavior: { ...DEFAULT_MEMBER_ROUTE_BEHAVIOR, followUpMode: "auto" },
      target: { kind: "automation", automationName: "triage" },
      resource: {},
    });
    expect(open.route["interaction"]).toEqual({ requireMention: true });
  });
});
