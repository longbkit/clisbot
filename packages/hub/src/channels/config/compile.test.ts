import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  ChannelCompilationError,
  compileChannelControlPlane,
  type ChannelCompileInput,
} from "./compile.js";

const AGENTS = [
  "worker-app",
  "worker-infra",
  "assistant-personal",
  "telegram-butler",
];
const ENVIRONMENTS = ["repo-app", "repo-infra", "personal-lab"];
const WORKFLOWS = ["infra-runbook"];

function input(
  files: Record<string, string>,
  overrides: Partial<Omit<ChannelCompileInput, "files">> = {},
): ChannelCompileInput {
  return {
    files: Object.entries(files).map(([path, content]) => ({ path, content })),
    agentNames: AGENTS,
    environmentNames: ENVIRONMENTS,
    workflowNames: WORKFLOWS,
    ...overrides,
  };
}

function expectCompileError(
  files: Record<string, string>,
  message: RegExp,
): void {
  assert.throws(
    () => compileChannelControlPlane(input(files)),
    (error: unknown) =>
      error instanceof ChannelCompilationError && message.test(error.message),
  );
}

// YAML note: an unquoted `*` (or `*.`) in a flow sequence is an alias node, so
// the doc's wildcard privilege/match entries are quoted below — the compiler
// sees the same string.

// The §4.3.3 worked example, verbatim: one Slack bot account with two channel
// routes, one thread→workflow hand-off, and a catch-all DM route.
const SLACK_WORK = `
channel: slack
accountId: work
enabled: true
connectionId: slack-work
transport: { mode: socket, errorPolicy: once }
policy:
  defaultRoles: [user]
  assignments:
    - identities: [user:minh.pham]
      roles: [operator]
defaults:
  interaction: { requireMention: true, followUp: { mode: auto, ttlMinutes: 60 } }
  binding: { key: thread }
  reply: { anchor: thread }
  sync: { threadLink: full }
  approval:
    - { match: command.destructive, mode: require, initiatorOnly: true }
routes:
  - match: { kind: channel, ids: [C0APP] }
    agent: worker-app
    environment: repo-app
    template: team
    policy:
      assignments:
        - identities: [slack:U0CAROL]
          roles: [approver]
  - match: { kind: channel, ids: [C0INFRA] }
    agent: worker-infra
    environment: repo-infra
    binding: { key: channel }
    reply: { anchor: default }
  - match: { kind: thread, ids: [C0THREAD] }
    workflow: infra-runbook
  - match: { kind: dm }
    agent: assistant-personal
    environment: personal-lab
    template: personal
fallback: { deny: true }
`;

const POLICY = `
enabled: true
channels:
  slack: { enabled: true }
  telegram: { enabled: false }
roles:
  user:
    grants: [bot.interact]
  approver:
    extends: [user]
    grants: ["approval.*"]
  operator:
    extends: [user]
    grants: ["tool.*", approval.file, approval.command, "channel.tool.*"]
    deny: [approval.command.destructive]
  admin:
    grants: ["*"]
users:
  long.luong:
    name: Long Luong
    identities: [slack:U0ALICE, telegram:123456789, email:long@acme.dev]
  minh.pham:
    name: Minh Pham
    identities: [slack:U0BOB, telegram:987654321]
assignments:
  - identities: [user:long.luong]
    roles: [admin]
  - identities: [slack:U0BOB]
    roles: [operator]
  - identities: [slack:U0CAROL]
    roles: [approver]
defaults:
  defaultRoles: [user]
  interaction:
    requireMention: true
    followUp: { mode: auto, ttlMinutes: 60 }
  binding: { key: thread }
  reply: { anchor: thread }
  sync:
    finalAnswers: true
    progress: false
    toolCalls: false
    threadLink: final-only
  approval:
    - { match: command.destructive, mode: require, initiatorOnly: true }
    - { match: file, mode: auto-allow }
    - { match: "*", mode: require }
`;

