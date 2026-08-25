import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { parseCompiledHubConfig } from "../config/compiler.js";
import {
  hashPromptPartialContent,
  type PromptPartialReadResult,
} from "../config/prompt-partials.js";
import { createMemoryDatabase } from "../db/memory.js";
import {
  createActiveProjectConfiguration,
  enrollTestDaemon,
  TEST_DAEMON_SLUG,
} from "../test-utils/project-configuration.js";
import {
  synchronizeGitHubDefaultBranch,
  synchronizeGitHubProjectConfiguration,
  type GitHubConfigurationProvider,
} from "./github-sync.js";

const INITIAL = {
  environments: [{ name: "runner", kind: "daemon", daemon: TEST_DAEMON_SLUG, cwd: "/repo" }],
  triggers: [],
};

function bundle(partial = "Safety instructions") {
  return {
    ".paseo/hub.yml": [
      "environments:",
      "  runner:",
      "    kind: daemon",
      `    daemon: ${TEST_DAEMON_SLUG}`,
      "    cwd: /repo",
      "agents: {}",
    ].join("\n"),
    ".paseo/workflows/request.yml": [
      "name: request",
      "on: manual.run",
      "max_runtime: 1h",
      "steps:",
      "  - id: work",
      "    environment: runner",
      "    max_runtime: 10m",
      "    idle_timeout: 1m",
      "    agent: { provider: codex }",
      "    prompt:",
      "      - include: partials/safety.md",
      "      - text: 'Request: ${{ paseo.prompt }}'",
    ].join("\n"),
    ".paseo/workflows/partials/safety.md": partial,
  };
}

describe("exact-commit GitHub configuration bundle sync", () => {
  it("discovers, compiles, and stores the complete bundle at one commit", async () => {
    const database = createMemoryDatabase();
    const { project } = await createActiveProjectConfiguration(database, INITIAL);
    await enrollTestDaemon(database);
    const client = new GitHubBundleFake({ sha: bundle() });

    const result = await sync(database, client, project.id, "sha");
    assert.equal(result.outcome, "activated");
    if (result.outcome !== "activated") return;
    const compiled = parseCompiledHubConfig(result.revision.normalizedConfiguration);
    assert.equal(compiled.triggers[0]?.sourceFile, ".paseo/workflows/request.yml");
    assert.deepEqual(compiled.triggers[0]?.steps[0]?.prompt[0], {
      kind: "partial",
      path: ".paseo/workflows/partials/safety.md",
      content: "Safety instructions",
      contentHash: hashPromptPartialContent("Safety instructions"),
    });
    assert.deepEqual(
      client.lists.map(({ commitSha, prefix }) => ({ commitSha, prefix })),
      [{ commitSha: "sha", prefix: ".paseo" }],
    );
    assert.deepEqual(
      client.reads.map(({ path }) => path),
      Object.keys(bundle()).sort(),
    );
  });

  it("preserves the active revision when a later bundle is invalid", async () => {
    const database = createMemoryDatabase();
    const { project, revision: initial } = await createActiveProjectConfiguration(
      database,
      INITIAL,
    );
    await enrollTestDaemon(database);
    const invalid = {
      ...bundle(),
      ".paseo/hub.yml": `${bundle()[".paseo/hub.yml"]}\ntriggers: []`,
    };
    const client = new GitHubBundleFake({ valid: bundle(), invalid });

    const valid = await sync(database, client, project.id, "valid");
    assert.equal(valid.outcome, "activated");
    const active = await database.findActiveProjectConfiguration(project.id);
    assert.notEqual(active?.id, initial.id);
    const rejected = await sync(database, client, project.id, "invalid");
    assert.equal(rejected.outcome, "invalid");
    assert.equal((await database.findActiveProjectConfiguration(project.id))?.id, active?.id);
    assert.match(
      JSON.stringify(rejected.outcome === "invalid" ? rejected.revision.validationErrors : null),
      /monolithic triggers/iu,
    );
  });

  it("creates a distinct deterministic revision when only partial content changes", async () => {
    const database = createMemoryDatabase();
    const { project } = await createActiveProjectConfiguration(database, INITIAL);
    await enrollTestDaemon(database);
    const client = new GitHubBundleFake({ one: bundle("First"), two: bundle("Second") });
    const first = await sync(database, client, project.id, "one");
    const second = await sync(database, client, project.id, "two");
    assert.equal(first.outcome, "activated");
    assert.equal(second.outcome, "activated");
    if (first.outcome !== "activated" || second.outcome !== "activated") return;
    assert.notEqual(first.revision.contentHash, second.revision.contentHash);
    assert.match(JSON.stringify(second.revision.sourceEvidence), /Second/u);
  });

  it("rejects a symlink entry without reading through it", async () => {
    const database = createMemoryDatabase();
    const { project, revision } = await createActiveProjectConfiguration(database, INITIAL);
    await enrollTestDaemon(database);
    const client = new GitHubBundleFake(
      { sha: bundle() },
      {
        sha: { ".paseo/workflows/partials/safety.md": "symlink" },
      },
    );
    const result = await sync(database, client, project.id, "sha");
    assert.equal(result.outcome, "invalid");
    assert.equal((await database.findActiveProjectConfiguration(project.id))?.id, revision.id);
    assert.equal(client.reads.length, 0);
  });

  it("records listing failures and superseded push commits without moving the pointer", async () => {
    const database = createMemoryDatabase();
    const { project, revision } = await createActiveProjectConfiguration(database, INITIAL);
    await database.setProjectGitHubConfigurationSource({
      projectId: project.id,
      githubConnectionId: "github-connection-1",
      githubRepositoryId: 9001,
      githubRepositoryFullName: "acme/repo",
      githubDefaultBranch: "main",
      automaticDeploymentEnabled: true,
      userId: "test-user",
    });
    const failing = new GitHubBundleFake({}, {}, new Error("GitHub unavailable"));
    assert.deepEqual(await sync(database, failing, project.id, "missing"), {
      outcome: "fetch_failed",
    });
    const client = new GitHubBundleFake({ head: bundle() });
    client.head = "head";
    database.findGitHubConfigurationTarget = () =>
      Promise.resolve({
        id: "repository-1",
        organizationId: project.organizationId,
        projectId: project.id,
        connectionId: "github-connection-1",
        installationId: 42,
        repositoryId: 9001,
        fullName: "acme/repo",
        defaultBranch: "main",
        automaticDeploymentEnabled: true,
      });
    assert.deepEqual(
      await synchronizeGitHubDefaultBranch({
        database,
        client,
        projectId: project.id,
        expectedCommitSha: "old",
        webhookDeliveryId: "delivery-old",
      }),
      { outcome: "superseded" },
    );
    assert.equal((await database.findActiveProjectConfiguration(project.id))?.id, revision.id);
  });
});

