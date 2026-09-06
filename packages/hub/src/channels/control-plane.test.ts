// Tests for the channel control-plane source (plan S8, implementation doc §4.3):
// the single builder that turns the active organization configuration into the
// control plane the ops handlers, the supervisor, and the plane all consume.
// The contract under test: org resolution is single-organization (P0), the
// snapshot carries the active revision's authored files + compiled control
// plane, and the agent-spec resolver maps route targets into the daemon's
// create fields — the mapping the plane's binding engine drives.

import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { createMemoryDatabase } from "../db/memory.js";
import { enrollTestDaemon } from "../test-utils/project-configuration.js";
import { OrganizationTriggerStore } from "../triggers/store.js";
import type { Database } from "../db/types.js";
import {
  ChannelAgentSpecError,
  ChannelControlPlaneError,
  createChannelAgentSpecResolver,
  hubListenPort,
  loadChannelControlPlane,
  type ChannelControlPlaneSnapshot,
} from "./control-plane.js";
import { DEFAULT_MESSAGE_TOOL_PROMPT } from "./outbound-template.js";
import {
  CHANNEL_REPLY_MCP_SERVER_NAME,
  CHANNEL_REPLY_TOOL_NAME,
  type ChannelReplyBindingRef,
} from "./plane/types.js";
import type { EffectiveDefaults } from "./config/compile.js";

/** The tool-path mcpServers entry the resolver composes (the daemon config's
 * `mcpServers` values are `unknown` on the wire; this narrows the one entry
 * under test). */
function channelReplyServerEntry(config: { mcpServers?: Record<string, unknown> }): {
  type: string;
  url: string;
} {
  const entry = config.mcpServers?.[CHANNEL_REPLY_MCP_SERVER_NAME] as
    | { type: string; url: string }
    | undefined;
  return entry ?? { type: "", url: "" };
}

const HUB_YAML = `
environments:
  work:
    kind: daemon
    daemon: daemon-10000000
    cwd: /workspace/app
    worktree:
      mode: checkout-branch
      branch: release/next
  mirror:
    kind: fly
    image: mirror
agents:
  codex-safe:
    provider: codex
    model: gpt-5.5
    featureValues:
      fast_mode: true
    options:
      sandbox_workspace_write:
        network_access: false
  claude:
    provider: claude
    mode: bypassPermissions
    thinkingOptionId: high
`;

const POLICY_YAML = `
enabled: true
channels:
  slack:
    enabled: true
users:
  alice:
    name: Alice
    identities: [slack:U1]
`;

const ACCOUNT_YAML = `
channel: slack
accountId: work
connectionId: slack:work
transport:
  mode: socket
routes:
  - match:
      kind: dm
    agent: codex-safe
    environment: work
  - match:
      kind: channel
    workflow: handoff
fallback:
  deny: true
`;

const ORG_ID = "org-1";
const REPLY_CAPABILITY = { token: "opaque-reply-capability", canSendFiles: true };

// The resolver's second argument: the route's effective defaults. The
// tool-path tests below flip `outbound.path` to `tool`.
const RELAY_DEFAULTS: EffectiveDefaults = {
  requireMention: true,
  followUp: { mode: "auto", ttlMinutes: 60 },
  bindingKey: "thread",
  replyAnchor: "thread",
  outbound: { path: "relay", template: null },
  sync: {
    finalAnswers: true,
    progress: {
      progressMessage: false,
      typingIndicator: false,
      messageReaction: "off",
    },
    toolCalls: false,
    threadLink: "final-only",
    subagents: { finalAnswers: false, progress: false, toolCalls: false },
  },
};

// The thread the agent spec's binding ref names (the create-time target).
const BINDING_REF: ChannelReplyBindingRef = {
  channel: "slack",
  accountId: "work",
  externalConversationId: "C0WORK",
  externalThreadId: "1710000000.000001",
};

function memoryDatabase(): Database {
  return createMemoryDatabase({
    memberships: [
      {
        userId: "user-1",
        organizationId: ORG_ID,
        organizationName: "Operator",
        organizationSlug: "operator",
        membershipId: "member-1",
        role: "owner",
      },
    ],
  });
}

