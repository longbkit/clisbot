import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { compileHubBundle, type HubBundleFile } from "../config/bundle.js";
import { createMemoryDatabase } from "../db/memory.js";
import type { Database, ProjectRecord } from "../db/types.js";
import { migrateLegacyProjectTriggers } from "./migration.js";

const hub = `
environments:
  runner: { kind: daemon, daemon: devbox, cwd: /workspace }
agents:
  codex: { provider: codex, model: gpt-5.6-sol }
`;

describe("startup project trigger migration", () => {
  it("migrates mixed projects once and preserves the legacy execution lane across restart", async () => {
    const database = createMemoryDatabase({
      organizationIds: ["org"],
      slackConnections: [
        slackConnection("slack-a", "team-a"),
        slackConnection("slack-b", "team-b"),
      ],
    });
    await activeProject(
      database,
      "support",
      [
        workflow("slack", "slack.mention", oneStep("slack.reply")),
        workflow("route", "manual.run", twoSteps()),
      ],
      [
        { provider: "slack", connectionId: "slack-a", resourceId: null, triggerName: "slack" },
        { provider: "slack", connectionId: "slack-b", resourceId: null, triggerName: "slack" },
      ],
    );

    assert.deepEqual(await migrateLegacyProjectTriggers(database), {
      projects: 1,
      triggers: 2,
      legacyMultistepTriggers: 1,
    });
    const first = await database.listOrganizationTriggers("org");
    assert.deepEqual(
      first.map(({ name, format }) => ({ name, format })),
      [
        { name: "route", format: "legacy_multistep" },
        { name: "slack", format: "single_run" },
      ],
    );
    const legacy = first.find(({ format }) => format === "legacy_multistep")!;
    const revision = await database.findOrganizationTriggerRevision(
      legacy.id,
      legacy.activeRevisionId,
    );
    assert.match(revision?.yaml ?? "", /legacy_multistep:/u);
    for (const teamId of ["team-a", "team-b"]) {
      const accepted = await database.acceptSlackEvent({
        teamId,
        deliveryId: `delivery-${teamId}`,
        source: "slack.mention",
        payload: {},
        receivedAt: new Date(0),
      });
      assert.equal(accepted.status, "accepted");
    }
    assert.deepEqual(await migrateLegacyProjectTriggers(database), {
      projects: 0,
      triggers: 0,
      legacyMultistepTriggers: 0,
    });
    assert.equal((await database.listOrganizationTriggers("org")).length, 2);
  });

  it("deterministically disambiguates duplicate trigger names when projects collapse", async () => {
    const database = createMemoryDatabase({ organizationIds: ["org"] });
    await activeProject(database, "hub", [workflow("request", "manual.run", oneStep())]);
    await activeProject(database, "paseo", [workflow("request", "manual.run", oneStep())]);

    await migrateLegacyProjectTriggers(database);
    assert.deepEqual(
      (await database.listOrganizationTriggers("org")).map(({ name }) => name).sort(),
      ["paseo-request", "request"],
    );
  });

  it("does not mark a project migrated when source evidence is missing", async () => {
    const database = createMemoryDatabase({ organizationIds: ["org"] });
    const project = await database.createProject({
      organizationId: "org",
      name: "Broken",
      slug: "broken",
      createdByUserId: null,
    });
    const revision = await database.insertProjectConfigurationRevision({
      projectId: project.id,
      sourceKind: "manual",
      sourceEvidence: { kind: "manual" },
      normalizedConfiguration: { environments: [], triggers: [] },
      contentHash: "broken",
    });
    await database.activateProjectConfigurationRevision(project.id, revision.id);

    await assert.rejects(migrateLegacyProjectTriggers(database), /has no authored bundle/u);
    assert.equal((await database.listPendingProjectTriggerMigrations()).length, 1);
    assert.equal((await database.listOrganizationTriggers("org")).length, 0);
  });

  it("keeps the old project active when a persisted route cannot be assigned", async () => {
    const database = createMemoryDatabase({ organizationIds: ["org"] });
    await activeProject(
      database,
      "mismatched-route",
      [workflow("expected", "slack.mention", oneStep())],
      [
        {
          provider: "slack",
          connectionId: "slack-a",
          resourceId: null,
          triggerName: "missing-workflow",
        },
      ],
    );

    await assert.rejects(
      migrateLegacyProjectTriggers(database),
      /project trigger routes do not match migrated triggers/u,
    );
    assert.equal((await database.listPendingProjectTriggerMigrations()).length, 1);
    assert.equal((await database.listOrganizationTriggers("org")).length, 0);
  });

  it("does not partially mutate the in-memory store when any candidate is invalid", async () => {
    const database = createMemoryDatabase({ organizationIds: ["org"] });
    const project = await activeProject(database, "atomic", [
      workflow("valid", "manual.run", oneStep()),
    ]);
    const pending = (await database.listPendingProjectTriggerMigrations())[0]!;
    const candidate = {
      name: "valid",
      format: "single_run" as const,
      enabled: true,
      yaml: "name: valid",
      normalizedConfiguration: pending.revision.normalizedConfiguration,
      contentHash: "valid",
      sourceEvidence: { legacyProjectId: project.id },
    };

    await assert.rejects(
      database.migrateProjectTriggers({
        projectId: project.id,
        organizationId: "org",
        configurationRevisionId: pending.revision.id,
        projectSlug: project.slug,
        triggers: [
          candidate,
          // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- verifies atomicity for invalid persisted data.
          { ...candidate, name: "bad", format: "bad" as "single_run" },
        ],
      }),
    );
    assert.equal((await database.listOrganizationTriggers("org")).length, 0);
    assert.equal((await database.listPendingProjectTriggerMigrations()).length, 1);
  });
});

