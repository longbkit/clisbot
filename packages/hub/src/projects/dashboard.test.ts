import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { AuthServer } from "../auth/server.js";
import { createMemoryDatabase } from "../db/memory.js";
import { enrollTestDaemon, TEST_DAEMON_SLUG } from "../test-utils/project-configuration.js";
import { ProjectDashboard, type ManualConfigurationInput } from "./dashboard.js";

describe("project dashboard activity read models", () => {
  it("uses canonical Linear health in project and organization snapshots", async () => {
    const database = createMemoryDatabase({
      memberships: [
        {
          userId: "user-1",
          organizationId: "org-1",
          organizationName: "Acme",
          organizationSlug: "acme",
          membershipId: "membership-1",
          role: "owner",
        },
      ],
    });
    await database.createProject({
      organizationId: "org-1",
      name: "Hub",
      slug: "hub",
      createdByUserId: "user-1",
    });
    database.organizationConnectionUsage = () =>
      Promise.resolve({
        github: [],
        discord: [],
        slack: [],
        linear: [
          {
            id: "expired",
            organizationId: "org-1",
            slug: "expired",
            providerApplicationId: "linear-client",
            linearOrganizationId: "linear-expired",
            linearOrganizationName: "Expired",
            appUserId: "linear-app-user",
            accessToken: "expired-token",
            refreshToken: null,
            accessTokenExpiresAt: new Date("2000-01-01T00:00:00.000Z"),
            scopes: ["read", "comments:create"],
          },
          {
            id: "refreshable",
            organizationId: "org-1",
            slug: "refreshable",
            providerApplicationId: "linear-client",
            linearOrganizationId: "linear-refreshable",
            linearOrganizationName: "Refreshable",
            appUserId: "linear-app-user",
            accessToken: "expired-token",
            refreshToken: "refresh-token",
            accessTokenExpiresAt: new Date("2000-01-01T00:00:00.000Z"),
            scopes: ["read", "comments:create"],
          },
        ],
      });

    const dashboard = new ProjectDashboard(database, accountAuth(), undefined);
    const request = new Request("https://hub.test/o/acme/projects/hub");
    const [organization, project] = await Promise.all([
      dashboard.organizationSnapshot(request, { organizationSlug: "acme" }),
      dashboard.projectSnapshot(request, {
        organizationSlug: "acme",
        projectSlug: "hub",
      }),
    ]);

    for (const snapshot of [organization, project]) {
      assert.deepEqual(
        snapshot.connections.linear.map((connection) => ({
          id: connection.id,
          requiresReauthorization: connection.requiresReauthorization,
        })),
        [
          { id: "expired", requiresReauthorization: true },
          { id: "refreshable", requiresReauthorization: false },
        ],
      );
    }
  });

  it("omits payload-bearing evidence from lists and retains it in detail", async () => {
    const database = createMemoryDatabase({
      memberships: [
        {
          userId: "user-1",
          organizationId: "org-1",
          organizationName: "Acme",
          organizationSlug: "acme",
          membershipId: "membership-1",
          role: "owner",
        },
      ],
    });
    const project = await database.createProject({
      organizationId: "org-1",
      name: "Hub",
      slug: "hub",
      createdByUserId: "user-1",
    });
    const revision = await database.insertProjectConfigurationRevision({
      projectId: project.id,
      sourceKind: "manual",
      sourceEvidence: { kind: "test" },
      normalizedConfiguration: { environments: [], triggers: [] },
      contentHash: "dashboard-read-model",
    });
    await database.activateProjectConfigurationRevision(project.id, revision.id, []);
    const rawPayload = { body: "payload-".repeat(20_000) };
    const triggerContext = { provider: "manual", body: "trigger-".repeat(20_000) };
    const receipt = await database.persistManualEvent({
      organizationId: "org-1",
      projectId: project.id,
      deliveryId: "dashboard-large-payload",
      source: "manual.dashboard",
      payload: rawPayload,
      receivedAt: new Date("2026-08-06T12:00:00.000Z"),
    });
    if (receipt.status !== "accepted") throw new Error("dashboard receipt was not accepted");
    const run = await database.createAcceptedTriggerRun({
      organizationId: "org-1",
      projectId: project.id,
      configurationRevisionId: revision.id,
      providerEventReceiptId: receipt.event.providerEventReceiptId,
      configuredTriggerName: "dashboard-run",
      prompt: "run",
      inputs: {},
      triggerContext,
      outputContext: {},
      deadlineAt: new Date("2026-08-06T13:00:00.000Z"),
      stepIds: ["step"],
    });
    const unroutedPayload = { body: "unrouted-".repeat(20_000) };
    const unroutedReceipt = await database.persistManualEvent({
      organizationId: "org-1",
      projectId: project.id,
      deliveryId: "dashboard-unrouted-large-payload",
      source: "manual.dashboard",
      payload: unroutedPayload,
      receivedAt: new Date("2026-08-06T12:01:00.000Z"),
    });
    if (unroutedReceipt.status !== "accepted") throw new Error("unrouted receipt was not accepted");
    await database.markProviderEventDropped(
      unroutedReceipt.event.providerEventReceiptId,
      "trigger_filters_rejected",
    );
    const dashboard = new ProjectDashboard(database, accountAuth(), undefined);
    const request = new Request("https://hub.test/o/acme/projects/hub");
    const list = await dashboard.projectSnapshot(request, {
      organizationSlug: "acme",
      projectSlug: "hub",
    });
    assert.equal("rawPayload" in list.activity[0]!, false);
    assert.equal("triggerContext" in list.activity[0]!, false);

    const detail = await dashboard.activityRunSnapshot(request, {
      organizationSlug: "acme",
      projectSlug: "hub",
      runId: run.run.id,
    });
    assert.deepEqual(detail.activity.rawPayload, rawPayload);
    assert.deepEqual(detail.activity.triggerContext, triggerContext);

    const organization = await dashboard.organizationSnapshot(request, {
      organizationSlug: "acme",
    });
    const unroutedEvent = organization.unroutedEvents[0];
    assert.ok(unroutedEvent);
    assert.equal(unroutedEvent.deliveryId, "dashboard-unrouted-large-payload");
    assert.equal(unroutedEvent.status, "dropped");
    assert.equal(unroutedEvent.providerEventReceiptId, unroutedEvent.id);
    assert.equal(
      unroutedEvent.failureReason,
      "The event did not pass the configured trigger filters.",
    );
    assert.equal(JSON.stringify(unroutedEvent).includes("unrouted-unrouted"), false);
    assert.equal("rawPayload" in unroutedEvent, false);
  });
});

