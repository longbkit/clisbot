import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";
import { AccessPolicyError } from "../../access/store.js";
import { createMemoryDatabase } from "../../db/memory.js";
import type { Database } from "../../db/types.js";
import { enrollTestDaemon } from "../../test-utils/project-configuration.js";
import { loadChannelControlPlane } from "../control-plane.js";
import { createRouteDefaultPublisher, type RouteDefaultTarget } from "./publish.js";

const ORG = "org-1";

const HUB = `
environments:
  lab:
    kind: daemon
    daemon: daemon-10000000
    cwd: /lab
agents:
  assistant:
    provider: codex
    model: gpt-5.6-luna
`;

const POLICY = 'defaults:\n  approval:\n    - { match: "*", mode: require }\n';

function account(requireMention: boolean): string {
  return `
channel: slack
accountId: support
connectionId: slack-support
transport: { mode: socket, errorPolicy: once }
routes:
  - match: { kind: channel, ids: [C1], contains: deploy }
    agent: assistant
    environment: lab
    interaction: { requireMention: ${requireMention} }
fallback: { deny: true }
`;
}

const OPUS = { provider: "claude", model: "claude-opus-5", thinkingOptionId: "high" };

async function publishConfiguration(database: Database, requireMention = true): Promise<void> {
  await database.saveChannelConfiguration({
    organizationId: ORG,
    files: [
      { path: ".paseo/hub.yml", content: HUB },
      { path: ".paseo/channels/policy.yml", content: POLICY },
      { path: ".paseo/channels/slack/support.yml", content: account(requireMention) },
    ],
    contentHash: `configuration-${requireMention}`,
    createdByUserId: null,
  });
}

async function setup(authorize = vi.fn(async () => undefined)) {
  const database = createMemoryDatabase({
    memberships: [
      {
        userId: "user-1",
        organizationId: ORG,
        organizationName: "Org",
        organizationSlug: "org",
        membershipId: "member-1",
        role: "owner",
      },
    ],
  });
  await enrollTestDaemon(database, ORG);
  await publishConfiguration(database);
  const apply = vi.fn();
  const publisher = createRouteDefaultPublisher({ database, authorize, apply });
  const serving = async (): Promise<RouteDefaultTarget> => {
    const snapshot = await loadChannelControlPlane(database, ORG);
    return {
      organizationId: ORG,
      channel: "slack",
      accountId: "support",
      position: 0,
      route: snapshot.controlPlane.accounts[0]!.routes[0]!,
      principal: { membershipId: "member-1", userId: "user-1" },
    };
  };
  return { database, publisher, serving, apply };
}

describe("createRouteDefaultPublisher", () => {
  it("publishes the default as a revision attributed to the Member", async () => {
    const { database, publisher, serving } = await setup();
    const outcome = await publisher.promote(await serving(), OPUS);
    assert.deepEqual(outcome, { status: "published", agentControls: OPUS });
    const active = await database.findActiveChannelConfiguration(ORG);
    assert.equal(active?.createdByUserId, "user-1");
    const snapshot = await loadChannelControlPlane(database, ORG);
    assert.deepEqual(snapshot.controlPlane.accounts[0]!.routes[0]!.defaults.agentControls, OPUS);
  });

  it("refuses a Route that changed since the conversation's plane compiled it", async () => {
    const { database, publisher, serving } = await setup();
    const stale = await serving();
    await publishConfiguration(database, false);
    assert.deepEqual(await publisher.promote(stale, OPUS), { status: "route_changed" });
  });

  it("does not treat an earlier default change as the Route changing", async () => {
    const { publisher, serving } = await setup();
    const target = await serving();
    await publisher.promote(target, { provider: "claude", model: "claude-sonnet-5" });
    assert.equal((await publisher.promote(target, OPUS)).status, "published");
  });

  it("undoes the Route default's last change", async () => {
    const { database, publisher, serving } = await setup();
    assert.deepEqual(await publisher.undo(await serving()), { status: "nothing_to_undo" });
    await publisher.promote(await serving(), OPUS);
    assert.deepEqual(await publisher.undo(await serving()), {
      status: "published",
      agentControls: undefined,
    });
    const snapshot = await loadChannelControlPlane(database, ORG);
    assert.equal("agentControls" in snapshot.controlPlane.accounts[0]!.routes[0]!.defaults, false);
  });

  it("reports a default the Member could not start themselves", async () => {
    const authorize = vi.fn(async () => {
      throw new AccessPolicyError("access_denied", "Access denied");
    });
    const { database, publisher, serving } = await setup(authorize);
    assert.deepEqual(await publisher.promote(await serving(), OPUS), {
      status: "outside_access",
    });
    const snapshot = await loadChannelControlPlane(database, ORG);
    assert.equal("agentControls" in snapshot.controlPlane.accounts[0]!.routes[0]!.defaults, false);
  });
});
