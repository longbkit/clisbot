// Tests for the channel control-plane source (plan S8, implementation doc §4.3):
// the single builder that turns the active project configuration into the
// control plane the ops handlers, the supervisor, and the plane all consume.
// The contract under test: org resolution is single-organization (P0), the
// snapshot carries the active revision's authored files + compiled control
// plane, and the agent-spec resolver maps route targets into the daemon's
// create fields — the mapping the plane's binding engine drives.

import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { createMemoryDatabase } from "../db/memory.js";
import { enrollTestDaemon } from "../test-utils/project-configuration.js";
import { ProjectConfigurationStore } from "../configuration/store.js";
import type { Database } from "../db/types.js";
import {
  ChannelAgentSpecError,
  ChannelControlPlaneError,
  createChannelAgentSpecResolver,
  loadChannelControlPlane,
  type ChannelControlPlaneSnapshot,
} from "./control-plane.js";

const HUB_YAML = `
environments:
  work:
    kind: daemon
    daemon: daemon-10000000
    cwd: /workspace/app
  mirror:
    kind: fly
    image: mirror
agents:
  codex-safe:
    provider: codex
    model: gpt-5.5
    options:
      sandbox_workspace_write:
        network_access: false
  claude:
    provider: claude
    mode: bypassPermissions
    thinkingOptionId: high
`;

const WORKFLOW_YAML = `
name: handoff
on: manual.run
max_runtime: 1h
steps:
  - id: work
    environment: work
    max_runtime: 30m
    idle_timeout: 5m
    agent:
      provider: codex
      model: gpt-5.5
    prompt:
      - text: "hand off"
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
secretRef: slack:work
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
  const project = await database.createProject({
    organizationId: ORG_ID,
    name: "Default",
    slug: "default",
    createdByUserId: "user-1",
  });
  const store = new ProjectConfigurationStore(database, project.id);
  const revision = await store.insertManualBundleRevision({
    files: [
      { path: ".paseo/hub.yml", content: HUB_YAML },
      { path: ".paseo/workflows/handoff.yml", content: WORKFLOW_YAML },
      { path: ".paseo/channels/policy.yml", content: POLICY_YAML },
      { path: ".paseo/channels/slack/work.yml", content: ACCOUNT_YAML },
    ],
    userId: null,
  });
  await store.activate(revision.id);
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
    assert.deepEqual(
      snapshot.resolveAgentSpec({
        kind: "agent",
        agent: "codex-safe",
        environment: "work",
        template: null,
      }),
      {
        provider: "codex",
        cwd: "/workspace/app",
        model: "gpt-5.5",
        providerOptions: {
          sandbox_workspace_write: { network_access: false },
        },
      },
    );
    assert.deepEqual(
      snapshot.resolveAgentSpec({
        kind: "agent",
        agent: "claude",
        environment: "work",
        template: null,
      }),
      {
        provider: "claude",
        cwd: "/workspace/app",
        modeId: "bypassPermissions",
        thinkingOptionId: "high",
      },
    );
  });

  it("resolves an agent no workflow references (the full named map, not just targets)", async () => {
    const snapshot = await withActiveConfiguration(memoryDatabase());
    // `claude` appears in no workflow step, so agentValidationTargets omits it;
    // a channel route targeting it must still resolve.
    const config = snapshot.resolveAgentSpec({
      kind: "agent",
      agent: "claude",
      environment: "work",
      template: null,
    });
    assert.equal(config.provider, "claude");
  });

  it("rejects an unknown agent and a non-daemon environment", async () => {
    const snapshot = await withActiveConfiguration(memoryDatabase());
    assert.throws(
      () =>
        snapshot.resolveAgentSpec({
          kind: "agent",
          agent: "ghost",
          environment: "work",
          template: null,
        }),
      ChannelAgentSpecError,
    );
    assert.throws(
      () =>
        snapshot.resolveAgentSpec({
          kind: "agent",
          agent: "codex-safe",
          environment: "mirror",
          template: null,
        }),
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

  it("fails closed when the default project is missing or has no active configuration", async () => {
    await assert.rejects(
      loadChannelControlPlane(memoryDatabase()),
      (error: unknown) =>
        error instanceof ChannelControlPlaneError && error.code === "project_not_found",
    );

    const database = memoryDatabase();
    await database.createProject({
      organizationId: ORG_ID,
      name: "Default",
      slug: "default",
      createdByUserId: "user-1",
    });
    await assert.rejects(
      loadChannelControlPlane(database),
      (error: unknown) =>
        error instanceof ChannelControlPlaneError && error.code === "no_active_configuration",
    );
  });
});

describe("createChannelAgentSpecResolver", () => {
  it("is importable standalone for the supervisor's plane construction", async () => {
    const snapshot = await withActiveConfiguration(memoryDatabase());
    const resolver = createChannelAgentSpecResolver(snapshot.bundle);
    assert.equal(
      resolver({ kind: "agent", agent: "codex-safe", environment: "work", template: null })
        .provider,
      "codex",
    );
  });
});
