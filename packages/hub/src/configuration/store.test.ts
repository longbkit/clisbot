import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { dump } from "js-yaml";
import { compiledConfigurationHash, parseCompiledHubConfig } from "../config/compiler.js";
import { ProjectConfigurationStore, revisionBundleFiles } from "./store.js";
import { createMemoryDatabase } from "../db/memory.js";
import { enrollTestDaemon, TEST_DAEMON_SLUG } from "../test-utils/project-configuration.js";
import type { DiscordConnectionRecord, LinearConnectionRecord } from "../db/types.js";
import { configurationBundleFixture } from "../test-utils/configuration-bundle.js";

const primary: DiscordConnectionRecord = {
  id: "00000000-0000-4000-8000-000000000001",
  organizationId: "org_1",
  guildId: "100",
  slug: "discord-primary",
  guildName: "Primary guild",
  providerApplicationId: "discord-app",
};

const secondary: DiscordConnectionRecord = {
  ...primary,
  id: "00000000-0000-4000-8000-000000000002",
  guildId: "200",
  slug: "discord-secondary",
  guildName: "Secondary guild",
};

const linear: LinearConnectionRecord = {
  id: "00000000-0000-4000-8000-000000000003",
  organizationId: "org_1",
  slug: "acme-linear",
  providerApplicationId: "linear-app",
  linearOrganizationId: "linear-org-1",
  linearOrganizationName: "Acme",
  appUserId: "app-user-1",
  accessToken: "token",
  refreshToken: "refresh-token",
  accessTokenExpiresAt: null,
  scopes: ["read", "comments:create"],
};

