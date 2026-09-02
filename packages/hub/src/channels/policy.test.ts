import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type {
  ChannelControlPlane,
  CompiledChannelAccount,
  CompiledRoute,
  CompiledUser,
  EffectiveDefaults,
} from "./config/compile.js";
import type { RoleAssignment } from "./config/schema.js";
import {
  CHANNEL_SESSION_POSTURE,
  assertApprovalRequiredPosture,
  approvalDecisionFor,
  classifyToolClass,
  effectivePrivileges,
  effectiveRoles,
  fallbackRoleScope,
  isEnabled,
  mayApprove,
  mayTrigger,
  matchRoute,
  postureIsApprovalRequired,
  resolvePrincipal,
  routeRoleScope,
  ruleMatchCoversToolClass,
} from "./policy.js";
import type { AgentPermissionRequest } from "./daemon/types.js";

// House style: node:assert/strict + vitest describe/it. Pure-logic tests over
// hand-built compiled snapshots (no compiler, no IO). The route fixtures build
// `assignments` the way the compiler does — the org ⊕ account ⊕ route
// concatenation (compile.ts) — so a decision at route scope sees every layer.

// --- Fixtures ------------------------------------------------------------------

const DEFAULTS: EffectiveDefaults = {
  requireMention: true,
  followUp: { mode: "auto", ttlMinutes: 60 },
  bindingKey: "thread",
  replyAnchor: "thread",
  outbound: { path: "relay", template: null },
  sync: {
    finalAnswers: true,
    progress: { progressMessage: false, typingIndicator: false, messageReaction: "off" },
    toolCalls: false,
    threadLink: "final-only",
    subagents: { finalAnswers: false, progress: false, toolCalls: false },
  },
};

/** The doc's four roles (§4.3.2), with precomputed `extends` closures. */
function makeRoles(): ChannelControlPlane["roles"] {
  return {
    user: { grants: ["bot.interact"], deny: [], extends: [], closure: ["user"] },
    approver: {
      grants: ["approval.*"],
      deny: [],
      extends: ["user"],
      closure: ["approver", "user"],
    },
    operator: {
      grants: ["tool.*", "approval.file", "approval.command", "channel.tool.*"],
      deny: ["approval.command.destructive"],
      extends: ["user"],
      closure: ["operator", "user"],
    },
    admin: { grants: ["*"], deny: [], extends: [], closure: ["admin"] },
  };
}

interface PlaneOverrides {
  enabled?: boolean;
  assignments?: readonly RoleAssignment[];
  identityOwners?: Readonly<Record<string, string>>;
  users?: Readonly<Record<string, CompiledUser>>;
}

/** A control plane with the doc's four roles and one mapped user. */
function makePlane(overrides: PlaneOverrides = {}): ChannelControlPlane {
  return {
    enabled: overrides.enabled ?? true,
    channelEnabled: {},
    roles: makeRoles(),
    users: overrides.users ?? {
      "long.luong": { name: "Long Luong", identities: ["slack:U0ALICE", "telegram:123456789"] },
    },
    identityOwners: overrides.identityOwners ?? {
      "slack:U0ALICE": "long.luong",
      "telegram:123456789": "long.luong",
    },
    assignments: overrides.assignments ?? [{ identities: ["user:long.luong"], roles: ["admin"] }],
    defaults: DEFAULTS,
    approval: [],
    accounts: [],
  };
}

interface AccountOverrides {
  enabled?: boolean;
  channelEnabled?: boolean;
  defaultRoles?: string[];
  assignments?: readonly RoleAssignment[];
  routes?: readonly CompiledRoute[];
  fallback?: CompiledChannelAccount["fallback"];
}

function makeAccount(overrides: AccountOverrides = {}): CompiledChannelAccount {
  return {
    channel: "slack",
    accountId: "work",
    enabled: overrides.enabled ?? true,
    channelEnabled: overrides.channelEnabled ?? true,
    connectionId: "connection",
    transport: { mode: "socket" },
    config: {},
    defaultRoles: overrides.defaultRoles ?? ["user"],
    assignments: overrides.assignments ?? [],
    defaults: DEFAULTS,
    approval: [],
    routes: overrides.routes ?? [],
    fallback: overrides.fallback ?? { deny: true },
  };
}

interface RouteOverrides {
  match?: CompiledRoute["match"];
  target?: CompiledRoute["target"];
  defaultRoles?: string[];
  /** Route-scoped assignments only; the helper prepends org ⊕ account. */
  routeAssignments?: readonly RoleAssignment[];
  approval?: CompiledRoute["approval"];
}