describe("manual configuration saves", () => {
  const hubYaml = [
    "environments:",
    "  runner:",
    "    kind: daemon",
    `    daemon: ${TEST_DAEMON_SLUG}`,
    "    cwd: /repo",
    "agents: {}",
    "",
  ].join("\n");
  const workflowYaml = [
    "name: triage",
    "on: manual.run",
    "max_runtime: 1h",
    "steps:",
    "  - id: only",
    "    environment: runner",
    "    max_runtime: 10m",
    "    idle_timeout: 1m",
    "    agent: { provider: claude }",
    "    prompt:",
    "      - include: partials/triage/preamble.md",
    "",
  ].join("\n");
  const files = () => [
    { path: ".paseo/hub.yml", content: hubYaml },
    { path: ".paseo/workflows/triage.yml", content: workflowYaml },
    {
      path: ".paseo/workflows/partials/triage/preamble.md",
      content: "Triage first.",
    },
  ];

  it("activates the YAML and its partials as one revision the editor reopens", async () => {
    const hub = await manualConfigurationHub();

    const saved = await hub.save({ files: files() });

    assert.equal(saved.outcome, "activated");
    const active = (await hub.snapshot()).configuration.activeRevision;
    assert.equal(active?.version, saved.revision.version);
    assert.deepEqual(
      active?.files,
      files().toSorted((left, right) => left.path.localeCompare(right.path)),
    );
  });

  it("rejects an include with no partial supplied and preserves the active revision", async () => {
    const hub = await manualConfigurationHub();
    const activated = await hub.save({ files: files() });

    const rejected = await hub.save({ files: files().slice(0, 2) });

    assert.equal(rejected.outcome, "invalid");
    assert.match(String(rejected.errors), /missing from the bundle/u);
    assert.equal(
      (await hub.snapshot()).configuration.activeRevision?.version,
      activated.revision.version,
    );
  });

  it("rejects an unreferenced shared partial and preserves the active revision", async () => {
    const hub = await manualConfigurationHub();
    const activated = await hub.save({ files: files() });

    const extra = {
      path: ".paseo/workflows/partials/unused.md",
      content: "Available for future workflows.",
    };
    const saved = await hub.save({ files: [...files(), extra] });

    assert.equal(saved.outcome, "invalid");
    assert.match(String(saved.errors), /not referenced/iu);
    assert.equal(
      (await hub.snapshot()).configuration.activeRevision?.version,
      activated.revision.version,
    );
  });

  it("records invalid YAML as a revision without activating it", async () => {
    const hub = await manualConfigurationHub();

    const rejected = await hub.save({
      files: [{ path: ".paseo/hub.yml", content: "environments: [" }],
    });

    assert.equal(rejected.outcome, "invalid");
    assert.equal((await hub.snapshot()).configuration.activeRevision, null);
  });

  it("shows malformed expressions against the authored workflow field", async () => {
    const hub = await manualConfigurationHub();
    const malformed = files().map((file) =>
      file.path === ".paseo/workflows/triage.yml"
        ? Object.assign({}, file, {
            content: file.content.replace(
              "agent: { provider: claude }",
              "agent: ${{ paseo.inputs.agent + }}",
            ),
          })
        : file,
    );

    const rejected = await hub.save({ files: malformed });

    assert.equal(rejected.outcome, "invalid");
    assert.match(String(rejected.errors), /\.paseo\/workflows\/triage\.yml\.steps\.only\.agent/iu);
  });
});

async function manualConfigurationHub() {
  const database = createMemoryDatabase({
    memberships: [
      {
        userId: "user-1",
        organizationId: "org-1",
        organizationName: "Acme",
        organizationSlug: "acme",
        membershipId: "membership-1",
        role: "owner",
      },
    ],
  });
  await enrollTestDaemon(database, "org-1");
  await database.createProject({
    organizationId: "org-1",
    name: "Hub",
    slug: "hub",
    createdByUserId: "user-1",
  });
  const dashboard = new ProjectDashboard(database, accountAuth(), undefined);
  const request = new Request("https://hub.test/o/acme/projects/hub");
  const scope = { organizationSlug: "acme", projectSlug: "hub" };
  return {
    save: (input: ManualConfigurationInput) =>
      dashboard.saveManualConfiguration(request, scope, input),
    snapshot: () => dashboard.projectSnapshot(request, scope),
  };
}

function accountAuth(): AuthServer {
  return {
    handle: () => Promise.resolve(new Response()),
    resources: () => Promise.reject(new Error("unused")),
    resolveOrganizationAccess: () => Promise.reject(new Error("unused")),
    resolveAccount: () =>
      Promise.resolve({
        session: { id: "session-1", activeOrganizationId: "org-1" },
        account: { id: "user-1", name: "User", email: "user@example.test" },
        isInstanceOperator: false,
      }),
    rejectCookieMutation: () => undefined,
    close: () => Promise.resolve(),
  };
}
