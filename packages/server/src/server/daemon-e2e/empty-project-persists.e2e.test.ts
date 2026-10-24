import { execSync } from "node:child_process";
import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";

import { DaemonClient } from "../test-utils/daemon-client.js";
import { createTestClisbotDaemon, type TestClisbotDaemon } from "../test-utils/clisbot-daemon.js";
import { type PersistedProjectRecord } from "../workspace-registry.js";

const cleanupPaths = new Set<string>();
const cleanupDaemons = new Set<TestClisbotDaemon>();
const cleanupClients = new Set<DaemonClient>();

function restoreEnv(name: string, previous: string | undefined): void {
  if (previous === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = previous;
}

afterEach(async () => {
  await Promise.all(Array.from(cleanupClients, (client) => client.close().catch(() => undefined)));
  cleanupClients.clear();
  await Promise.all(Array.from(cleanupDaemons, (daemon) => daemon.close().catch(() => undefined)));
  cleanupDaemons.clear();
  await Promise.all(
    Array.from(cleanupPaths, (target) => rm(target, { recursive: true, force: true })),
  );
  cleanupPaths.clear();
});

test("project.add creates a project without creating a workspace", async () => {
  const previousSupervised = process.env.CLISBOT_SUPERVISED;
  process.env.CLISBOT_SUPERVISED = "0";
  try {
    const repoRoot = realpathSync(mkdtempSync(path.join(os.tmpdir(), "clisbot-add-project-repo-")));
    const clisbotHomeRoot = realpathSync(
      mkdtempSync(path.join(os.tmpdir(), "clisbot-add-project-home-")),
    );
    cleanupPaths.add(repoRoot);
    cleanupPaths.add(clisbotHomeRoot);

    execSync("git init -b main", { cwd: repoRoot, stdio: "pipe" });
    execSync("git config user.email 'test@clisbot.dev'", { cwd: repoRoot, stdio: "pipe" });
    execSync("git config user.name 'Clisbot Test'", { cwd: repoRoot, stdio: "pipe" });
    writeFileSync(path.join(repoRoot, "README.md"), "# repo\n", "utf8");
    execSync("git add README.md", { cwd: repoRoot, stdio: "pipe" });
    execSync("git -c commit.gpgSign=false commit -m 'initial'", { cwd: repoRoot, stdio: "pipe" });

    const daemon = await createTestClisbotDaemon({ clisbotHomeRoot, cleanup: false });
    cleanupDaemons.add(daemon);
    const client = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws` });
    cleanupClients.add(client);
    await client.connect();

    const added = await client.addProject(repoRoot);

    expect(added.error).toBeNull();
    expect(added.project).not.toBeNull();
    const project = added.project!;
    expect(project).toMatchObject({
      projectRootPath: repoRoot,
      projectKind: "git",
    });
    expect(project.projectId).toMatch(/^prj_[0-9a-f]{16}$/);

    const workspaces = await client.fetchWorkspaces({
      filter: { projectId: project.projectId },
    });
    expect(workspaces.entries).toEqual([]);
    expect(workspaces.emptyProjects).toEqual([
      expect.objectContaining({
        projectRootPath: repoRoot,
        projectKind: "git",
      }),
    ]);
  } finally {
    restoreEnv("CLISBOT_SUPERVISED", previousSupervised);
  }
}, 30_000);

test("archiving the last workspace leaves the project parent with no workspaces", async () => {
  const previousSupervised = process.env.CLISBOT_SUPERVISED;
  process.env.CLISBOT_SUPERVISED = "0";
  try {
    const repoRoot = realpathSync(
      mkdtempSync(path.join(os.tmpdir(), "clisbot-empty-project-repo-")),
    );
    const clisbotHomeRoot = realpathSync(
      mkdtempSync(path.join(os.tmpdir(), "clisbot-empty-project-home-")),
    );
    cleanupPaths.add(repoRoot);
    cleanupPaths.add(clisbotHomeRoot);

    execSync("git init -b main", { cwd: repoRoot, stdio: "pipe" });
    execSync("git config user.email 'test@clisbot.dev'", { cwd: repoRoot, stdio: "pipe" });
    execSync("git config user.name 'Clisbot Test'", { cwd: repoRoot, stdio: "pipe" });
    writeFileSync(path.join(repoRoot, "README.md"), "# repo\n", "utf8");
    execSync("git add README.md", { cwd: repoRoot, stdio: "pipe" });
    execSync("git -c commit.gpgSign=false commit -m 'initial'", { cwd: repoRoot, stdio: "pipe" });

    const clisbotHome = path.join(clisbotHomeRoot, ".clisbot");
    const projectsPath = path.join(clisbotHome, "projects", "projects.json");

    const daemon = await createTestClisbotDaemon({ clisbotHomeRoot, cleanup: false });
    cleanupDaemons.add(daemon);
    const client = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws` });
    cleanupClients.add(client);
    await client.connect();
    await client.fetchAgents({ subscribe: {} });

    const created = await client.createWorkspace({ source: { kind: "directory", path: repoRoot } });
    expect(created.error).toBeNull();
    expect(created.workspace).not.toBeNull();
    const workspaceId = created.workspace!.id;
    const projectId = created.workspace!.projectId;

    const beforeArchive = await client.fetchWorkspaces();
    expect(beforeArchive.entries.map((entry) => entry.id)).toContain(workspaceId);
    expect(beforeArchive.emptyProjects.map((project) => project.projectId)).not.toContain(
      projectId,
    );

    const archiveResponse = await client.archiveWorkspace(workspaceId);
    expect(archiveResponse.error).toBeNull();
    expect(archiveResponse.archivedAt).not.toBeNull();

    const afterArchive = await client.fetchWorkspaces();
    expect(afterArchive.entries.map((entry) => entry.id)).not.toContain(workspaceId);
    expect(afterArchive.emptyProjects.map((project) => project.projectId)).toContain(projectId);

    const persistedProjects = JSON.parse(
      await readFile(projectsPath, "utf8"),
    ) as PersistedProjectRecord[];
    expect(
      persistedProjects.find((project) => project.projectId === projectId)?.archivedAt,
    ).toBeNull();
  } finally {
    restoreEnv("CLISBOT_SUPERVISED", previousSupervised);
  }
}, 30_000);
