import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  ChannelCompilationError,
  compileChannelControlPlane,
  type ChannelCompileInput,
} from "./compile.js";

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
secretRef: ~/.config/clisbot/secrets/slack-work.json
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
    reply: { anchor: channel }
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

  it("folds route overrides over account defaults", () => {
    const plane = compileChannelControlPlane(
      input({
        [".paseo/channels/policy.yml"]: POLICY,
        [".paseo/channels/slack/work.yml"]: SLACK_WORK,
      }),
    );
    const infra = plane.accounts[0]!.routes[1]!;
    // binding.key/channel + reply.anchor/channel are the route's overrides.
    assert.equal(infra.defaults.bindingKey, "channel");
    assert.equal(infra.defaults.replyAnchor, "channel");
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
    assert.deepEqual(routes[2]!.target, { kind: "workflow", workflow: "infra-runbook" });
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
secretRef: /tmp/secret.json
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
secretRef: /tmp/secret.json
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
secretRef: /tmp/secret.json
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
secretRef: /tmp/secret.json
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
secretRef: /tmp/secret.json
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
secretRef: /tmp/secret.json
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
secretRef: /tmp/secret.json
transport: { mode: polling }
defaults:
  interaction: { requireMention: false, followUp: { mode: auto, ttlMinutes: 120 } }
  reply: { anchor: channel }
`,
      }),
    );
    const account = plane.accounts[0]!;
    assert.equal(account.channelEnabled, true);
    assert.equal(account.defaults.requireMention, false);
    assert.equal(account.defaults.followUp.ttlMinutes, 120);
    assert.equal(account.defaults.replyAnchor, "channel");
    assert.equal(account.defaults.bindingKey, "thread");
    assert.equal(account.defaults.sync.finalAnswers, true);
    assert.equal(account.defaults.sync.threadLink, "final-only");
  });

  it("rejects an unsupported channel at P0", () => {
    expectCompileError(
      {
        [".paseo/channels/discord/main.yml"]: `
channel: discord
accountId: main
secretRef: /tmp/secret.json
transport: { mode: polling }
`,
      },
      /not supported at P0/,
    );
  });
});
