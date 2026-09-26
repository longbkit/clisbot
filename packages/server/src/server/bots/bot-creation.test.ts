import { lstat, mkdir, mkdtemp, readdir, readlink, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestLogger } from "../../test-utils/test-logger.js";
import { createNoopWorkspaceGitService } from "../test-utils/workspace-git-service-stub.js";
import { createWorkspaceProvisioningService } from "../session/workspace-provisioning/workspace-provisioning-service.js";
import { FileBackedProjectRegistry, FileBackedWorkspaceRegistry } from "../workspace-registry.js";
import { createBotService, type BotService } from "./index.js";

// Real registries, a real temp home, and the real provisioning service behind a git stub:
// the create sequence is proven the way `bootstrap.ts` wires it.
const logger = createTestLogger();
const OWNER = { kind: "user" as const, id: "owner" };

let home: string;
let root: string;
let projectRegistry: FileBackedProjectRegistry;
let workspaceRegistry: FileBackedWorkspaceRegistry;
let archived: string[];
let service: BotService;

async function isDirectory(target: string): Promise<boolean> {
  return (await stat(target).catch(() => null))?.isDirectory() ?? false;
}

beforeEach(async () => {
  home = await mkdtemp(path.join(tmpdir(), "bot-service-"));
  root = path.join(home, "workspaces");
  archived = [];
  projectRegistry = new FileBackedProjectRegistry(
    path.join(home, "projects", "projects.json"),
    logger,
  );
  workspaceRegistry = new FileBackedWorkspaceRegistry(
    path.join(home, "projects", "workspaces.json"),
    logger,
  );
  await projectRegistry.initialize();
  await workspaceRegistry.initialize();
  const provisioning = createWorkspaceProvisioningService({
    projectRegistry,
    workspaceRegistry,
    workspaceGitService: createNoopWorkspaceGitService(),
    isDirectory,
    logger,
  });
  service = createBotService({
    paseoHome: home,
    root,
    logger,
    projectRegistry,
    workspaceRegistry,
    findOrCreateProjectForDirectory: (cwd) => provisioning.findOrCreateProjectForDirectory(cwd),
    createWorkspaceForDirectory: (cwd, title, projectId) =>
      provisioning.createWorkspaceForDirectory(cwd, title, projectId),
    emitWorkspaceUpdates: async () => undefined,
    archiveWorkspace: async (workspaceId) => {
      archived.push(workspaceId);
      await workspaceRegistry.archive(workspaceId, new Date().toISOString());
    },
    isProviderAvailable: (provider) => provider === "codex" || provider === "claude",
  });
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

describe("createBotService", () => {
  it("creates the directory, its own Project and workspace, seeds the persona, and records the bot", async () => {
    const result = await service.create(
      { name: "Ops Bot", launch: { provider: "claude", model: "sonnet" } },
      { owner: OWNER },
    );
    const { bot } = result;
    expect(result.reused).toBe(false);
    expect(bot).toMatchObject({
      slug: "ops-bot",
      name: "Ops Bot",
      kind: "personal",
      cwd: path.join(root, "ops-bot"),
      launch: { provider: "claude", model: "sonnet" },
      owner: OWNER,
      archivedAt: null,
    });
    expect(bot.template?.id).toBe("personal-assistant");
    expect(result.template.created).toHaveLength(10);
    expect(await readlink(path.join(bot.cwd, "CLAUDE.md"))).toBe("AGENTS.md");

    const project = await projectRegistry.get(bot.projectId);
    expect(project).toMatchObject({ rootPath: bot.cwd, customName: "Ops Bot" });
    expect(await workspaceRegistry.get(bot.workspaceId)).toMatchObject({
      cwd: bot.cwd,
      kind: "directory",
      projectId: bot.projectId,
    });
    expect(await readdir(path.join(home, "bots"))).toEqual([`${bot.id}.json`]);
    expect(await service.list()).toHaveLength(1);
  });

  it("is idempotent on an existing slug and on an explicit home, re-seeding only missing files", async () => {
    const first = await service.create(
      { name: "Ops Bot", launch: { provider: "codex" } },
      { owner: OWNER },
    );
    await rm(path.join(first.bot.cwd, "TOOLS.md"));
    const bySlug = await service.create(
      { name: "ops bot", kind: "team", launch: { provider: "codex" } },
      { owner: OWNER },
    );
    expect(bySlug.reused).toBe(true);
    expect(bySlug.bot.id).toBe(first.bot.id);
    expect(bySlug.bot.kind).toBe("personal");
    expect(bySlug.template.created).toEqual(["TOOLS.md"]);

    const byPath = await service.create(
      { name: "Anything", path: first.bot.cwd, launch: { provider: "codex" } },
      { owner: OWNER },
    );
    expect(byPath).toMatchObject({ reused: true, bot: { id: first.bot.id } });
    expect(await service.list()).toHaveLength(1);
  });

  it("checks management access before reusing or seeding an existing bot", async () => {
    const { bot } = await service.create(
      { name: "Private", launch: { provider: "codex" } },
      { owner: OWNER },
    );
    await rm(path.join(bot.cwd, "TOOLS.md"));
    for (const extra of [{}, { path: bot.cwd }]) {
      await expect(
        service.create(
          { name: "Private", launch: { provider: "codex" }, ...extra },
          { owner: { kind: "user", id: "other" }, mayReuse: () => false },
        ),
      ).rejects.toMatchObject({ code: "access_denied" });
    }
    await expect(lstat(path.join(bot.cwd, "TOOLS.md"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await service.list()).toHaveLength(1);
  });

  it("does not allow the bots root to become a bot Project", async () => {
    await expect(
      service.create({ name: "Root", path: root, launch: { provider: "codex" } }, { owner: OWNER }),
    ).rejects.toMatchObject({ code: "inside_project" });
    expect(await projectRegistry.list()).toEqual([]);
  });

  it("refuses an unknown provider, an empty name, and a home inside a Project", async () => {
    await expect(
      service.create({ name: "x", launch: { provider: "nope" } }, { owner: OWNER }),
    ).rejects.toMatchObject({ code: "provider_unavailable" });
    await expect(
      service.create({ name: "  ", launch: { provider: "codex" } }, { owner: OWNER }),
    ).rejects.toMatchObject({ code: "invalid_request" });

    const repo = path.join(home, "repo");
    await mkdir(repo);
    await projectRegistry.getOrCreateActiveByRoot({
      rootPath: repo,
      kind: "non_git",
      displayName: "repo",
      timestamp: new Date().toISOString(),
    });
    await expect(
      service.create(
        { name: "Nested", path: path.join(repo, "bot"), launch: { provider: "codex" } },
        { owner: OWNER },
      ),
    ).rejects.toMatchObject({ code: "inside_project" });
    await expect(lstat(path.join(repo, "bot"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("asks a restricted session's rule for the home and rolls back nothing on refusal", async () => {
    await expect(
      service.create(
        { name: "Denied", launch: { provider: "codex" } },
        { owner: OWNER, mayCreateAt: async () => false },
      ),
    ).rejects.toMatchObject({ code: "access_denied" });
    expect(await projectRegistry.list()).toEqual([]);
    await expect(lstat(path.join(root, "denied"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("update renames the bot and its Project but never the slug; archive keeps the directory", async () => {
    const { bot } = await service.create(
      { name: "Ops Bot", launch: { provider: "codex" } },
      { owner: OWNER },
    );
    const updated = await service.update(bot.id, { name: "Operations", title: "Ops" });
    expect(updated).toMatchObject({ slug: "ops-bot", name: "Operations", title: "Ops" });
    expect(await projectRegistry.get(bot.projectId)).toMatchObject({ customName: "Operations" });

    const archivedBot = await service.archive(bot.id);
    expect(archivedBot.archivedAt).not.toBeNull();
    expect(archived).toEqual([bot.workspaceId]);
    expect(await isDirectory(bot.cwd)).toBe(true);
    expect(await service.list()).toEqual([]);
    expect(await service.list(true)).toHaveLength(1);
    await expect(service.update(bot.id, { name: "x" })).rejects.toMatchObject({
      code: "bot_archived",
    });

    // The archived slug stays taken: a new bot with the same name gets a suffix.
    const again = await service.create(
      { name: "Ops Bot", launch: { provider: "codex" } },
      { owner: OWNER },
    );
    expect(again.bot.slug).toBe("ops-bot-2");
  });
});