/**
 * A route with the compiler's concatenated assignments (org ⊕ account ⊕ route)
 * and the doc's default approval list (§4.3.2).
 */
function routeFor(
  plane: ChannelControlPlane,
  account: CompiledChannelAccount,
  overrides: RouteOverrides = {},
): CompiledRoute {
  return {
    match: overrides.match ?? { kind: "channel", ids: ["C0APP"] },
    target: overrides.target ?? {
      kind: "agent",
      agent: "worker-app",
      environment: "repo-app",
      template: null,
    },
    defaultRoles: overrides.defaultRoles ?? ["user"],
    assignments: [
      ...plane.assignments,
      ...account.assignments,
      ...(overrides.routeAssignments ?? [{ identities: ["user:long.luong"], roles: ["admin"] }]),
    ],
    defaults: DEFAULTS,
    approval: overrides.approval ?? [
      { match: "command.destructive", mode: "require", initiatorOnly: true },
      { match: "file", mode: "auto-allow" },
      { match: "*", mode: "require" },
    ],
  };
}

function toolRequest(name: string, input?: Record<string, unknown>): AgentPermissionRequest {
  return {
    id: "perm-1",
    provider: "claude",
    name,
    kind: "tool",
    ...(input !== undefined ? { input } : {}),
  };
}

// --- Tool-class mapping ----------------------------------------------------------

describe("classifyToolClass", () => {
  it("maps shell tools to command", () => {
    assert.equal(classifyToolClass(toolRequest("Bash", { command: "npm test" })), "command");
    assert.equal(classifyToolClass(toolRequest("CodexBash", { command: "ls -la" })), "command");
    assert.equal(classifyToolClass(toolRequest("bash", { command: "echo hi" })), "command");
  });

  it("maps destructive shell forms to command.destructive", () => {
    assert.equal(
      classifyToolClass(toolRequest("Bash", { command: "rm -rf /tmp/build" })),
      "command.destructive",
    );
    assert.equal(
      classifyToolClass(toolRequest("CodexBash", { command: "git push --force origin main" })),
      "command.destructive",
    );
    assert.equal(
      classifyToolClass(toolRequest("bash", { command: "psql -c 'DROP TABLE users;'" })),
      "command.destructive",
    );
    assert.equal(
      classifyToolClass(toolRequest("Bash", { command: "git clean -dfx" })),
      "command.destructive",
    );
    // rm with recursive + force, in either flag order / spelling.
    assert.equal(
      classifyToolClass(toolRequest("Bash", { command: "rm -fr /tmp/build" })),
      "command.destructive",
    );
    assert.equal(
      classifyToolClass(toolRequest("Bash", { command: "rm -Rf /tmp/build" })),
      "command.destructive",
    );
    assert.equal(
      classifyToolClass(toolRequest("Bash", { command: "rm -r -f /tmp/build" })),
      "command.destructive",
    );
    assert.equal(
      classifyToolClass(toolRequest("Bash", { command: "rm -f -r /tmp/build" })),
      "command.destructive",
    );
  });

  it("keeps a bare -f or -R rm as plain command", () => {
    assert.equal(
      classifyToolClass(toolRequest("Bash", { command: "rm -f /tmp/build" })),
      "command",
    );
    assert.equal(
      classifyToolClass(toolRequest("Bash", { command: "rm -R /tmp/build" })),
      "command",
    );
  });

  it("maps file tools to file", () => {
    assert.equal(classifyToolClass(toolRequest("Edit", { file_path: "/a" })), "file");
    assert.equal(classifyToolClass(toolRequest("Write", { file_path: "/b" })), "file");
    assert.equal(classifyToolClass(toolRequest("MultiEdit")), "file");
    assert.equal(classifyToolClass(toolRequest("CodexFileChange")), "file");
  });

  it("maps config tools to config", () => {
    assert.equal(classifyToolClass(toolRequest("Config", { key: "x" })), "config");
    assert.equal(classifyToolClass(toolRequest("ConfigEdit")), "config");
  });

  it("maps channel.tool.<name> to channel", () => {
    assert.equal(classifyToolClass(toolRequest("channel.tool.deploy")), "channel");
  });

  it("maps unknown tools to other (fail-closed)", () => {
    assert.equal(classifyToolClass(toolRequest("WebFetch", { url: "https://x" })), "other");
  });
});

