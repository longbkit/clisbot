import { describe, expect, it } from "vitest";
import {
  buildChannelAccountCandidate,
  buildChannelRouteCandidate,
  DEFAULT_OPEN_AUDIENCE_ROUTE_BEHAVIOR,
  formatChannelConfigurationYaml,
  insertChannelRoute,
  parseChannelConfigurationYaml,
  replaceChannelRouteCandidate,
  routeEffectiveAgent,
  channelRouteFollowUp,
  DEFAULT_MEMBER_ROUTE_BEHAVIOR,
  parseChannelFollowUpTtlMinutes,
} from "../channel-configuration";

describe("buildChannelAccountCandidate", () => {
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
      audience: [{ who: { roles: ["member"] }, where: { conversations: ["C1", "C2"] } }],
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
          audience: [{ who: { roles: ["member"] }, where: { conversations: ["C1", "C2"] } }],
          contains: "#triage",
          agent: "channel-customer-support",
          environment: "channel-customer-support",
        },
      ],
    });
    expect(result.account).not.toHaveProperty("fallback");
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
      audience: [{ who: { roles: ["member"] }, where: { dm: true } }],
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
          audience: [{ who: { roles: ["member"] }, where: { dm: true } }],
          workflow: "customer-handoff",
        },
      ],
    });
    expect(JSON.stringify(result.account)).not.toContain("routeId");
  });

  it("writes an open-audience Route from its own behavior, limits and Fast mode", () => {
    const result = buildChannelRouteCandidate({
      accountId: "support",
      audience: [{ who: { anyone: true }, where: { conversations: ["C_CUSTOMER"] } }],
      behavior: DEFAULT_OPEN_AUDIENCE_ROUTE_BEHAVIOR,
      toolActivity: false,
      limits: { maxConcurrentRuns: 10, messagesSentPerMinute: "off" },
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
      audience: [{ who: { anyone: true }, where: { conversations: ["C_CUSTOMER"] } }],
      interaction: { requireMention: true },
      outbound: { path: "relay" },
      sync: {
        finalAnswers: true,
        progress: { progressMessage: false, messageReaction: "off" },
        toolCalls: false,
        threadLink: "none",
        subagents: { finalAnswers: false, progress: false, toolCalls: false },
      },
      approval: [{ match: "*", mode: "auto-deny" }],
      limits: { maxConcurrentRuns: 10, messagesSentPerMinute: "off" },
    });
    expect(result.resource).toMatchObject({
      agents: {
        "channel-support": {
          featureValues: { fast_mode: true, another_feature: "kept" },
        },
      },
    });
  });

  it("writes the same reply and approval controls for Member and open-audience Routes", () => {
    const member = buildChannelRouteCandidate({
      accountId: "support",
      audience: [{ who: { roles: ["member"] }, where: { conversations: ["C_SUPPORT"] } }],
      behavior: {
        requireMention: false,
        followUpMode: "mention-only",
        followUpTtlMinutes: 5,
        replyAnchor: "thread",
        outboundPath: "relay",
        finalAnswers: true,
        progressMessage: false,
        typingIndicator: true,
        approvalMode: "require",
      },
      toolActivity: { detail: "full", throttleSeconds: 10, whenThrottled: "skip" },
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
        toolCalls: { detail: "full", throttleSeconds: 10, whenThrottled: "skip" },
      },
      approval: [{ match: "*", mode: "require" }],
    });

    const open = buildChannelRouteCandidate({
      accountId: "support",
      audience: [{ who: { anyone: true }, where: { conversations: ["C_PUBLIC"] } }],
      behavior: {
        requireMention: false,
        followUpMode: "mention-only",
        followUpTtlMinutes: 5,
        replyAnchor: "thread",
        outboundPath: "tool",
        finalAnswers: false,
        progressMessage: true,
        typingIndicator: true,
        approvalMode: "auto-allow",
      },
      toolActivity: false,
      target: { kind: "automation", automationName: "triage" },
      resource: {},
    });
    expect(open.route).toMatchObject({
      audience: [{ who: { anyone: true }, where: { conversations: ["C_PUBLIC"] } }],
      interaction: { requireMention: false },
      outbound: { path: "tool" },
      sync: { finalAnswers: false, toolCalls: false },
      approval: [{ match: "*", mode: "auto-allow" }],
    });
  });

  it("adds a Route with a contains filter before unfiltered Routes and keeps direct resources unique", () => {
    const audience = [{ who: { roles: ["member" as const] }, where: { conversations: ["C1"] } }];
    const first = buildChannelRouteCandidate({
      accountId: "support",
      audience,
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
      audience,
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
        audience,
        contains: "#triage",
        agent: "channel-support-2",
      }),
      expect.objectContaining({
        audience,
        agent: "channel-support",
      }),
    ]);
    expect(first.route).not.toHaveProperty("match");
    expect(first.route).not.toHaveProperty("contains");
  });

  it("edits an exclusively owned direct Agent resource in place", () => {
    const route = {
      audience: [{ who: { roles: ["member"] }, where: { conversations: ["C1"] } }],
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
      audience: [{ who: { roles: ["member"] }, where: { conversations: ["C2"] } }],
      behavior: {
        requireMention: false,
        followUpMode: "mention-only",
        followUpTtlMinutes: 5,
        replyAnchor: "thread",
        outboundPath: "relay",
        finalAnswers: true,
        progressMessage: false,
        typingIndicator: true,
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
      },
      approval: [
        { match: "command.destructive", mode: "require" },
        { match: "*", mode: "auto-deny" },
      ],
      interaction: { requireMention: false },
      reply: { anchor: "thread" },
      outbound: { path: "relay" },
      audience: [{ who: { roles: ["member"] }, where: { conversations: ["C2"] } }],
      agent: "support-agent",
      environment: "support-agent",
    });
    expect(result.route).not.toHaveProperty("match");
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
      audience: [{ who: { roles: ["member"] }, where: { groups: "all" } }],
      agent: "shared",
      environment: "shared",
    };
    const siblingRoute = {
      audience: [{ who: { roles: ["member"] }, where: { dm: true } }],
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
      audience: [{ who: { roles: ["member"] }, where: { groups: "all" } }],
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
      audience: [{ who: { roles: ["member"] }, where: { dm: true } }],
      target: { kind: "automation", automationName: "triage" },
      resource: {
        agents: { solo: { provider: "codex" } },
        environments: {
          solo: { kind: "daemon", daemon: "daemon-1", cwd: "/workspace" },
        },
      },
      currentRoute: {
        audience: [{ who: { roles: ["member"] }, where: { dm: true } }],
        agent: "solo",
        environment: "solo",
      },
      accounts: [
        {
          routes: [
            {
              audience: [{ who: { roles: ["member"] }, where: { dm: true } }],
              agent: "solo",
              environment: "solo",
            },
          ],
        },
      ],
    });
    expect(automated.route).toEqual({
      audience: [{ who: { roles: ["member"] }, where: { dm: true } }],
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
      audience: [supportWhere(matchKind)],
      behavior: { ...DEFAULT_MEMBER_ROUTE_BEHAVIOR, ...behavior },
      target: { kind: "automation", automationName: "triage" },
      resource: {},
    }).route;
  }

  /** Members in `#support`, or Members in DMs when the Route is DM-only. */
  function supportWhere(matchKind: "channel" | "dm") {
    return {
      who: { roles: ["member" as const] },
      where: matchKind === "dm" ? { dm: true } : { conversations: ["C_SUPPORT"] },
    };
  }

  /** Loads `interaction` into the form, applies the user's edits, and saves over it. */
  function savedInteraction(
    interaction: Record<string, unknown>,
    edits: Partial<typeof DEFAULT_MEMBER_ROUTE_BEHAVIOR> = {},
    matchKind: "channel" | "dm" = "channel",
  ) {
    const currentRoute = {
      audience: [supportWhere(matchKind)],
      workflow: "triage",
      interaction,
    };
    return replaceChannelRouteCandidate({
      accountId: "support",
      audience: [supportWhere(matchKind)],
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

  it("writes an open-audience Route's follow-up like a Member Route's", () => {
    const open = buildChannelRouteCandidate({
      accountId: "support",
      audience: [{ who: { anyone: true }, where: { conversations: ["C_PUBLIC"] } }],
      behavior: { ...DEFAULT_MEMBER_ROUTE_BEHAVIOR, followUpMode: "auto", followUpEdited: true },
      target: { kind: "automation", automationName: "triage" },
      resource: {},
    });
    expect(open.route["interaction"]).toEqual({
      requireMention: true,
      followUp: { mode: "auto", ttlMinutes: 5 },
    });
  });
});

describe("routeEffectiveAgent", () => {
  const agent = {
    provider: "codex",
    model: "gpt-6-astra",
    mode: "full-access",
    options: { a: 1 },
  };

  it("is the named agent when the Route has no promoted default", () => {
    expect(routeEffectiveAgent(agent, { agent: "support" })).toBe(agent);
  });

  it("replaces the whole agent with controls that name a provider", () => {
    expect(
      routeEffectiveAgent(agent, {
        agentControls: {
          provider: "opencode",
          model: "opencode-go/deepseek-v4.1-flash",
        },
      }),
    ).toEqual({
      provider: "opencode",
      model: "opencode-go/deepseek-v4.1-flash",
    });
  });

  it("keeps provider options only under the same provider", () => {
    expect(
      routeEffectiveAgent(agent, {
        agentControls: { provider: "codex", model: "gpt-5.5" },
      }),
    ).toEqual({ provider: "codex", model: "gpt-5.5", options: { a: 1 } });
  });

  it("overrides field by field when the controls name no provider", () => {
    expect(routeEffectiveAgent(agent, { agentControls: { model: "gpt-5.5" } })).toEqual({
      ...agent,
      model: "gpt-5.5",
    });
  });
});

describe("replaceChannelRouteCandidate and a promoted default", () => {
  const route = {
    audience: [{ who: { roles: ["member" as const] }, where: { conversations: ["C1"] } }],
    agent: "support-agent",
    environment: "support-agent",
    agentControls: {
      provider: "opencode",
      model: "opencode-go/deepseek-v4.1-flash",
    },
  };
  const input = {
    accountId: "support",
    audience: route.audience,
    resource: {
      agents: { "support-agent": { provider: "codex" } },
      environments: {
        "support-agent": {
          kind: "daemon",
          daemon: "d",
          projectId: "p",
          cwd: "/w",
        },
      },
    },
    currentRoute: route,
    accounts: [{ accountId: "support", routes: [route] }],
  };

  it("drops the layer when the form rebuilds the agent, so the form's choice runs", () => {
    const result = replaceChannelRouteCandidate({
      ...input,
      target: {
        kind: "agent",
        daemonId: "d",
        projectId: "p",
        cwd: "/w",
        provider: "claude",
      },
    });
    expect(result.route).not.toHaveProperty("agentControls");
    expect(result.resource).toMatchObject({
      agents: { "support-agent": { provider: "claude" } },
    });
  });

  it("keeps the layer when the Route's target is kept as it is", () => {
    const result = replaceChannelRouteCandidate({
      ...input,
      target: { kind: "existing", route },
    });
    expect(result.route).toMatchObject({ agentControls: route.agentControls });
  });
});