async function withActiveConfiguration(database: Database): Promise<ChannelControlPlaneSnapshot> {
  await enrollTestDaemon(database, ORG_ID);
  await new OrganizationTriggerStore(database, ORG_ID).save({
    yaml: `name: handoff\nenabled: true\non:\n  manual.run: {}\nrun:\n  target: { daemon: daemon-10000000, cwd: /workspace/app }\n  agent: { provider: codex, mode: default }\n  prompt: hand off\n  max_runtime: 1h\n  idle_timeout: 5m\n`,
    userId: null,
  });
  const files = [
    { path: ".paseo/hub.yml", content: HUB_YAML },
    { path: ".paseo/channels/policy.yml", content: POLICY_YAML },
    { path: ".paseo/channels/slack/work.yml", content: ACCOUNT_YAML },
  ];
  await database.saveChannelConfiguration({
    organizationId: ORG_ID,
    files,
    contentHash: "test-channel-configuration",
    createdByUserId: null,
  });
  return loadChannelControlPlane(database);
}

describe("loadChannelControlPlane", () => {
  it("compiles the active revision into the snapshot", async () => {
    const snapshot = await withActiveConfiguration(memoryDatabase());
    assert.equal(snapshot.organizationId, ORG_ID);
    assert.equal(snapshot.controlPlane.enabled, true);
    assert.equal(snapshot.controlPlane.users["alice"]?.identities[0], "slack:U1");
    assert.equal(snapshot.controlPlane.identityOwners["slack:U1"], "alice");
    assert.equal(snapshot.controlPlane.channelEnabled["slack"], true);
    const account = snapshot.controlPlane.accounts[0];
    assert.equal(account?.channel, "slack");
    assert.equal(account?.accountId, "work");
    assert.deepEqual(account?.routes[0]?.target, {
      kind: "agent",
      agent: "codex-safe",
      environment: "work",
      template: null,
    });
    assert.deepEqual(snapshot.controlPlane.accounts[0]?.routes[1]?.target, {
      kind: "workflow",
      workflow: "handoff",
    });
    // The snapshot carries the authored files the ops handlers edit.
    assert.equal(
      snapshot.files.some(({ path }) => path === ".paseo/channels/slack/work.yml"),
      true,
    );
  });

  it("resolves agent targets into the daemon's create fields", async () => {
    const snapshot = await withActiveConfiguration(memoryDatabase());
    // OFF path: no `outbound.path: tool` in the defaults, so the config is
    // byte-identical to today — no mcpServers, no toolPolicy, no systemPrompt.
    assert.deepEqual(
      snapshot.resolveAgentSpec(
        {
          kind: "agent",
          agent: "codex-safe",
          environment: "work",
          template: null,
        },
        RELAY_DEFAULTS,
        BINDING_REF,
      ),
      {
        provider: "codex",
        cwd: "/workspace/app",
        model: "gpt-5.5",
        featureValues: { fast_mode: true },
        providerOptions: {
          sandbox_workspace_write: { network_access: false },
        },
        worktree: {
          mode: "checkout-branch",
          branch: "release/next",
        },
      },
    );
    assert.deepEqual(
      snapshot.resolveAgentSpec(
        { kind: "agent", agent: "claude", environment: "work", template: null },
        RELAY_DEFAULTS,
        BINDING_REF,
      ),
      {
        provider: "claude",
        cwd: "/workspace/app",
        modeId: "bypassPermissions",
        thinkingOptionId: "high",
        worktree: {
          mode: "checkout-branch",
          branch: "release/next",
        },
      },
    );
  });

  it("resolves an agent no workflow references (the full named map, not just targets)", async () => {
    const snapshot = await withActiveConfiguration(memoryDatabase());
    // `claude` appears in no workflow step, so agentValidationTargets omits it;
    // a channel route targeting it must still resolve.
    const config = snapshot.resolveAgentSpec(
      { kind: "agent", agent: "claude", environment: "work", template: null },
      RELAY_DEFAULTS,
      BINDING_REF,
    );
    assert.equal(config.provider, "claude");
  });

  it("rejects an unknown agent and a non-daemon environment", async () => {
    const snapshot = await withActiveConfiguration(memoryDatabase());
    assert.throws(
      () =>
        snapshot.resolveAgentSpec(
          {
            kind: "agent",
            agent: "ghost",
            environment: "work",
            template: null,
          },
          RELAY_DEFAULTS,
          BINDING_REF,
        ),
      ChannelAgentSpecError,
    );
    assert.throws(
      () =>
        snapshot.resolveAgentSpec(
          {
            kind: "agent",
            agent: "codex-safe",
            environment: "mirror",
            template: null,
          },
          RELAY_DEFAULTS,
          BINDING_REF,
        ),
      (error: unknown) =>
        error instanceof ChannelAgentSpecError && /daemon environment/u.test(String(error)),
    );
  });

  it("fails closed when no organization is provisioned", async () => {
    await assert.rejects(
      loadChannelControlPlane(createMemoryDatabase()),
      (error: unknown) =>
        error instanceof ChannelControlPlaneError && error.code === "organization_not_found",
    );
  });

  it("fails closed on two provisioned organizations (P0 is single-operator)", async () => {
    const database = createMemoryDatabase({
      memberships: [
        {
          userId: "user-1",
          organizationId: "org-a",
          organizationName: "A",
          organizationSlug: "a",
          membershipId: "member-a",
          role: "owner",
        },
        {
          userId: "user-2",
          organizationId: "org-b",
          organizationName: "B",
          organizationSlug: "b",
          membershipId: "member-b",
          role: "owner",
        },
      ],
    });
    await assert.rejects(
      loadChannelControlPlane(database),
      (error: unknown) =>
        error instanceof ChannelControlPlaneError && error.code === "organization_ambiguous",
    );
  });

  it("loads an empty organization control plane before its first revision", async () => {
    const snapshot = await loadChannelControlPlane(memoryDatabase());
    assert.equal(snapshot.organizationId, ORG_ID);
    assert.equal(snapshot.revision, null);
    assert.deepEqual(snapshot.controlPlane.accounts, []);
  });

  it("rejects Fast mode on a direct Agent exposed to external participants", async () => {
    const database = memoryDatabase();
    await database.saveChannelConfiguration({
      organizationId: ORG_ID,
      files: [
        { path: ".paseo/hub.yml", content: HUB_YAML },
        {
          path: ".paseo/channels/slack/public.yml",
          content: `
channel: slack
accountId: public
connectionId: slack:public
transport: { mode: socket }
routes:
  - match: { kind: channel, ids: [C_CUSTOMER] }
    audience: { kind: conversationParticipants }
    agent: codex-safe
    environment: work
    sync:
      finalAnswers: true
      progress: { progressMessage: false, typingIndicator: false, messageReaction: off }
      toolCalls: false
      threadLink: none
      subagents: { finalAnswers: false, progress: false, toolCalls: false }
    approval: [{ match: "*", mode: auto-deny }]
`,
        },
      ],
      contentHash: "unsafe-public-agent",
      createdByUserId: null,
    });

    await assert.rejects(loadChannelControlPlane(database), /Fast mode is unavailable/u);
  });

  it("rejects Fast mode in an Automation exposed to external participants", async () => {
    const database = memoryDatabase();
    await enrollTestDaemon(database, ORG_ID);
    await new OrganizationTriggerStore(database, ORG_ID).save({
      yaml: `
name: public-handoff
enabled: true
on: { manual.run: {} }
run:
  target: { daemon: daemon-10000000, cwd: /workspace/app }
  agent:
    provider: codex
    mode: default
    featureValues: { fast_mode: true }
  prompt: hand off
`,
      userId: null,
    });
    await database.saveChannelConfiguration({
      organizationId: ORG_ID,
      files: [
        {
          path: ".paseo/channels/slack/public.yml",
          content: `
channel: slack
accountId: public
connectionId: slack:public
transport: { mode: socket }
routes:
  - match: { kind: channel, ids: [C_CUSTOMER] }
    audience: { kind: conversationParticipants }
    workflow: public-handoff
    sync:
      finalAnswers: true
      progress: { progressMessage: false, typingIndicator: false, messageReaction: off }
      toolCalls: false
      threadLink: none
      subagents: { finalAnswers: false, progress: false, toolCalls: false }
    approval: [{ match: "*", mode: auto-deny }]
`,
        },
      ],
      contentHash: "unsafe-public-automation",
      createdByUserId: null,
    });

    await assert.rejects(loadChannelControlPlane(database), /Fast mode is unavailable/u);
  });

  it("rejects an unattended direct-Agent Mode exposed to external participants", async () => {
    const database = memoryDatabase();
    await database.saveChannelConfiguration({
      organizationId: ORG_ID,
      files: [
        { path: ".paseo/hub.yml", content: HUB_YAML },
        {
          path: ".paseo/channels/slack/public.yml",
          content: `
channel: slack
accountId: public
connectionId: slack:public
transport: { mode: socket }
routes:
  - match: { kind: channel, ids: [C_CUSTOMER] }
    audience: { kind: conversationParticipants }
    agent: claude
    environment: work
    sync:
      finalAnswers: true
      progress: { progressMessage: false, typingIndicator: false, messageReaction: off }
      toolCalls: false
      threadLink: none
      subagents: { finalAnswers: false, progress: false, toolCalls: false }
    approval: [{ match: "*", mode: auto-deny }]
`,
        },
      ],
      contentHash: "unsafe-public-agent-mode",
      createdByUserId: null,
    });

    await assert.rejects(loadChannelControlPlane(database), /unattended Mode "bypassPermissions"/u);
  });

  it("rejects an unattended Automation Mode exposed to external participants", async () => {
    const database = memoryDatabase();
    await enrollTestDaemon(database, ORG_ID);
    await new OrganizationTriggerStore(database, ORG_ID).save({
      yaml: `
name: public-unattended
enabled: true
on: { manual.run: {} }
run:
  target: { daemon: daemon-10000000, cwd: /workspace/app }
  agent: { provider: codex, mode: full-access }
  prompt: hand off
`,
      userId: null,
    });
    await database.saveChannelConfiguration({
      organizationId: ORG_ID,
      files: [
        {
          path: ".paseo/channels/slack/public.yml",
          content: `
channel: slack
accountId: public
connectionId: slack:public
transport: { mode: socket }
routes:
  - match: { kind: channel, ids: [C_CUSTOMER] }
    audience: { kind: conversationParticipants }
    workflow: public-unattended
    sync:
      finalAnswers: true
      progress: { progressMessage: false, typingIndicator: false, messageReaction: off }
      toolCalls: false
      threadLink: none
      subagents: { finalAnswers: false, progress: false, toolCalls: false }
    approval: [{ match: "*", mode: auto-deny }]
`,
        },
      ],
      contentHash: "unsafe-public-automation-mode",
      createdByUserId: null,
    });

    await assert.rejects(loadChannelControlPlane(database), /unattended Mode "full-access"/u);
  });
});

