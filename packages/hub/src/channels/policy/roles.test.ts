import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { ChannelControlPlane, CompiledRoute } from "../config/compile.js";
import { mayRunChannelCommand, resolveChannelActorRole, roleAtLeast } from "./roles.js";

const ALICE = "slack:U0ALICE";
const BOB = "slack:U0BOB";
const CAROL = "slack:U0CAROL";
const STRANGER = "slack:U0NOBODY";

function route(overrides: Partial<CompiledRoute> = {}): CompiledRoute {
  return {
    match: { kind: "channel", ids: [] },
    target: { kind: "agent", agent: "worker", environment: "repo", template: null },
    defaultRoles: [],
    assignments: [
      { identities: [ALICE], roles: ["approver"] },
      { identities: [BOB], roles: ["interactor"] },
      { identities: [CAROL], roles: ["root"] },
    ],
    defaults: {} as CompiledRoute["defaults"],
    approval: [],
    ...overrides,
  };
}

const CONTROL_PLANE = {
  roles: {
    interactor: { grants: ["bot.interact"], deny: [], extends: [], closure: ["interactor"] },
    approver: {
      grants: ["bot.interact", "approval.command"],
      deny: [],
      extends: [],
      closure: ["approver"],
    },
    root: { grants: ["*"], deny: [], extends: [], closure: ["root"] },
  },
  identityOwners: { [ALICE]: "alice", [BOB]: "bob", [CAROL]: "carol" },
} as unknown as ChannelControlPlane;

describe("actor role", () => {
  const resolve = (senderIdentity: string, initiator?: string) =>
    resolveChannelActorRole({
      senderIdentity,
      controlPlane: CONTROL_PLANE,
      route: route(),
      ...(initiator === undefined ? {} : { initiator }),
    });

  it("names the session's initiator owner, whatever their privileges", () => {
    assert.equal(resolve(BOB, BOB), "owner");
    assert.equal(resolve(STRANGER, STRANGER), "owner");
  });

  it("names an approver admin", () => {
    assert.equal(resolve(ALICE), "admin");
  });

  it("names a `*` grant owner", () => {
    assert.equal(resolve(CAROL), "owner");
  });

  it("names an interact-only linked identity member", () => {
    assert.equal(resolve(BOB), "member");
  });

  it("names an unconfigured sender guest", () => {
    assert.equal(resolve(STRANGER), "guest");
  });
});

describe("command authority", () => {
  it("lets anyone read help, and a member read status", () => {
    assert.equal(mayRunChannelCommand("help", "guest"), true);
    assert.equal(mayRunChannelCommand("status", "guest"), false);
    assert.equal(mayRunChannelCommand("status", "member"), true);
  });

  it("keeps /stop and /new to the session's owner or an admin", () => {
    assert.equal(mayRunChannelCommand("stop", "member"), false);
    assert.equal(mayRunChannelCommand("new", "member"), false);
    assert.equal(mayRunChannelCommand("stop", "admin"), true);
    assert.equal(mayRunChannelCommand("new", "owner"), true);
  });

  it("keeps /agent and /model to admins and above", () => {
    assert.equal(mayRunChannelCommand("model", "member"), false);
    assert.equal(mayRunChannelCommand("agent", "admin"), true);
    assert.equal(mayRunChannelCommand("model", "owner"), true);
  });

  it("refuses a verb with no entry in the table", () => {
    assert.equal(mayRunChannelCommand("deploy", "owner"), false);
  });

  it("orders the roles", () => {
    assert.equal(roleAtLeast("owner", "member"), true);
    assert.equal(roleAtLeast("guest", "member"), false);
  });
});