describe("compileChannelControlPlane", () => {
  it("compiles the documented Slack account + org policy", () => {
    const plane = compileChannelControlPlane(
      input({
        [".paseo/channels/policy.yml"]: POLICY,
        [".paseo/channels/slack/work.yml"]: SLACK_WORK,
      }),
    );
    assert.equal(plane.enabled, true);
    assert.deepEqual(plane.channelEnabled, { slack: true, telegram: false });
    assert.ok(plane.accounts.length === 1);
    const account = plane.accounts[0]!;
    assert.equal(account.channel, "slack");
    assert.equal(account.accountId, "work");
    assert.equal(account.channelEnabled, true);
    assert.equal(account.enabled, true);
    assert.equal(account.defaultRoles.length, 1);
    assert.equal(account.defaultRoles[0], "user");
    // Account defaults fold org < account: the account sets sync.threadLink: full.
    assert.equal(account.defaults.sync.threadLink, "full");
    assert.equal(account.defaults.bindingKey, "thread");
    assert.equal(account.defaults.replyAnchor, "thread");
    assert.equal(account.defaults.followUp.ttlMinutes, 60);
    // Org approval rules are inherited (account adds none).
    assert.equal(account.approval.length, 3);
    assert.equal(account.approval[0]!.match, "command.destructive");
    assert.equal(account.routes.length, 4);
    assert.equal(account.fallback.deny, true);
  });

  it("passes the vertical-owned account config block through verbatim", () => {
    const plane = compileChannelControlPlane(
      input({
        [".paseo/channels/policy.yml"]: POLICY,
        [".paseo/channels/slack/work.yml"]: `
channel: slack
accountId: work
connectionId: connection-id
transport: { mode: socket }
config:
  richMessages: true
  timeoutSeconds: 90
`,
      }),
    );
    // The hub never interprets these keys; the vertical's account resolution
    // type-checks each one on read (bot-api resolveTelegramAccount).
    assert.deepEqual(plane.accounts[0]!.config, {
      richMessages: true,
      timeoutSeconds: 90,
    });
  });

  it("defaults the account config block to empty when omitted", () => {
    const plane = compileChannelControlPlane(
      input({
        [".paseo/channels/policy.yml"]: POLICY,
        [".paseo/channels/slack/work.yml"]: `
channel: slack
accountId: work
connectionId: connection-id
transport: { mode: socket }
`,
      }),
    );
    assert.deepEqual(plane.accounts[0]!.config, {});
  });

  it("rejects two accounts that would start competing transports for one connection", () => {
    expectCompileError(
      {
        [".paseo/channels/slack/first.yml"]: `
channel: slack
accountId: first
connectionId: shared-connection
transport: { mode: socket }
`,
        [".paseo/channels/slack/second.yml"]: `
channel: slack
accountId: second
connectionId: shared-connection
transport: { mode: socket }
`,
      },
      /connection shared-connection is already used by account first/u,
    );
  });

  it("folds route overrides over account defaults", () => {
    const plane = compileChannelControlPlane(
      input({
        [".paseo/channels/policy.yml"]: POLICY,
        [".paseo/channels/slack/work.yml"]: SLACK_WORK,
      }),
    );
    const infra = plane.accounts[0]!.routes[1]!;
    // binding.key/channel + reply.anchor/default are the route's overrides.
    assert.equal(infra.defaults.bindingKey, "channel");
    assert.equal(infra.defaults.replyAnchor, "default");
    // Unset leaves inherit the account layer, then the org floor.
    assert.equal(infra.defaults.sync.threadLink, "full");
    assert.equal(infra.defaults.followUp.ttlMinutes, 60);
    // The route's assignments layer is the union of org (3) + account (1) +
    // route (0) — the documented org ⊕ account ⊕ route fold.
    assert.equal(infra.assignments.length, 4);
  });

  it("maps the agent and workflow route targets", () => {
    const plane = compileChannelControlPlane(
      input({
        [".paseo/channels/policy.yml"]: POLICY,
        [".paseo/channels/slack/work.yml"]: SLACK_WORK,
      }),
    );
    const routes = plane.accounts[0]!.routes;
    assert.deepEqual(routes[0]!.target, {
      kind: "agent",
      agent: "worker-app",
      environment: "repo-app",
      template: "team",
    });
    assert.deepEqual(routes[2]!.target, {
      kind: "workflow",
      workflow: "infra-runbook",
    });
  });

  it("computes role closures with extends and fail-closed unknowns", () => {
    const plane = compileChannelControlPlane(
      input({
        [".paseo/channels/policy.yml"]: POLICY,
      }),
    );
    assert.deepEqual(plane.roles["operator"]?.closure, ["operator", "user"]);
    assert.deepEqual(plane.roles["admin"]?.closure, ["admin"]);
    assert.equal(plane.identityOwners["slack:U0ALICE"], "long.luong");
    assert.equal(plane.users["minh.pham"]?.name, "Minh Pham");
  });

  it("rejects an identity owned by two users", () => {
    expectCompileError(
      {
        [".paseo/channels/policy.yml"]: `
users:
  a: { identities: [slack:U1] }
  b: { identities: [slack:U1] }
`,
      },
      /already belongs to a/,
    );
  });

  it("rejects an assignment to an unknown user", () => {
    expectCompileError(
      {
        [".paseo/channels/policy.yml"]: POLICY,
        [".paseo/channels/slack/work.yml"]: `
channel: slack
accountId: work
connectionId: connection-id
transport: { mode: socket }
policy:
  assignments:
    - identities: [user:ghost]
      roles: [admin]
`,
      },
      /unknown user user:ghost/,
    );
  });

  it("rejects a role extends cycle", () => {
    expectCompileError(
      {
        [".paseo/channels/policy.yml"]: `
roles:
  a:
    extends: [b]
    grants: [bot.interact]
  b:
    extends: [a]
    grants: [bot.interact]
`,
      },
      /cycle/,
    );
  });

  it("rejects an unknown privilege pattern in a role", () => {
    expectCompileError(
      {
        [".paseo/channels/policy.yml"]: `
roles:
  rogue:
    grants: [approval.command.destructive.force]
`,
      },
      /unknown privilege/,
    );
  });

  it("rejects an account whose keys do not match the path", () => {
    expectCompileError(
      {
        [".paseo/channels/slack/work.yml"]: `
channel: slack
accountId: personal
connectionId: connection-id
transport: { mode: socket }
`,
      },
      /accountId personal must match the file name work/,
    );
  });

  it("rejects a route that targets both an agent and a workflow", () => {
    expectCompileError(
      {
        [".paseo/channels/slack/work.yml"]: `
channel: slack
accountId: work
connectionId: connection-id
transport: { mode: socket }
routes:
  - match: { kind: channel, ids: [C0APP] }
    agent: worker-app
    environment: repo-app
    workflow: infra-runbook
`,
      },
      /exactly one is allowed/,
    );
  });

  it("rejects a route whose agent is not in hub.yml", () => {
    expectCompileError(
      {
        [".paseo/channels/slack/work.yml"]: `
channel: slack
accountId: work
connectionId: connection-id
transport: { mode: socket }
routes:
  - match: { kind: channel, ids: [C0APP] }
    agent: not-an-agent
    environment: repo-app
`,
      },
      /not defined in hub\.yml/,
    );
  });

  it("rejects approval rules without a * fallback", () => {
    expectCompileError(
      {
        [".paseo/channels/slack/work.yml"]: `
channel: slack
accountId: work
connectionId: connection-id
transport: { mode: socket }
defaults:
  approval:
    - { match: file, mode: auto-allow }
`,
      },
      /match: "\*" fallback/,
    );
  });

  it("rejects an approval match outside the closed vocabulary", () => {
    expectCompileError(
      {
        [".paseo/channels/slack/work.yml"]: `
channel: slack
accountId: work
connectionId: connection-id
transport: { mode: socket }
defaults:
  approval:
    - { match: comamnd, mode: require }
    - { match: "*", mode: require }
`,
      },
      /match must be a tool class/,
    );
  });

  it("compiles a channel with no policy.yml using org floors", () => {
    const plane = compileChannelControlPlane(
      input({
        [".paseo/channels/telegram/support.yml"]: `
channel: telegram
accountId: support
connectionId: connection-id
transport: { mode: polling }
defaults:
  interaction: { requireMention: false, followUp: { mode: auto, ttlMinutes: 120 } }
  reply: { anchor: default }
`,
      }),
    );
    const account = plane.accounts[0]!;
    assert.equal(account.channelEnabled, true);
    assert.equal(account.defaults.requireMention, false);
    assert.equal(account.defaults.followUp.ttlMinutes, 120);
    assert.equal(account.defaults.replyAnchor, "default");
    assert.equal(account.defaults.bindingKey, "thread");
    assert.equal(account.defaults.sync.finalAnswers, true);
    assert.equal(account.defaults.sync.threadLink, "final-only");
    assert.deepEqual(account.defaults.sync.progress, {
      progressMessage: true,
      typingIndicator: true,
      messageReaction: "off",
    });
    // The subagent relay knobs floor off, even though root relay is on.
    assert.deepEqual(account.defaults.sync.subagents, {
      finalAnswers: false,
      progress: false,
      toolCalls: false,
    });
  });

  it("folds an account-level sync.subagents override onto its routes", () => {
    const plane = compileChannelControlPlane(
      input({
        [".paseo/channels/slack/main.yml"]: `
channel: slack
accountId: main
connectionId: connection-id
transport: { mode: socket }
defaults:
  sync: { subagents: { finalAnswers: true } }
routes:
  - match: { kind: channel, ids: [C0APP] }
    agent: worker-app
    environment: repo-app
    sync: { subagents: { toolCalls: true } }
`,
      }),
    );
    const route = plane.accounts[0]!.routes[0]!;
    // Root sync is untouched; the subagent leaves fold org floor < account < route.
    assert.equal(route.defaults.sync.finalAnswers, true);
    assert.deepEqual(route.defaults.sync.subagents, {
      finalAnswers: true,
      progress: false,
      toolCalls: true,
    });
  });

  it("normalizes the pre-group boolean progress onto progressMessage only", () => {
    // Every already-authored revision writes `progress: true|false`. It must
    // keep compiling, and it must mean ONLY the relayed line — the two liveness
    // leaves come from the floor, not from the legacy boolean.
    const plane = compileChannelControlPlane(
      input({
        [".paseo/channels/slack/work.yml"]: `
channel: slack
accountId: work
connectionId: connection-id
transport: { mode: socket }
defaults:
  sync: { progress: true }
`,
      }),
    );
    assert.deepEqual(plane.accounts[0]!.defaults.sync.progress, {
      progressMessage: true,
      typingIndicator: true,
      messageReaction: "off",
    });
  });

  it("folds the sync.progress group per leaf across the layers", () => {
    // Each leaf is inherited independently: the org turns the indicator off,
    // the account picks a reaction emoji, the route mutes its own progress
    // line — and none of the three disturbs the others.
    const plane = compileChannelControlPlane(
      input({
        [".paseo/channels/policy.yml"]: `
defaults:
  sync: { progress: { typingIndicator: false } }
`,
        [".paseo/channels/slack/work.yml"]: `
channel: slack
accountId: work
connectionId: connection-id
transport: { mode: socket }
defaults:
  sync: { progress: { messageReaction: hourglass_flowing_sand } }
routes:
  - match: { kind: channel, ids: [C0APP] }
    agent: worker-app
    environment: repo-app
    sync: { progress: { progressMessage: false } }
  - match: { kind: channel, ids: [C0QUIET] }
    agent: worker-app
    environment: repo-app
    sync: { progress: { messageReaction: off } }
`,
      }),
    );
    const routes = plane.accounts[0]!.routes;
    assert.deepEqual(routes[0]!.defaults.sync.progress, {
      progressMessage: false,
      typingIndicator: false,
      messageReaction: "hourglass_flowing_sand",
    });
    // The narrowest layer wins per leaf: this route turns the reaction off and
    // inherits the rest.
    assert.deepEqual(routes[1]!.defaults.sync.progress, {
      progressMessage: true,
      typingIndicator: false,
      messageReaction: "off",
    });
  });

  it("rejects a malformed messageReaction emoji name", () => {
    // The value is open (custom emoji are user-created), so the guard is the
    // name shape: a typo fails at compile, not as a bad_emoji on every turn.
    expectCompileError(
      {
        [".paseo/channels/slack/work.yml"]: `
channel: slack
accountId: work
connectionId: connection-id
transport: { mode: socket }
defaults:
  sync: { progress: { messageReaction: "Hourglass Flowing Sand" } }
`,
      },
      /emoji name/,
    );
  });

  it("folds outbound like every other default leaf (org floor < account < route)", () => {
    const plane = compileChannelControlPlane(
      input({
        [".paseo/channels/slack/main.yml"]: `
channel: slack
accountId: main
connectionId: connection-id
transport: { mode: socket }
defaults:
  outbound: { path: tool }
  sync: { threadLink: full, finalAnswers: true }
routes:
  - match: { kind: channel, ids: [C0APP] }
    agent: worker-app
    environment: repo-app
  - match: { kind: channel, ids: [C0RELAY] }
    agent: worker-app
    environment: repo-app
    outbound: { path: relay }
`,
      }),
    );
    const routes = plane.accounts[0]!.routes;
    // Account sets path: tool; the first route inherits it.
    assert.equal(routes[0]!.defaults.outbound.path, "tool");
    assert.equal(routes[0]!.defaults.outbound.template, null);
    // The tool path silences the relayed TEXT leaves (a tool post is the only
    // user-visible answer) but not the liveness leaves: a typing indicator or a
    // reaction is not a post, and a tool turn has less visible text than a
    // relay turn. threadLink keeps its folded value.
    assert.deepEqual(routes[0]!.defaults.sync, {
      finalAnswers: false,
      progress: {
        progressMessage: false,
        typingIndicator: true,
        messageReaction: "off",
      },
      toolCalls: false,
      threadLink: "full",
      subagents: { finalAnswers: false, progress: false, toolCalls: false },
    });
    // The second route overrides back to relay: the sync leaves keep their fold.
    assert.equal(routes[1]!.defaults.outbound.path, "relay");
    assert.equal(routes[1]!.defaults.sync.finalAnswers, true);
    assert.equal(routes[1]!.defaults.sync.threadLink, "full");
  });

  it("carries a route-level outbound.template onto the tool path", () => {
    const plane = compileChannelControlPlane(
      input({
        [".paseo/channels/slack/main.yml"]: `
channel: slack
accountId: main
connectionId: connection-id
transport: { mode: socket }
routes:
  - match: { kind: channel, ids: [C0APP] }
    agent: worker-app
    environment: repo-app
    outbound: { path: tool, template: "Reply only via the message tool." }
`,
      }),
    );
    const route = plane.accounts[0]!.routes[0]!;
    assert.deepEqual(route.defaults.outbound, {
      path: "tool",
      template: "Reply only via the message tool.",
    });
  });

  it("rejects an unsupported channel at P0", () => {
    expectCompileError(
      {
        [".paseo/channels/discord/main.yml"]: `
channel: discord
accountId: main
connectionId: connection-id
transport: { mode: polling }
`,
      },
      /not supported at P0/,
    );
  });

  it("rejects an organization assignment to an unknown user even with no accounts", () => {
    expectCompileError(
      {
        [".paseo/channels/policy.yml"]: `
assignments:
  - identities: [user:missing]
    roles: [operator]
`,
      },
      /unknown user user:missing/,
    );
  });

  it("rejects transport modes whose inbound runtime is not implemented", () => {
    expectCompileError(
      {
        [".paseo/channels/slack/work.yml"]: `
channel: slack
accountId: work
connectionId: connection-id
transport: { mode: webhook, webhookPath: /channels/slack/work/webhook }
`,
      },
      /webhook transport is not implemented/,
    );
    expectCompileError(
      {
        [".paseo/channels/telegram/work.yml"]: `
channel: telegram
accountId: work
connectionId: connection-id
transport: { mode: webhook }
`,
      },
      /webhook transport is not implemented/,
    );
  });

  it("rejects route kinds a channel can never emit", () => {
    expectCompileError(
      {
        [".paseo/channels/slack/work.yml"]: `
channel: slack
accountId: work
connectionId: connection-id
transport: { mode: socket }
routes:
  - match: { kind: topic }
    agent: worker-app
    environment: repo-app
`,
      },
      /slack never emits a topic conversation/,
    );
    expectCompileError(
      {
        [".paseo/channels/telegram/work.yml"]: `
channel: telegram
accountId: work
connectionId: connection-id
transport: { mode: polling }
routes:
  - match: { kind: thread }
    agent: worker-app
    environment: repo-app
`,
      },
      /telegram never emits a thread conversation/,
    );
  });
});