// --- Principal resolution --------------------------------------------------------

describe("principal resolution", () => {
  it("resolves a mapped identity to its user", () => {
    assert.equal(resolvePrincipal("slack:U0ALICE", makePlane()), "long.luong");
  });

  it("keeps an unmapped identity as its own (anonymous) principal", () => {
    assert.equal(resolvePrincipal("slack:U0CAROL", makePlane()), "slack:U0CAROL");
  });
});

// --- Role algebra ---------------------------------------------------------------

describe("role algebra (extends + deny)", () => {
  it("grants approval.command but not approval.command.destructive to the operator role", () => {
    const plane = makePlane({
      identityOwners: { "slack:U0BOB": "minh.pham" },
      users: { "minh.pham": { name: "Minh", identities: ["slack:U0BOB"] } },
      assignments: [{ identities: ["slack:U0BOB"], roles: ["operator"] }],
    });
    const route = routeFor(plane, makeAccount());
    const privileges = effectivePrivileges("slack:U0BOB", [routeRoleScope(route)], plane);
    assert.ok(privileges.includes("approval.command"), "operator may approve commands");
    assert.ok(privileges.includes("approval.file"), "operator may approve files");
    assert.ok(
      privileges.includes("bot.interact"),
      "operator inherits user's bot.interact via extends",
    );
    assert.ok(
      !privileges.includes("approval.command.destructive"),
      "operator's deny subtracts destructive",
    );
  });

  it("lets the admin wildcard cover every catalog privilege", () => {
    const plane = makePlane(); // long.luong is admin via user: assignment
    const route = routeFor(plane, makeAccount());
    const privileges = effectivePrivileges("slack:U0ALICE", [routeRoleScope(route)], plane);
    for (const p of [
      "bot.interact",
      "approval.file",
      "approval.command",
      "approval.command.destructive",
      "approval.channel",
    ]) {
      assert.ok(privileges.includes(p), `admin covers ${p}`);
    }
  });

  it("is fail-closed for unknown role names in assignments and defaultRoles", () => {
    const plane = makePlane({
      assignments: [{ identities: ["user:long.luong"], roles: ["ghost"] }],
    });
    const account = makeAccount({ defaultRoles: [], assignments: [] });
    const route = routeFor(plane, account, { defaultRoles: ["nope"], routeAssignments: [] });
    assert.deepEqual(effectiveRoles("long.luong", [routeRoleScope(route)], plane), []);
    assert.deepEqual(effectivePrivileges("long.luong", [routeRoleScope(route)], plane), []);
  });

  it("treats an unmapped raw identity as its own principal", () => {
    const plane = makePlane({
      assignments: [{ identities: ["slack:U0CAROL"], roles: ["approver"] }],
    });
    const account = makeAccount({ defaultRoles: [] });
    const route = routeFor(plane, account, { defaultRoles: [], routeAssignments: [] });
    assert.deepEqual(effectiveRoles("slack:U0CAROL", [routeRoleScope(route)], plane), ["approver"]);
    // With defaultRoles in play, the anonymous principal inherits them too —
    // unions are additive, no exception for unmapped identities.
    const inherited = routeFor(plane, makeAccount());
    assert.deepEqual(
      [...effectiveRoles("slack:U0CAROL", [routeRoleScope(inherited)], plane)].sort(),
      ["approver", "user"],
    );
  });
});

describe("assignment value forms", () => {
  it("grants the same principal via user:<username> and via a mapped raw identity", () => {
    const userForm = makePlane({
      assignments: [{ identities: ["user:long.luong"], roles: ["operator"] }],
    });
    const rawForm = makePlane({
      assignments: [{ identities: ["slack:U0ALICE"], roles: ["operator"] }],
    });
    const viaUser = effectiveRoles(
      "long.luong",
      [
        routeRoleScope(
          routeFor(userForm, makeAccount({ defaultRoles: [] }), {
            defaultRoles: [],
            routeAssignments: [],
          }),
        ),
      ],
      userForm,
    );
    const viaRaw = effectiveRoles(
      "long.luong",
      [
        routeRoleScope(
          routeFor(rawForm, makeAccount({ defaultRoles: [] }), {
            defaultRoles: [],
            routeAssignments: [],
          }),
        ),
      ],
      rawForm,
    );
    assert.deepEqual(viaUser, ["operator"]);
    assert.deepEqual(viaRaw, ["operator"]);
  });
});

