import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  ChannelCompilationError,
  compileChannelControlPlane,
  type ChannelCompileInput,
} from "./compile.js";
import { OPEN_AUDIENCE_ROUTE_LIMITS } from "./schema.js";
import { conversationSettings } from "./conversation.js";
import { openRouteWarnings, routeWarnings } from "../configuration-warnings.js";

const AGENTS = ["worker-app", "worker-infra", "assistant-personal", "telegram-butler"];
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

/** The Route compiles, and its open-audience warnings include `message`. */
function expectRouteWarning(files: Record<string, string>, message: RegExp): void {
  const route = compileChannelControlPlane(input(files)).accounts[0]?.routes[0];
  assert.ok(route !== undefined);
  const warnings = openRouteWarnings(route);
  assert.ok(
    warnings.some((warning) => message.test(warning)),
    JSON.stringify(warnings),
  );
}

function expectCompileError(files: Record<string, string>, message: RegExp): void {
  assert.throws(
    () => compileChannelControlPlane(input(files)),
    (error: unknown) => error instanceof ChannelCompilationError && message.test(error.message),
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
  - audience: [{ who: { roles: [member] }, where: { conversations: [C0APP] } }]
    contains: "#triage"
    agent: worker-app
    environment: repo-app
    template: team
    policy:
      assignments:
        - identities: [slack:U0CAROL]
          roles: [approver]
  - audience: [{ who: { roles: [member] }, where: { conversations: [C0INFRA] } }]
    agent: worker-infra
    environment: repo-infra
    binding: { key: channel }
    reply: { anchor: default }
  - audience: [{ who: { roles: [member] }, where: { conversations: [C0THREAD] } }]
    workflow: infra-runbook
  - audience: [{ who: { roles: [member] }, where: { dm: true } }]
    agent: assistant-personal
    environment: personal-lab
    template: personal
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
    assert.equal(account.routes[0]!.contains, "#triage");
    assert.deepEqual(account.routes[0]!.where, { dm: false, groups: [], conversations: ["C0APP"] });
    assert.deepEqual(account.routes[0]!.audienceRules[0]?.who.roles, ["member"]);
    assert.equal("fallback" in account, false);
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

  it("compiles wide open-audience Routes and warns about each choice", () => {
    const safe = compileChannelControlPlane(
      input({
        [".paseo/channels/slack/public.yml"]: `
channel: slack
accountId: public
connectionId: connection-id
transport: { mode: socket }
routes:
  - audience: [{ who: { anyone: true }, where: { conversations: [C_CUSTOMER] } }]
    agent: worker-app
    environment: repo-app
    sync:
      finalAnswers: true
      progress:
        progressMessage: false
        typingIndicator: false
        messageReaction: off
      toolCalls: false
      threadLink: none
      subagents: { finalAnswers: false, progress: false, toolCalls: false }
    approval: [{ match: "*", mode: auto-deny }]
`,
      }),
    );
    assert.equal(safe.accounts[0]?.routes[0]?.audienceRules[0]?.who.anyone, true);
    assert.deepEqual(safe.accounts[0]?.routes[0]?.where, {
      dm: false,
      groups: [],
      conversations: ["C_CUSTOMER"],
    });
    assert.deepEqual(safe.accounts[0]?.routes[0]?.limits, OPEN_AUDIENCE_ROUTE_LIMITS);

    expectRouteWarning(
      {
        [".paseo/channels/slack/public.yml"]: `
channel: slack
accountId: public
connectionId: connection-id
transport: { mode: socket }
routes:
  - audience: [{ who: { anyone: true }, where: { groups: all } }]
    agent: worker-app
    environment: repo-app
    sync:
      finalAnswers: true
      progress:
        progressMessage: false
        typingIndicator: false
        messageReaction: off
      toolCalls: false
      threadLink: none
      subagents: { finalAnswers: false, progress: false, toolCalls: false }
    approval: [{ match: "*", mode: auto-deny }]
`,
      },
      /Anyone in any group chat or channel/u,
    );
    expectRouteWarning(
      {
        [".paseo/channels/slack/public.yml"]: `
channel: slack
accountId: public
connectionId: connection-id
transport: { mode: socket }
routes:
  - audience: [{ who: { anyone: true }, where: { conversations: [C_CUSTOMER] } }]
    agent: worker-app
    environment: repo-app
    interaction: { requireMention: false }
`,
      },
      /answers every message/u,
    );
    expectRouteWarning(
      {
        [".paseo/channels/slack/public.yml"]: `
channel: slack
accountId: public
connectionId: connection-id
transport: { mode: socket }
routes:
  - audience: [{ who: { anyone: true }, where: { conversations: [C_CUSTOMER] } }]
    agent: worker-app
    environment: repo-app
    approval:
      - { match: file, mode: auto-allow }
      - { match: "*", mode: auto-deny }
`,
      },
      /accepted automatically for anyone/u,
    );
    expectRouteWarning(
      {
        [".paseo/channels/slack/public.yml"]: `
channel: slack
accountId: public
connectionId: connection-id
transport: { mode: socket }
routes:
  - audience: [{ who: { anyone: true }, where: { conversations: [C_CUSTOMER] } }]
    agent: worker-app
    environment: repo-app
    approval: [{ match: "*", mode: auto-deny }]
`,
      },
      /not only the final answer/u,
    );
  });

  it("folds limits over the open-audience defaults, with no ceiling and an off switch", () => {
    const plane = compileChannelControlPlane(
      input({
        [".paseo/channels/slack/public.yml"]: `
channel: slack
accountId: public
connectionId: connection-id
transport: { mode: socket }
limits:
  maxConcurrentRuns: 40
  messagesSentPerMinute: 120
  perConversation: { messagesPerMinute: 20, maxRuntimeSeconds: off }
routes:
  - audience: [{ who: { anyone: true }, where: { conversations: [C_OPEN] } }]
    agent: worker-app
    environment: repo-app
    limits: { maxConcurrentRuns: 25, maxInputCharacters: off }
  - audience: [{ who: { roles: [member] }, where: { conversations: [C_MEMBERS] } }]
    agent: worker-app
    environment: repo-app
`,
      }),
    );
    const account = plane.accounts[0]!;
    assert.deepEqual(account.limits, {
      bot: { maxConcurrentRuns: 40, messagesSentPerMinute: 120 },
      perConversation: { messagesPerMinute: 20 },
    });
    assert.deepEqual(account.routes[0]?.limits, {
      messagesPerMinutePerSender: 10,
      messagesPerMinute: 60,
      maxConcurrentRuns: 25,
      maxRuntimeSeconds: 900,
    });
    assert.equal(account.routes[1]?.limits, undefined);
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
  - audience: [{ who: { roles: [member] }, where: { conversations: [C0APP] } }]
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
  - audience: [{ who: { roles: [member] }, where: { conversations: [C0APP] } }]
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
  - audience: [{ who: { roles: [member] }, where: { conversations: [C0APP] } }]
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
  - audience: [{ who: { roles: [member] }, where: { conversations: [C0APP] } }]
    agent: worker-app
    environment: repo-app
    sync: { progress: { progressMessage: false } }
  - audience: [{ who: { roles: [member] }, where: { conversations: [C0QUIET] } }]
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
  - audience: [{ who: { roles: [member] }, where: { conversations: [C0APP] } }]
    agent: worker-app
    environment: repo-app
  - audience: [{ who: { roles: [member] }, where: { conversations: [C0RELAY] } }]
    agent: worker-app
    environment: repo-app
    outbound: { path: relay }
  - audience: [{ who: { roles: [member] }, where: { conversations: [C0HYBRID] } }]
    agent: worker-app
    environment: repo-app
    outbound: { path: hybrid }
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
    // Hybrid relays its text like relay does: the tool only adds what text cannot carry.
    assert.equal(routes[2]!.defaults.outbound.path, "hybrid");
    assert.equal(routes[2]!.defaults.sync.finalAnswers, true);
  });

  it("folds workspace.organize like every other default leaf (A6)", () => {
    const plane = compileChannelControlPlane(
      input({
        [".paseo/channels/slack/main.yml"]: `
channel: slack
accountId: main
connectionId: connection-id
transport: { mode: socket }
defaults:
  workspace: { organize: false }
routes:
  - audience: [{ who: { roles: [member] }, where: { conversations: [C0APP] } }]
    agent: worker-app
    environment: repo-app
  - audience: [{ who: { roles: [member] }, where: { conversations: [C0ORGANIZED] } }]
    agent: worker-app
    environment: repo-app
    workspace: { organize: true }
`,
      }),
    );
    const routes = plane.accounts[0]!.routes;
    // This account turns organization off and the first route inherits that;
    // the second turns it back on.
    assert.equal(routes[0]!.defaults.workspace?.organize, false);
    assert.equal(routes[1]!.defaults.workspace?.organize, true);
    // Unauthored anywhere, the key is absent: a revision written before the
    // knob existed keeps the exact compiled block (and route fingerprint) it
    // had, and absence reads as organization ON.
    const untouched = compileChannelControlPlane(
      input({
        [".paseo/channels/slack/main.yml"]: `
channel: slack
accountId: main
connectionId: connection-id
transport: { mode: socket }
routes:
  - audience: [{ who: { roles: [member] }, where: { conversations: [C0APP] } }]
    agent: worker-app
    environment: repo-app
`,
      }),
    );
    assert.equal("workspace" in untouched.accounts[0]!.routes[0]!.defaults, false);
  });

  it("folds questions like every other default leaf, absent when unauthored", () => {
    const account = (route: string, defaults = "") => `
channel: slack
accountId: main
connectionId: connection-id
transport: { mode: socket }
${defaults}
routes:
  - audience: [{ who: { roles: [member] }, where: { conversations: [C0APP] } }]
    agent: worker-app
    environment: repo-app
${route}
`;
    const compiled = (yaml: string) =>
      compileChannelControlPlane(input({ [".paseo/channels/slack/main.yml"]: yaml })).accounts[0]!
        .routes[0]!.defaults;
    assert.equal(
      compiled(account("", "defaults: { questions: recommended }")).questions,
      "recommended",
    );
    assert.equal(
      compiled(account("    questions: ask", "defaults: { questions: agent-decides }")).questions,
      "ask",
    );
    assert.equal("questions" in compiled(account("")), false);
    expectCompileError(
      { [".paseo/channels/slack/main.yml"]: account("    questions: always") },
      /questions/u,
    );
  });

  it("folds the conversation leaves per leaf, absent when unauthored", () => {
    const account = (route: string, defaults = "") => `
channel: slack
accountId: main
connectionId: connection-id
transport: { mode: socket }
${defaults}
routes:
  - audience: [{ who: { roles: [member] }, where: { conversations: [C0APP] } }]
    agent: worker-app
    environment: repo-app
${route}
`;
    const compiled = (yaml: string) =>
      compileChannelControlPlane(input({ [".paseo/channels/slack/main.yml"]: yaml })).accounts[0]!
        .routes[0]!.defaults;
    const window = { pauseSeconds: 3, maxWaitSeconds: 10, maxMessages: 20 };
    const accountOn = `defaults:
  interaction: { whenBusy: queue }
  context: { unmentioned: allowed-senders, maxMessages: 5 }
  batching: { pauseSeconds: 3, maxWaitSeconds: 10, maxMessages: 20 }`;
    const inherited = compiled(account("", accountOn));
    assert.equal(inherited.whenBusy, "queue");
    assert.deepEqual(inherited.context, { unmentioned: "allowed-senders", maxMessages: 5 });
    assert.deepEqual(inherited.batching, window);
    assert.deepEqual(conversationSettings(inherited).batching, window);
    // The account turns batching on; the Route turns it off and keeps the rest.
    const routeOff = compiled(
      account("    batching: off\n    context: { maxMessages: 2 }", accountOn),
    );
    assert.equal(routeOff.batching, "off");
    assert.equal(conversationSettings(routeOff).batching, undefined);
    assert.deepEqual(routeOff.context, { unmentioned: "allowed-senders", maxMessages: 2 });
    // Unauthored anywhere: absent, so every route fingerprint holds, and the
    // floors apply where the leaves are read.
    const untouched = compiled(account(""));
    for (const key of ["whenBusy", "context", "batching"]) assert.equal(key in untouched, false);
    assert.deepEqual(conversationSettings(untouched), {
      whenBusy: "steer",
      context: { unmentioned: "everyone", maxMessages: 20 },
      batching: undefined,
    });
  });

  it("refuses conversation leaves it cannot run, saying which", () => {
    const account = (route: string) => ({
      [".paseo/channels/slack/main.yml"]: `
channel: slack
accountId: main
connectionId: connection-id
transport: { mode: socket }
routes:
  - audience: [{ who: { roles: [member] }, where: { conversations: [C0APP] } }]
    agent: worker-app
    environment: repo-app
${route}
`,
    });
    expectCompileError(
      account("    batching: { pauseSeconds: 0, maxWaitSeconds: 10, maxMessages: 5 }"),
      /pauseSeconds must be greater than 0/u,
    );
    expectCompileError(
      account("    batching: { pauseSeconds: 5, maxWaitSeconds: 5, maxMessages: 5 }"),
      /maxWaitSeconds must be greater than batching.pauseSeconds/u,
    );
    expectCompileError(
      account("    batching: { pauseSeconds: 1, maxWaitSeconds: 5, maxMessages: 0 }"),
      /maxMessages must be at least 1/u,
    );
    expectCompileError(account("    batching: on"), /batching must be `off` or/u);
    expectCompileError(account("    interaction: { whenBusy: wait }"), /whenBusy/u);
    expectCompileError(account("    context: { unmentioned: some }"), /unmentioned/u);
    expectCompileError(account("    context: { maxMessages: 1000 }"), /at most 200/u);
  });

  it("warns once, on any Route, when every permission request is accepted", () => {
    const account = (who: string) => `
channel: slack
accountId: main
connectionId: connection-id
transport: { mode: socket }
routes:
  - audience: [{ who: ${who}, where: { conversations: [C0APP] } }]
    agent: worker-app
    environment: repo-app
    approval: [{ match: "*", mode: auto-allow }]
`;
    const route = (who: string) =>
      compileChannelControlPlane(input({ [".paseo/channels/slack/main.yml"]: account(who) }))
        .accounts[0]!.routes[0]!;
    const every = "Every permission request is accepted automatically.";
    assert.deepEqual(routeWarnings(route("{ roles: [member] }")), [every]);
    const open = route("{ anyone: true }");
    assert.deepEqual(routeWarnings(open), [every]);
    assert.equal(
      openRouteWarnings(open).some((warning) => /accepted automatically for anyone/u.test(warning)),
      false,
    );
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
  - audience: [{ who: { roles: [member] }, where: { conversations: [C0APP] } }]
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

  it("rejects a channel with no in-repo vertical", () => {
    // Every catalogued channel now has one, so the guard is proved with a name
    // that is not a channel at all — which is what it exists to refuse.
    expectCompileError(
      {
        [".paseo/channels/whatsapp/main.yml"]: `
channel: whatsapp
accountId: main
connectionId: connection-id
transport: { mode: qr }
`,
      },
      /has no in-repo vertical/,
    );
  });

  it("compiles a Zalo Personal account: the QR transport and the profile label", () => {
    const plane = compileChannelControlPlane(
      input({
        [".paseo/channels/zalouser/main.yml"]: `
channel: zalouser
accountId: main
connectionId: connection-id
transport: { mode: qr }
config:
  profile: long-personal
  textChunkMode: newline
  dangerouslyAllowNameMatching: false
routes:
  - audience: [{ who: { roles: [member] }, where: { groups: all } }]
    agent: worker-app
    environment: repo-app
`,
      }),
    );
    const account = plane.accounts[0]!;
    assert.equal(account.channel, "zalouser");
    assert.deepEqual(account.transport, { mode: "qr" });
    assert.equal(account.config["profile"], "long-personal");
    assert.equal(account.config["textChunkMode"], "newline");
  });

  it("rejects an account file that still carries a catch-all fallback", () => {
    assert.throws(
      () =>
        compileChannelControlPlane(
          input({
            [".paseo/channels/zalouser/main.yml"]: `
channel: zalouser
accountId: main
connectionId: connection-id
transport: { mode: qr }
routes:
  - audience: [{ who: { roles: [member] }, where: { groups: all } }]
    agent: worker-app
    environment: repo-app
fallback: { deny: true }
`,
          }),
        ),
      ChannelCompilationError,
    );
  });

  it("rejects a wrong-typed Zalo Personal config knob at deploy", () => {
    expectCompileError(
      {
        [".paseo/channels/zalouser/main.yml"]: `
channel: zalouser
accountId: main
connectionId: connection-id
transport: { mode: qr }
config:
  textChunkLimit: "2000"
`,
      },
      /config/,
    );
  });

  it("rejects a Discord transport mode the vertical does not implement", () => {
    expectCompileError(
      {
        [".paseo/channels/discord/main.yml"]: `
channel: discord
accountId: main
connectionId: connection-id
transport: { mode: polling }
`,
      },
      /expected "gateway"/,
    );
  });

  it("compiles a Discord gateway account with dm/channel/thread routes", () => {
    const plane = compileChannelControlPlane(
      input({
        [".paseo/channels/discord/main.yml"]: `
channel: discord
accountId: main
connectionId: connection-id
transport: { mode: gateway }
routes:
  - audience: [{ who: { roles: [member] }, where: { dm: true } }]
    agent: worker-app
    environment: repo-app
  - audience: [{ who: { roles: [member] }, where: { conversations: ["123456789012345678"] } }]
    agent: worker-app
    environment: repo-app
  - audience: [{ who: { roles: [member] }, where: { groups: all } }]
    agent: worker-app
    environment: repo-app
`,
      }),
    );
    const account = plane.accounts[0]!;
    assert.equal(account.channel, "discord");
    assert.deepEqual(account.transport, { mode: "gateway" });
    assert.deepEqual(
      account.routes.map((route) => route.where),
      [
        { dm: true, groups: [], conversations: [] },
        { dm: false, groups: [], conversations: ["123456789012345678"] },
        { dm: false, groups: ["all"], conversations: [] },
      ],
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
});

// --- Slices 14b/15b/16b: Google Chat, Feishu, Zalo -------------------------------

describe("channel compile: the later in-repo verticals", () => {
  it("compiles a Google Chat account and carries its webhook knobs verbatim", () => {
    const plane = compileChannelControlPlane(
      input({
        [".paseo/channels/googlechat/workspace.yml"]: `
channel: googlechat
accountId: workspace
connectionId: googlechat-workspace
transport: { mode: webhook }
config:
  audienceType: app-url
  audience: https://chat.example.com/googlechat
  appPrincipal: "123456789012345678901"
  webhookUrl: https://chat.example.com/googlechat
  webhookPort: 8443
  webhookHost: 127.0.0.1
  botUser: users/1234
  allowBots: false
  mediaMaxMb: 20
routes:
  - audience: [{ who: { roles: [member] }, where: { conversations: [spaces/AAAA] } }]
    agent: worker-app
    environment: repo-app
`,
      }),
    );
    const account = plane.accounts[0]!;
    assert.equal(account.channel, "googlechat");
    assert.deepEqual(account.transport, { mode: "webhook" });
    // The vertical's own account resolution reads these; the Hub passes them
    // through untouched (`supervisor/account-carriers.ts` googlechat).
    assert.equal(account.config["audienceType"], "app-url");
    assert.equal(account.config["appPrincipal"], "123456789012345678901");
    assert.equal(account.config["webhookPort"], 8443);
    assert.equal(account.config["webhookHost"], "127.0.0.1");
    assert.equal(account.config["botUser"], "users/1234");
  });

  it("compiles a Feishu long-connection account with its tool-family gate", () => {
    const plane = compileChannelControlPlane(
      input({
        [".paseo/channels/feishu/lark.yml"]: `
channel: feishu
accountId: lark
connectionId: feishu-lark
transport: { mode: websocket }
config:
  domain: lark
  allowBots: false
  actions: { reactions: true }
  tools: { doc: true, chat: true, perm: false, bitable: true }
  httpTimeoutMs: 20000
routes:
  - audience: [{ who: { roles: [member] }, where: { dm: true } }]
    agent: assistant-personal
    environment: personal-lab
`,
      }),
    );
    const account = plane.accounts[0]!;
    assert.deepEqual(account.transport, { mode: "websocket" });
    assert.equal(account.config["domain"], "lark");
    assert.deepEqual(account.config["tools"], {
      doc: true,
      chat: true,
      perm: false,
      bitable: true,
    });
  });

  it("compiles a Zalo polling account with its Fusion-added mention aliases", () => {
    const plane = compileChannelControlPlane(
      input({
        [".paseo/channels/zalo/oa.yml"]: `
channel: zalo
accountId: oa
connectionId: zalo-oa
transport: { mode: polling }
config:
  mediaMaxMb: 5
  botNames: [fusion, "trợ lý"]
routes:
  - audience: [{ who: { roles: [member] }, where: { conversations: ["4000"] } }]
    agent: worker-app
    environment: repo-app
`,
      }),
    );
    const account = plane.accounts[0]!;
    assert.deepEqual(account.transport, { mode: "polling" });
    assert.deepEqual(account.config["botNames"], ["fusion", "trợ lý"]);
  });

  it("type-checks the vertical-owned account config instead of passing a typo through", () => {
    expectCompileError(
      {
        [".paseo/channels/zalo/oa.yml"]: `
channel: zalo
accountId: oa
connectionId: zalo-oa
transport: { mode: polling }
config: { webhookPort: "8443" }
`,
      },
      /config\.webhookPort/,
    );
    expectCompileError(
      {
        [".paseo/channels/googlechat/workspace.yml"]: `
channel: googlechat
accountId: workspace
connectionId: googlechat-workspace
transport: { mode: webhook }
config: { audienceType: project }
`,
      },
      /config\.audienceType/,
    );
    // A knob this Hub does not read still compiles: an OpenClaw-authored
    // account must stay compilable.
    const plane = compileChannelControlPlane(
      input({
        [".paseo/channels/feishu/lark.yml"]: `
channel: feishu
accountId: lark
connectionId: feishu-lark
transport: { mode: websocket }
config: { streamingCard: true }
`,
      }),
    );
    assert.equal(plane.accounts[0]!.config["streamingCard"], true);
  });

  it("refuses a transport mode the Hub cannot receive events on", () => {
    expectCompileError(
      {
        [".paseo/channels/feishu/lark.yml"]: `
channel: feishu
accountId: lark
connectionId: feishu-lark
transport: { mode: webhook }
`,
      },
      /feishu webhook transport is not implemented/,
    );
    expectCompileError(
      {
        [".paseo/channels/zalo/oa.yml"]: `
channel: zalo
accountId: oa
connectionId: zalo-oa
transport: { mode: webhook }
`,
      },
      /zalo webhook transport is not implemented/,
    );
    // Google Chat has no alternative delivery model, so its webhook IS drivable.
    expectCompileError(
      {
        [".paseo/channels/googlechat/workspace.yml"]: `
channel: googlechat
accountId: workspace
connectionId: googlechat-workspace
transport: { mode: polling }
`,
      },
      /Invalid option|expected/,
    );
  });
});

describe("access defaults", () => {
  const account = (body: string) => `
channel: telegram
accountId: butler
connectionId: telegram-butler
transport: { mode: polling }
${body}
`;

  it("omits the key entirely when no layer authored a leaf", () => {
    const plane = compileChannelControlPlane(
      input({
        [".paseo/channels/telegram/butler.yml"]: account(`routes:
  - audience: [{ who: { roles: [member] }, where: { dm: true } }]
    agent: telegram-butler
    environment: personal-lab`),
      }),
    );
    assert.equal(plane.accounts[0]?.routes[0]?.defaults.access, undefined);
  });

  it("folds org < account < route with the upstream leaf names", () => {
    const plane = compileChannelControlPlane(
      input({
        [".paseo/channels/policy.yml"]: `
enabled: true
defaults:
  access:
    dmPolicy: pairing
    groupPolicy: allowlist
    allowFrom: [111]
`,
        [".paseo/channels/telegram/butler.yml"]: account(`defaults:
  access:
    groupAllowFrom: [222, "tg:333"]
    deniedReply: "Not allowed."
routes:
  - audience: [{ who: { roles: [member] }, where: { dm: true } }]
    agent: telegram-butler
    environment: personal-lab
    access: { dmPolicy: allowlist }`),
      }),
    );
    const route = plane.accounts[0]?.routes[0];
    assert.deepEqual(route?.defaults.access, {
      dmPolicy: "allowlist",
      groupPolicy: "allowlist",
      allowFrom: [111],
      groupAllowFrom: [222, "tg:333"],
      deniedReply: "Not allowed.",
    });
  });

  it("refuses a policy name upstream does not have", () => {
    expectCompileError(
      {
        [".paseo/channels/telegram/butler.yml"]: account(`defaults:
  access: { dmPolicy: everyone }
routes:
  - audience: [{ who: { roles: [member] }, where: { dm: true } }]
    agent: telegram-butler
    environment: personal-lab`),
      },
      /Invalid option|expected/,
    );
  });
});

describe("route selectable targets", () => {
  const account = (body: string) => `
channel: telegram
accountId: butler
connectionId: telegram-butler
transport: { mode: polling }
${body}
`;

  it("compiles the agents and models a route offers", () => {
    const plane = compileChannelControlPlane(
      input({
        [".paseo/channels/telegram/butler.yml"]: account(`routes:
  - audience: [{ who: { roles: [member] }, where: { dm: true } }]
    agent: telegram-butler
    environment: personal-lab
    agents: [worker-app]
    models: [gpt-5.6-luna]`),
      }),
    );
    assert.deepEqual(plane.accounts[0]?.routes[0]?.selectable, {
      agents: ["worker-app"],
      models: ["gpt-5.6-luna"],
    });
  });

  it("refuses an agent name hub.yml does not define", () => {
    expectCompileError(
      {
        [".paseo/channels/telegram/butler.yml"]: account(`routes:
  - audience: [{ who: { roles: [member] }, where: { dm: true } }]
    agent: telegram-butler
    environment: personal-lab
    agents: [ghost]`),
      },
      /agent ghost is not defined in hub\.yml/,
    );
  });
});

describe("audience rules", () => {
  it("compiles the new shape: rules on audience, contains at route level", () => {
    const plane = compileChannelControlPlane(
      input({
        [".paseo/channels/slack/work.yml"]: `
channel: slack
accountId: work
connectionId: connection-id
transport: { mode: socket }
routes:
  - audience:
      - who: { roles: [owner, admin] }
        where: { dm: true, groups: all }
      - who: { teams: [qc] }
        where: { groups: public, conversations: [C0PRIVATE] }
    contains: deploy
    agent: worker-app
    environment: repo-app
`,
      }),
    );
    const route = plane.accounts[0]!.routes[0]!;
    assert.equal(route.contains, "deploy");
    assert.deepEqual(route.where, {
      dm: true,
      groups: ["all", "public"],
      conversations: ["C0PRIVATE"],
    });
    assert.deepEqual(route.audienceRules[1]?.who.teams, ["qc"]);
    assert.equal(route.limits, undefined, "no anyone rule, no open-audience defaults");
  });

  it("reports a rule with no Who part under routes[i].audience[j]", () => {
    expectCompileError(
      {
        [".paseo/channels/slack/work.yml"]: `
channel: slack
accountId: work
connectionId: connection-id
transport: { mode: socket }
routes:
  - audience:
      - who: { roles: [owner] }
        where: { dm: true }
      - who: {}
        where: { dm: true }
    agent: worker-app
    environment: repo-app
`,
      },
      /work\.yml\.routes\.0\.audience\.1\.who: an audience rule needs at least one Who part/,
    );
  });
});