async function activeProject(
  database: Database,
  slug: string,
  workflows: readonly HubBundleFile[],
  routes: readonly import("../db/types.js").ProjectTriggerRoute[] = [],
): Promise<ProjectRecord> {
  const project = await database.createProject({
    organizationId: "org",
    name: slug,
    slug,
    createdByUserId: null,
  });
  const files = [{ path: ".paseo/hub.yml", content: hub }, ...workflows];
  const bundle = compileHubBundle(files);
  const revision = await database.insertProjectConfigurationRevision({
    projectId: project.id,
    sourceKind: "manual",
    sourceEvidence: {
      kind: "manual",
      bundle: { authoredHash: bundle.authoredHash, files: bundle.files },
    },
    normalizedConfiguration: bundle.configuration,
    contentHash: bundle.authoredHash,
  });
  await database.activateProjectConfigurationRevision(project.id, revision.id, routes);
  return project;
}

function slackConnection(id: string, teamId: string) {
  return {
    id,
    organizationId: "org",
    slug: id,
    teamId,
    teamName: teamId,
    botUserId: "bot",
    botAccessToken: "test-token",
    scopes: [],
    providerApplicationId: null,
  };
}

function workflow(name: string, event: string, body: string): HubBundleFile {
  const filters = event === "slack.mention" ? "filters: { from_users: [U123] }\n" : "";
  return {
    path: `.paseo/workflows/${name}.yml`,
    content: `name: ${name}\non: ${event}\nmax_runtime: 2h\n${filters}${body}`,
  };
}

function oneStep(output?: string): string {
  return `steps:
  - id: work
    environment: runner
    max_runtime: 1h
    idle_timeout: 10m
    agent: codex
    prompt: [{ text: work }]
${output === undefined ? "" : `    allow_outputs: [{ type: ${output}, max: 1 }]\n`}`;
}

function twoSteps(): string {
  return `steps:
  - id: classify
    environment: runner
    max_runtime: 5m
    idle_timeout: 1m
    agent: codex
    prompt: [{ text: classify }]
  - id: work
    environment: runner
    max_runtime: 1h
    idle_timeout: 10m
    agent: codex
    prompt: [{ text: work }]
`;
}