// --- Effective roles across layers ----------------------------------------------

describe("effective roles across precedence layers", () => {
  it("unions matching assignments additively across the org ⊕ account ⊕ route layers", () => {
    const plane = makePlane({
      assignments: [{ identities: ["user:long.luong"], roles: ["user"] }],
    });
    const roles = effectiveRoles(
      "long.luong",
      [
        { defaultRoles: [], assignments: plane.assignments },
        {
          defaultRoles: [],
          assignments: [{ identities: ["user:long.luong"], roles: ["approver"] }],
        },
        {
          defaultRoles: [],
          assignments: [{ identities: ["user:long.luong"], roles: ["operator"] }],
        },
      ],
      plane,
    );
    assert.deepEqual([...roles].sort(), ["approver", "operator", "user"]);
  });

  it("applies the inherited defaultRoles when no assignment covers the principal", () => {
    const plane = makePlane({ assignments: [] });
    assert.deepEqual(
      effectiveRoles("long.luong", [{ defaultRoles: ["user"], assignments: [] }], plane),
      ["user"],
    );
  });
});

// --- Route matching --------------------------------------------------------------

describe("route matching (first match wins)", () => {
  it("returns the first matching route in declaration order", () => {
    const plane = makePlane();
    const account = makeAccount({
      routes: [
        routeFor(plane, accountStub(), { match: { kind: "channel", ids: [] } }), // kind-level
        routeFor(plane, accountStub(), { match: { kind: "channel", ids: ["C0APP"] } }),
      ],
    });
    const result = matchRoute({ kind: "channel", id: "C0APP" }, account);
    assert.equal(result.route, account.routes[0], "the kind-level route declared first wins");
  });

  it("matches a specific channel id", () => {
    const plane = makePlane();
    const account = makeAccount({
      routes: [routeFor(plane, accountStub(), { match: { kind: "channel", ids: ["C0APP"] } })],
    });
    assert.ok(matchRoute({ kind: "channel", id: "C0APP" }, account).route !== null);
    assert.ok(matchRoute({ kind: "channel", id: "C0OTHER" }, account).route === null);
  });

  it("matches kind-level routes with empty ids (incl. DMs)", () => {
    const plane = makePlane();
    const account = makeAccount({
      routes: [routeFor(plane, accountStub(), { match: { kind: "dm", ids: [] } })],
    });
    assert.ok(matchRoute({ kind: "dm", id: "D1" }, account).route !== null);
    assert.ok(matchRoute({ kind: "channel", id: "C1" }, account).route === null);
  });

  it("falls back to the deny fallback when no route matches", () => {
    const plane = makePlane();
    const account = makeAccount({
      routes: [routeFor(plane, accountStub(), { match: { kind: "channel", ids: ["C0APP"] } })],
      fallback: { deny: true },
    });
    const result = matchRoute({ kind: "group", id: "G1" }, account);
    assert.equal(result.route, null);
    assert.equal(result.target, null);
    assert.equal(result.fallback.deny, true);
  });

  it("falls back to the catch-all route when fallback is not deny", () => {
    const catchAllTarget: CompiledRoute["target"] = {
      kind: "agent",
      agent: "assistant",
      environment: "lab",
      template: null,
    };
    const account = makeAccount({
      routes: [],
      fallback: {
        deny: false,
        target: catchAllTarget,
        defaultRoles: ["user"],
        assignments: [],
        approval: [],
      },
    });
    const result = matchRoute({ kind: "dm", id: "D9" }, account);
    assert.equal(result.route, null);
    assert.equal(result.target, catchAllTarget);
    assert.equal(result.fallback.deny, false);
  });

  // A bare account the route fixtures can reference without recursion.
  function accountStub(): CompiledChannelAccount {
    return {
      channel: "slack",
      accountId: "work",
      enabled: true,
      channelEnabled: true,
      connectionId: "connection",
      transport: { mode: "socket" },
      config: {},
      defaultRoles: ["user"],
      assignments: [],
      defaults: DEFAULTS,
      approval: [],
      routes: [],
      fallback: { deny: true },
    };
  }
});

// --- Approval rules --------------------------------------------------------------