describe("ProjectConfigurationStore resource compilation", () => {
  it("preserves provider options in immutable revision evidence", async () => {
    const database = createMemoryDatabase();
    await enrollTestDaemon(database);
    const project = await database.createProject({
      organizationId: "org_1",
      name: "Provider options project",
      slug: "provider-options-project",
      createdByUserId: "user-1",
    });
    const store = new ProjectConfigurationStore(database, project.id);
    const options = {
      sandbox_workspace_write: {
        writable_roots: ["/var/cache/npm"],
        network_access: false,
      },
    };
    const rawConfiguration = {
      environments: [{ name: "runner", kind: "daemon", daemon: TEST_DAEMON_SLUG, cwd: "/repo" }],
      triggers: [
        {
          name: "run",
          on: "manual.run",
          max_runtime: "1h",
          steps: [
            {
              id: "work",
              environment: "runner",
              max_runtime: "10m",
              idle_timeout: "1m",
              agent: { provider: "codex", options },
              prompt: [{ text: "Run" }],
            },
          ],
        },
      ],
    };
    const authoredFiles = configurationBundleFixture(dump(rawConfiguration));
    const revision = await store.insertManualBundleRevision({
      files: authoredFiles,
      userId: "user-1",
      sourceEvidence: { kind: "manual", authoredBy: "user-1" },
    });
    const active = await store.activate(revision.id);

    assert.deepEqual(revisionBundleFiles(revision), authoredFiles);
    const activeAgent = active.configuration.triggers[0]?.steps[0]?.agent;
    const storedAgent = parseCompiledHubConfig(revision.normalizedConfiguration).triggers[0]
      ?.steps[0]?.agent;
    assert.ok(activeAgent !== undefined && !("selector" in activeAgent));
    assert.ok(storedAgent !== undefined && !("selector" in storedAgent));
    if (
      activeAgent === undefined ||
      "selector" in activeAgent ||
      storedAgent === undefined ||
      "selector" in storedAgent
    )
      return;
    assert.deepEqual(activeAgent.options, options);
    assert.deepEqual(storedAgent.options, options);
  });

  it("accepts guild and scopes an authored resource to an optional connection slug", async () => {
    const database = createMemoryDatabase();
    await enrollTestDaemon(database);
    const connections = [primary, secondary];
    database.organizationConnectionUsage = () =>
      Promise.resolve({ github: [], slack: [], discord: connections, linear: [] });
    const project = await database.createProject({
      organizationId: "org_1",
      name: "Guild project",
      slug: "guild-project",
      createdByUserId: "user-1",
    });
    const store = new ProjectConfigurationStore(database, project.id);

    const revision = await store.insertManualBundleRevision({
      files: configurationBundleFixture(
        dump(
          discordConfiguration({
            guild: "discord-primary",
            connection: "discord-primary",
          }),
        ),
      ),
      userId: "user-1",
    });
    assert.equal(
      revision.contentHash,
      compiledConfigurationHash(parseCompiledHubConfig(revision.normalizedConfiguration)),
    );
    const active = await store.activate(revision.id);

    assert.equal(revision.validationErrors, null);
    assert.equal(active.configuration.triggers[0]?.filters?.guild, "100");
    assert.equal(active.configuration.triggers[0]?.filters?.connectionId, primary.id);
    assert.deepEqual(active.configuration.triggers[0]?.filters?.resourceId, "100");
    assert.equal(Object.isFrozen(active.configuration.triggers[0]?.filters), true);

    const switched = await store.switchToManual("user-1");
    assert.equal(
      switched.revision.contentHash,
      compiledConfigurationHash(parseCompiledHubConfig(switched.revision.normalizedConfiguration)),
    );
  });

  it("routes a project-scoped autonomous Linear scout through one Linear connection", async () => {
    const database = createMemoryDatabase();
    await enrollTestDaemon(database);
    database.organizationConnectionUsage = () =>
      Promise.resolve({ github: [], slack: [], discord: [], linear: [linear] });
    database.findLinearConnection = async (linearOrganizationId) =>
      linearOrganizationId === linear.linearOrganizationId ? linear : undefined;
    const project = await database.createProject({
      organizationId: "org_1",
      name: "Linear scout project",
      slug: "linear-scout-project",
      createdByUserId: "user-1",
    });
    const store = new ProjectConfigurationStore(database, project.id);
    const revision = await store.insertManualBundleRevision({
      files: configurationBundleFixture(
        dump({
          environments: [
            { name: "runner", kind: "daemon", daemon: TEST_DAEMON_SLUG, cwd: "/repo" },
          ],
          triggers: [
            {
              name: "scout",
              on: "linear.issue_entered_scope",
              max_runtime: "1h",
              filters: {
                connection: "acme-linear",
                project: "linear-project-1",
                states: ["ready"],
              },
              steps: [
                {
                  id: "assess",
                  environment: "runner",
                  max_runtime: "30m",
                  idle_timeout: "5m",
                  agent: { provider: "codex" },
                  prompt: [{ text: "Assess the issue" }],
                },
              ],
            },
          ],
        }),
      ),
      userId: "user-1",
    });
    const active = await store.activate(revision.id);
    assert.equal(active.configuration.triggers[0]?.filters?.connectionId, linear.id);
    assert.equal(active.configuration.triggers[0]?.filters?.resourceId, "linear-project-1");

    const accepted = await database.acceptLinearEvent({
      linearOrganizationId: linear.linearOrganizationId,
      projectId: "linear-project-1",
      deliveryId: "linear-scout-entry",
      source: "linear.issue",
      payload: {},
      receivedAt: new Date(0),
    });
    assert.equal(accepted.status, "accepted");
    if (accepted.status === "accepted") assert.equal(accepted.events[0]?.projectId, project.id);

    database.findLinearConnection = async (linearOrganizationId) =>
      linearOrganizationId === linear.linearOrganizationId
        ? { ...linear, scopes: ["read"] }
        : undefined;
    const underScoped = await database.acceptLinearEvent({
      linearOrganizationId: linear.linearOrganizationId,
      projectId: "linear-project-1",
      deliveryId: "linear-scout-under-scoped",
      source: "linear.issue",
      payload: {},
      receivedAt: new Date(1),
    });
    assert.equal(underScoped.status, "dropped");
    if (underScoped.status === "dropped") {
      assert.equal(underScoped.reason, "configuration_unavailable");
    }

    database.findLinearConnection = async (linearOrganizationId) =>
      linearOrganizationId === linear.linearOrganizationId
        ? {
            ...linear,
            scopes: ["read", "comments:create"],
            refreshToken: null,
            accessTokenExpiresAt: new Date(0),
          }
        : undefined;
    const expired = await database.acceptLinearEvent({
      linearOrganizationId: linear.linearOrganizationId,
      projectId: "linear-project-1",
      deliveryId: "linear-scout-expired",
      source: "linear.issue",
      payload: {},
      receivedAt: new Date(120_000),
    });
    assert.equal(expired.status, "dropped");
    if (expired.status === "dropped") {
      assert.equal(expired.reason, "configuration_unavailable");
    }
  });

  it("keeps authored prompt partials when switching a GitHub-managed configuration to manual", async () => {
    const database = createMemoryDatabase();
    await enrollTestDaemon(database);
    const project = await database.createProject({
      organizationId: "org_1",
      name: "GitHub partials project",
      slug: "github-partials-project",
      createdByUserId: "user-1",
    });
    const store = new ProjectConfigurationStore(database, project.id);
    const rawConfiguration = includeConfiguration();
    const files = [
      ...configurationBundleFixture(dump(rawConfiguration)),
      { path: ".paseo/workflows/partials/triage.md", content: PARTIAL_CONTENT },
    ];
    const revision = await store.insertGitHubBundleRevision({
      files,
      githubConnectionId: "github-connection-1",
      githubRepositoryId: 9001,
      githubRepositoryFullName: "acme/repo",
      githubDefaultBranch: "main",
      commitSha: "sha-with-partials",
      webhookDeliveryId: null,
    });
    await store.activate(revision.id);

    const switched = await store.switchToManual("user-1");

    assert.deepEqual(
      revisionBundleFiles(switched.revision),
      files.toSorted((a, b) => a.path.localeCompare(b.path)),
    );
  });

  it("resolves a Discord connection slug without an additional connection filter", async () => {
    const database = createMemoryDatabase();
    await enrollTestDaemon(database);
    database.organizationConnectionUsage = () =>
      Promise.resolve({ github: [], slack: [], discord: [primary, secondary], linear: [] });
    const project = await database.createProject({
      organizationId: "org_1",
      name: "Unique guild project",
      slug: "unique-guild-project",
      createdByUserId: "user-1",
    });
    const store = new ProjectConfigurationStore(database, project.id);

    const revision = await store.insertManualBundleRevision({
      files: configurationBundleFixture(dump(discordConfiguration({ guild: "discord-primary" }))),
      userId: "user-1",
    });
    const active = await store.activate(revision.id);

    assert.equal(active.configuration.triggers[0]?.filters?.connectionId, primary.id);
  });

  it("rejects an unknown explicit connection slug", async () => {
    const database = createMemoryDatabase();
    await enrollTestDaemon(database);
    database.organizationConnectionUsage = () =>
      Promise.resolve({ github: [], slack: [], discord: [primary], linear: [] });
    const project = await database.createProject({
      organizationId: "org_1",
      name: "Unknown connection project",
      slug: "unknown-connection-project",
      createdByUserId: "user-1",
    });
    const store = new ProjectConfigurationStore(database, project.id);
    const revision = await store.insertManualBundleRevision({
      files: configurationBundleFixture(
        dump(discordConfiguration({ guild: "discord-primary", connection: "missing-discord" })),
      ),
      userId: "user-1",
    });

    assert.deepEqual(revision.validationErrors, {
      formErrors: [],
      issues: [
        {
          path: [".paseo/workflows/discord-mention.yml", "filters", "connection"],
          message:
            '"missing-discord" does not match any Discord connection (connected: discord-primary "Primary guild")',
        },
      ],
    });
  });

  it("reports an unknown Discord slug with the connected guild candidates", async () => {
    const database = createMemoryDatabase();
    await enrollTestDaemon(database);
    database.organizationConnectionUsage = () =>
      Promise.resolve({ github: [], slack: [], discord: [primary], linear: [] });
    const project = await database.createProject({
      organizationId: "org_1",
      name: "Unknown guild project",
      slug: "unknown-guild-project",
      createdByUserId: "user-1",
    });
    const store = new ProjectConfigurationStore(database, project.id);
    const revision = await store.insertManualBundleRevision({
      files: configurationBundleFixture(
        dump(discordConfiguration({ guild: "1481169421832814616" })),
      ),
      userId: "user-1",
    });

    assert.deepEqual(revision.validationErrors, {
      formErrors: [],
      issues: [
        {
          path: [".paseo/workflows/discord-mention.yml", "filters", "guild"],
          message:
            '"1481169421832814616" does not match any Discord connection (connected: discord-primary "Primary guild")',
        },
      ],
    });
  });

  it("records a missing daemon as an invalid revision instead of dereferencing it", async () => {
    const database = createMemoryDatabase();
    const project = await database.createProject({
      organizationId: "org_1",
      name: "Missing daemon project",
      slug: "missing-daemon-project",
      createdByUserId: "user-1",
    });
    const store = new ProjectConfigurationStore(database, project.id);

    const revision = await store.insertManualBundleRevision({
      files: configurationBundleFixture(
        dump({
          environments: [
            {
              name: "runner",
              kind: "daemon",
              daemon: "missing-daemon",
              cwd: "/workspace",
            },
          ],
          triggers: [
            {
              ...discordConfiguration({}).triggers[0],
              name: "manual-run",
              on: "manual.run",
              filters: undefined,
            },
          ],
        }),
      ),
      userId: "user-1",
    });

    assert.deepEqual(revision.validationErrors, {
      formErrors: [],
      issues: [
        {
          path: [".paseo/hub.yml", "environments", "runner", "daemon"],
          message: '"missing-daemon" does not match any daemon (connected: none)',
        },
      ],
    });
    assert.equal(
      revision.contentHash,
      compiledConfigurationHash(parseCompiledHubConfig(revision.normalizedConfiguration)),
    );
  });

  it("accepts one durable trigger per project when multiple routes match", async () => {
    const database = createMemoryDatabase();
    await enrollTestDaemon(database);
    database.organizationConnectionUsage = () =>
      Promise.resolve({ github: [], slack: [], discord: [primary], linear: [] });
    database.findDiscordConnection = () => Promise.resolve(primary);
    database.findDiscordConnectionForOrganization = async (_organizationId, guildId) =>
      guildId === primary.guildId ? primary : undefined;
    const project = await database.createProject({
      organizationId: "org_1",
      name: "Fan-out project",
      slug: "fan-out-project",
      createdByUserId: "user-1",
    });
    const store = new ProjectConfigurationStore(database, project.id);
    const configuration = discordConfiguration({ guild: "discord-primary" });
    configuration.triggers.push({
      ...configuration.triggers[0]!,
      name: "discord-mention-secondary",
    });
    const revision = await store.insertManualBundleRevision({
      files: configurationBundleFixture(dump(configuration)),
      userId: "user-1",
    });
    await store.activate(revision.id);

    const accepted = await database.acceptDiscordEvent({
      guildId: "100",
      deliveryId: "discord-fan-out",
      source: "discord.mention",
      payload: {},
      receivedAt: new Date(0),
    });

    assert.equal(accepted.status, "accepted");
    if (accepted.status !== "accepted") return;
    assert.equal(accepted.events.length, 1);
  });

  it("restores the target revision's trigger routes during rollback", async () => {
    const database = createMemoryDatabase();
    await enrollTestDaemon(database);
    database.organizationConnectionUsage = () =>
      Promise.resolve({ github: [], slack: [], discord: [primary], linear: [] });
    database.findDiscordConnection = () => Promise.resolve(primary);
    database.findDiscordConnectionForOrganization = async (_organizationId, guildId) =>
      guildId === primary.guildId ? primary : undefined;
    const project = await database.createProject({
      organizationId: "org_1",
      name: "Rollback routes project",
      slug: "rollback-routes-project",
      createdByUserId: "user-1",
    });
    const store = new ProjectConfigurationStore(database, project.id);
    const first = await store.insertManualBundleRevision({
      files: configurationBundleFixture(dump(discordConfiguration({ guild: "discord-primary" }))),
      userId: "user-1",
    });
    await store.activate(first.id);
    const secondConfiguration = discordConfiguration({ guild: "discord-primary" });
    secondConfiguration.triggers[0]!.name = "second-discord-mention";
    const second = await store.insertManualBundleRevision({
      files: configurationBundleFixture(dump(secondConfiguration)),
      userId: "user-1",
    });
    await store.activate(second.id);

    const rolledBack = await store.rollback();
    assert.equal(rolledBack.revision.id, first.id);
    const accepted = await database.acceptDiscordEvent({
      guildId: "100",
      deliveryId: "discord-rollback-routes",
      source: "discord.mention",
      payload: {},
      receivedAt: new Date(0),
    });

    assert.equal(accepted.status, "accepted");
    if (accepted.status !== "accepted") return;
    assert.equal(accepted.events[0]?.projectId, project.id);
    assert.equal(accepted.events[0]?.source, "discord.mention");
  });
});

function discordConfiguration(filters: Record<string, string>) {
  return {
    environments: [{ name: "runner", kind: "daemon", daemon: TEST_DAEMON_SLUG, cwd: "/repo" }],
    triggers: [
      {
        name: "discord-mention",
        on: "discord.mention",
        max_runtime: "1h",
        filters: { ...filters, from_users: ["user-1"] },
        steps: [
          {
            id: "run",
            environment: "runner",
            max_runtime: "30m",
            idle_timeout: "5m",
            agent: { provider: "test", mode: "default" },
            prompt: [{ text: "Handle the mention" }],
          },
        ],
      },
    ],
  };
}

const PARTIAL_CONTENT = "Triage the request before labeling it.";

function includeConfiguration() {
  return {
    environments: [{ name: "runner", kind: "daemon", daemon: TEST_DAEMON_SLUG, cwd: "/repo" }],
    triggers: [
      {
        name: "triage",
        on: "manual.run",
        max_runtime: "1h",
        steps: [
          {
            id: "work",
            environment: "runner",
            max_runtime: "10m",
            idle_timeout: "1m",
            agent: { provider: "test", mode: "default" },
            prompt: [{ include: "partials/triage.md" }],
          },
        ],
      },
    ],
  };
}