class GitHubBundleFake implements GitHubConfigurationProvider {
  readonly lists: Array<{ commitSha: string; prefix: string }> = [];
  readonly reads: Array<{ commitSha: string; path: string }> = [];
  head = "";
  constructor(
    private readonly commits: Readonly<Record<string, Readonly<Record<string, string>>>>,
    private readonly kinds: Readonly<
      Record<string, Readonly<Record<string, PromptPartialReadResult["kind"]>>>
    > = {},
    private readonly listError?: Error,
  ) {}
  listInstallationRepositories() {
    return Promise.resolve([]);
  }
  readDefaultBranchHead() {
    return Promise.resolve(this.head);
  }
  listFilesAtCommit(input: { commitSha: string; prefix: string }) {
    this.lists.push(input);
    if (this.listError !== undefined) return Promise.reject(this.listError);
    const commit = this.commits[input.commitSha] ?? {};
    return Promise.resolve(
      Object.keys(commit).map((path) => ({
        path,
        kind: this.kinds[input.commitSha]?.[path] ?? ("file" as const),
      })),
    );
  }
  readFileAtCommit(input: { commitSha: string; path: string }) {
    this.reads.push(input);
    const content = this.commits[input.commitSha]?.[input.path];
    return Promise.resolve(content === undefined ? undefined : { kind: "file" as const, content });
  }
}

function sync(
  database: ReturnType<typeof createMemoryDatabase>,
  client: GitHubConfigurationProvider,
  projectId: string,
  commitSha: string,
) {
  return synchronizeGitHubProjectConfiguration({
    database,
    client,
    projectId,
    githubConnectionId: "github-connection-1",
    githubRepositoryId: 9001,
    githubRepositoryFullName: "acme/repo",
    githubDefaultBranch: "main",
    installationId: 42,
    repositoryId: 9001,
    commitSha,
    webhookDeliveryId: `delivery-${commitSha}`,
  });
}