describe("approval rules (first match, all modes)", () => {
  const plane = makePlane();
  const account = makeAccount();
  const base = (overrides: RouteOverrides = {}) => routeFor(plane, account, overrides);

  it("auto-allows when the first matching rule is auto-allow", () => {
    const route = base();
    assert.deepEqual(approvalDecisionFor("file", route), { mode: "auto-allow" });
    assert.deepEqual(approvalDecisionFor("command", route), {
      mode: "prompt",
      initiatorOnly: false,
    });
  });

  it("auto-denies when the first matching rule is auto-deny", () => {
    const route = base({
      approval: [
        { match: "command.destructive", mode: "auto-deny" },
        { match: "*", mode: "require" },
      ],
    });
    assert.deepEqual(approvalDecisionFor("command.destructive", route), { mode: "auto-deny" });
    assert.deepEqual(approvalDecisionFor("command", route), {
      mode: "prompt",
      initiatorOnly: false,
    });
  });

  it("prompts with initiatorOnly when the first matching rule requires it", () => {
    assert.deepEqual(approvalDecisionFor("command.destructive", base()), {
      mode: "prompt",
      initiatorOnly: true,
    });
  });

  it("defaults to prompt (fail-closed) when no rule matches", () => {
    const route = base({ approval: [{ match: "file", mode: "auto-allow" }] });
    assert.deepEqual(approvalDecisionFor("command", route), {
      mode: "prompt",
      initiatorOnly: false,
    });
  });

  it("treats a tool-class match and its privilege form as the same reference", () => {
    assert.ok(ruleMatchCoversToolClass("file", "file"));
    assert.ok(ruleMatchCoversToolClass("approval.file", "file"));
    assert.ok(!ruleMatchCoversToolClass("file", "command"));
  });

  it("applies wildcard semantics consistent with privilegeCovers", () => {
    assert.ok(ruleMatchCoversToolClass("*", "command"));
    assert.ok(ruleMatchCoversToolClass("approval.*", "command.destructive"));
    assert.ok(
      ruleMatchCoversToolClass("command", "command.destructive"),
      "dot-nesting: command covers destructive",
    );
    assert.ok(!ruleMatchCoversToolClass("command", "file"));
  });
});

describe("approval re-authorization (mayApprove)", () => {
  it("allows the initiator to answer an initiatorOnly destructive prompt", () => {
    const plane = makePlane(); // long.luong is admin via the route's org assignment
    const account = makeAccount();
    const route = routeFor(plane, account);
    const check = mayApprove(
      "slack:U0ALICE",
      "command.destructive",
      "slack:U0ALICE",
      plane,
      account,
      route,
    );
    assert.deepEqual(check, { allowed: true, reason: "ok" });
  });

  it("blocks a non-initiator from answering an initiatorOnly prompt", () => {
    const plane = makePlane({
      identityOwners: { "slack:U0BOB": "minh.pham" },
      users: { "minh.pham": { name: "Minh", identities: ["slack:U0BOB"] } },
      assignments: [
        { identities: ["user:long.luong"], roles: ["admin"] },
        { identities: ["slack:U0BOB"], roles: ["admin"] },
      ],
    });
    const account = makeAccount();
    const route = routeFor(plane, account);
    const check = mayApprove(
      "slack:U0BOB",
      "command.destructive",
      "slack:U0ALICE",
      plane,
      account,
      route,
    );
    assert.deepEqual(check, { allowed: false, reason: "not-initiator" });
  });

  it("blocks a responder whose role deny subtracts the class", () => {
    const plane = makePlane({
      identityOwners: { "slack:U0BOB": "minh.pham" },
      users: { "minh.pham": { name: "Minh", identities: ["slack:U0BOB"] } },
      assignments: [{ identities: ["slack:U0BOB"], roles: ["operator"] }], // deny: destructive
    });
    const account = makeAccount();
    const route = routeFor(plane, account);
    const check = mayApprove(
      "slack:U0BOB",
      "command.destructive",
      "slack:U0BOB",
      plane,
      account,
      route,
    );
    assert.deepEqual(check, { allowed: false, reason: "class-not-approved" });
  });

  it("allows the operator to approve a plain command (approval.command holds)", () => {
    const plane = makePlane({
      identityOwners: { "slack:U0BOB": "minh.pham" },
      users: { "minh.pham": { name: "Minh", identities: ["slack:U0BOB"] } },
      assignments: [{ identities: ["slack:U0BOB"], roles: ["operator"] }],
    });
    const account = makeAccount();
    const route = routeFor(plane, account);
    const check = mayApprove("slack:U0BOB", "command", "slack:U0BOB", plane, account, route);
    assert.deepEqual(check, { allowed: true, reason: "ok" });
  });

  it("auto-denies the class when the merged rule auto-denies it", () => {
    const plane = makePlane();
    const account = makeAccount();
    const route = routeFor(plane, account, { approval: [{ match: "command", mode: "auto-deny" }] });
    const check = mayApprove("slack:U0ALICE", "command", "slack:U0ALICE", plane, account, route);
    assert.deepEqual(check, { allowed: false, reason: "auto-denied" });
  });

  it("reports auto-allowed classes as needing no responder", () => {
    const plane = makePlane();
    const account = makeAccount();
    const route = routeFor(plane, account); // file => auto-allow
    const check = mayApprove("slack:U0ALICE", "file", "slack:U0ALICE", plane, account, route);
    assert.deepEqual(check, { allowed: true, reason: "auto-allowed" });
  });
});