describe("createChannelAgentSpecResolver (E4/E6 tool path)", () => {
  it("uses the canonical Hub URL for a direct Agent on a remote Host", async () => {
    const database = memoryDatabase();
    await withActiveConfiguration(database);
    const snapshot = await loadChannelControlPlane(
      database,
      undefined,
      "https://hub.example.test/base/",
    );
    const config = snapshot.resolveAgentSpec(
      { kind: "agent", agent: "codex-safe", environment: "work", template: null },
      { ...RELAY_DEFAULTS, outbound: { path: "tool", template: null } },
      BINDING_REF,
      REPLY_CAPABILITY,
    );
    assert.deepEqual(channelReplyServerEntry(config), {
      type: "http",
      url: `https://hub.example.test/base/mcp/channel/${REPLY_CAPABILITY.token}`,
    });
  });

  it("attaches the channel-reply MCP server + grant + default injection on a tool route", async () => {
    const snapshot = await withActiveConfiguration(memoryDatabase());
    const config = snapshot.resolveAgentSpec(
      {
        kind: "agent",
        agent: "codex-safe",
        environment: "work",
        template: null,
      },
      { ...RELAY_DEFAULTS, outbound: { path: "tool", template: null } },
      BINDING_REF,
      REPLY_CAPABILITY,
    );
    const server = channelReplyServerEntry(config);
    assert.equal(server.type, "http");
    assert.equal(server.url, `${snapshot.publicBaseUrl}/mcp/channel/${REPLY_CAPABILITY.token}`);
    assert.deepEqual(config.toolPolicy, {
      preapproved: [
        {
          kind: "mcp",
          server: CHANNEL_REPLY_MCP_SERVER_NAME,
          tool: CHANNEL_REPLY_TOOL_NAME,
        },
        {
          kind: "mcp",
          server: CHANNEL_REPLY_MCP_SERVER_NAME,
          tool: "send_file",
        },
      ],
    });
    assert.equal(config.systemPrompt, DEFAULT_MESSAGE_TOOL_PROMPT);
  });

  it("honors a route template override and keeps binding facts out of the URL", async () => {
    const snapshot = await withActiveConfiguration(memoryDatabase());
    const config = snapshot.resolveAgentSpec(
      {
        kind: "agent",
        agent: "codex-safe",
        environment: "work",
        template: null,
      },
      {
        ...RELAY_DEFAULTS,
        outbound: {
          path: "tool",
          template: "Reply only through the message tool.",
        },
      },
      BINDING_REF,
      REPLY_CAPABILITY,
    );
    assert.equal(config.systemPrompt, "Reply only through the message tool.");
    const url = channelReplyServerEntry(config).url;
    assert.equal(url.endsWith(`/mcp/channel/${REPLY_CAPABILITY.token}`), true);
    assert.equal(url.includes(BINDING_REF.externalConversationId), false);
  });

  it("stays byte-identical to the relay config when the path is relay", async () => {
    const snapshot = await withActiveConfiguration(memoryDatabase());
    const target = {
      kind: "agent" as const,
      agent: "codex-safe",
      environment: "work",
      template: null,
    };
    const relayConfig = snapshot.resolveAgentSpec(target, RELAY_DEFAULTS, BINDING_REF);
    const toolConfig = snapshot.resolveAgentSpec(
      target,
      { ...RELAY_DEFAULTS, outbound: { path: "tool", template: null } },
      BINDING_REF,
      REPLY_CAPABILITY,
    );
    // Exactly the three tool-path additions — nothing else changes.
    const { mcpServers, toolPolicy, systemPrompt, ...base } = toolConfig;
    assert.deepEqual(base, relayConfig);
    assert.ok(mcpServers !== undefined && toolPolicy !== undefined && systemPrompt !== undefined);
  });

  it("fails closed without an issued capability and omits file authority without a Project root", async () => {
    const snapshot = await withActiveConfiguration(memoryDatabase());
    const target = {
      kind: "agent" as const,
      agent: "codex-safe",
      environment: "work",
      template: null,
    };
    const defaults = { ...RELAY_DEFAULTS, outbound: { path: "tool" as const, template: null } };
    assert.throws(
      () => snapshot.resolveAgentSpec(target, defaults, BINDING_REF),
      /reply capability is unavailable/u,
    );
    const config = snapshot.resolveAgentSpec(target, defaults, BINDING_REF, {
      token: REPLY_CAPABILITY.token,
      canSendFiles: false,
    });
    assert.deepEqual(
      config.toolPolicy?.preapproved.map(({ tool }) => tool),
      ["message"],
    );
    assert.equal(config.systemPrompt?.includes("send_file"), false);
  });
});

describe("hubListenPort", () => {
  it("reads PORT, falling back to 3000 for missing or invalid values", () => {
    assert.equal(hubListenPort({ PORT: "6868" }), 6868);
    assert.equal(hubListenPort({}), 3000);
    assert.equal(hubListenPort({ PORT: "not-a-port" }), 3000);
    assert.equal(hubListenPort({ PORT: "0" }), 3000);
  });
});

describe("createChannelAgentSpecResolver", () => {
  it("is importable standalone for the supervisor's plane construction", async () => {
    const snapshot = await withActiveConfiguration(memoryDatabase());
    const resolver = createChannelAgentSpecResolver(snapshot.bundle, {
      publicBaseUrl: snapshot.publicBaseUrl,
    });
    const config = resolver(
      {
        kind: "agent",
        agent: "codex-safe",
        environment: "work",
        template: null,
      },
      RELAY_DEFAULTS,
      BINDING_REF,
    );
    assert.equal(config.provider, "codex");
    assert.deepEqual(config.worktree, {
      mode: "checkout-branch",
      branch: "release/next",
    });
  });
});