// --- Trigger gate ----------------------------------------------------------------

describe("mayTrigger", () => {
  it("allows a sender whose effective privileges include bot.interact", () => {
    const plane = makePlane(); // long.luong is admin
    const account = makeAccount();
    assert.equal(mayTrigger("slack:U0ALICE", plane, account, routeFor(plane, account)), true);
  });

  it("denies a sender with no roles (deny-by-default)", () => {
    const plane = makePlane({ assignments: [], identityOwners: {} });
    const account = makeAccount({ defaultRoles: [] });
    const route = routeFor(plane, account, { defaultRoles: [] });
    assert.equal(mayTrigger("slack:U0CAROL", plane, account, route), false);
  });
});

// --- Kill switches ----------------------------------------------------------------

describe("kill switches", () => {
  const plane = makePlane();
  const account = makeAccount();

  it("is on when every level is on", () => {
    assert.equal(isEnabled(true, plane, account), true);
  });

  it("is off when the env flag is off", () => {
    assert.equal(isEnabled(false, plane, account), false);
  });

  it("is off when the org level is off", () => {
    assert.equal(isEnabled(true, makePlane({ enabled: false }), account), false);
  });

  it("is off when the per-channel level is off", () => {
    assert.equal(isEnabled(true, plane, makeAccount({ channelEnabled: false })), false);
  });

  it("is off when the per-account level is off", () => {
    assert.equal(isEnabled(true, plane, makeAccount({ enabled: false })), false);
  });
});

// --- Approval-required invariant ---------------------------------------------------

describe("approval-required posture (plan S10)", () => {
  const plane = makePlane();
  const account = makeAccount();

  it("is a hard, non-configurable constant", () => {
    assert.equal(CHANNEL_SESSION_POSTURE, "approval-required");
  });

  it("holds when at least one tool class is not auto-allowed", () => {
    const route = routeFor(plane, account); // file auto-allowed, the rest require
    assert.equal(postureIsApprovalRequired(route), true);
    assert.doesNotThrow(() => assertApprovalRequiredPosture(route));
  });

  it("is lifted (and asserted) when every tool class is auto-allowed", () => {
    const route = routeFor(plane, account, { approval: [{ match: "*", mode: "auto-allow" }] });
    assert.equal(postureIsApprovalRequired(route), false);
    assert.throws(() => assertApprovalRequiredPosture(route), /approval-required posture/u);
  });

  it("still holds when only one class is auto-allowed", () => {
    const route = routeFor(plane, account, {
      approval: [
        { match: "file", mode: "auto-allow" },
        { match: "*", mode: "require" },
      ],
    });
    assert.equal(postureIsApprovalRequired(route), true);
  });
});

// --- Fallback role scope -----------------------------------------------------------

describe("fallbackRoleScope", () => {
  it("concatenates org, account, and fallback assignments additively", () => {
    const plane = makePlane({
      assignments: [{ identities: ["user:long.luong"], roles: ["user"] }],
    });
    const account = makeAccount({
      assignments: [{ identities: ["slack:U0ALICE"], roles: ["approver"] }],
      fallback: {
        deny: false,
        target: { kind: "agent", agent: "a", environment: "e", template: null },
        defaultRoles: ["operator"],
        assignments: [{ identities: ["slack:U0ALICE"], roles: ["admin"] }],
        approval: [],
      },
    });
    const roles = effectiveRoles("long.luong", [fallbackRoleScope(plane, account)], plane);
    assert.deepEqual([...roles].sort(), ["admin", "approver", "operator", "user"]);
  });
});
