import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { access } from "node:fs/promises";
import { watch } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { SkillSelection, SkillTargets } from "./operations";
import type { SkillSelectionStore } from "./selection-store";
import { createSkillsController, type SkillsController } from "./controller";
import { beginSkillsTransaction } from "./transaction";

interface Harness {
  root: string;
  targets: SkillTargets;
  controller: SkillsController;
  selectionStore: SkillSelectionStore;
}

const BUNDLED_SKILLS = ["clisbot", "clisbot-advisor", "clisbot-loop"];

async function makeHarness(selectionStore?: SkillSelectionStore): Promise<Harness> {
  const root = await mkdtemp(path.join(os.tmpdir(), "clisbot-skills-controller-"));
  const targets: SkillTargets = {
    sourceDir: path.join(root, "bundle"),
    agentsDir: path.join(root, "home", ".agents", "skills"),
    claudeDir: path.join(root, "home", ".claude", "skills"),
    codexDir: path.join(root, "home", ".codex", "skills"),
  };
  for (const name of BUNDLED_SKILLS) {
    await mkdir(path.join(targets.sourceDir, name), { recursive: true });
    await writeFile(path.join(targets.sourceDir, name, "SKILL.md"), `${name}-v1`);
  }
  let selection: SkillSelection = { mode: "all" };
  const store =
    selectionStore ??
    ({
      get: async () => selection,
      set: async (next: unknown) => {
        selection = next as SkillSelection;
        return selection;
      },
      isSet: async () => true,
    } satisfies SkillSelectionStore);
  return {
    root,
    targets,
    controller: createSkillsController({
      resolveTargets: () => targets,
      selectionStore: store,
    }),
    selectionStore: store,
  };
}

/**
 * The selection store is an injected port, so a store that refuses to persist is
 * a fake adapter rather than a mock of the code under test. It is the only way
 * to reach the "converged, then could not commit" path deterministically.
 */
function createUnwritableSelectionStore(initial: SkillSelection): SkillSelectionStore {
  return {
    get: async () => initial,
    isSet: async () => true,
    set: async () => {
      throw new Error("selection store is read-only");
    },
  };
}

function createGatedUnwritableSelectionStore(initial: SkillSelection): {
  store: SkillSelectionStore;
  persistenceStarted: Promise<void>;
  failPersistence(): void;
} {
  let markStarted!: () => void;
  let fail!: () => void;
  const persistenceStarted = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const failureGate = new Promise<void>((resolve) => {
    fail = resolve;
  });
  return {
    store: {
      get: async () => initial,
      isSet: async () => true,
      set: async () => {
        markStarted();
        await failureGate;
        throw new Error("selection store is read-only");
      },
    },
    persistenceStarted,
    failPersistence: fail,
  };
}

function createGatedSelectionStore(initial: SkillSelection): {
  store: SkillSelectionStore;
  persistenceStarted: Promise<void>;
  finishPersistence(): void;
} {
  let current = initial;
  let markStarted!: () => void;
  let finish!: () => void;
  const persistenceStarted = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  return {
    store: {
      get: async () => current,
      isSet: async () => true,
      set: async (selection) => {
        markStarted();
        await gate;
        current = selection;
        return current;
      },
    },
    persistenceStarted,
    finishPersistence: finish,
  };
}

async function installedSkills(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

async function installedEverywhere(targets: SkillTargets): Promise<string[][]> {
  return Promise.all([targets.agentsDir, targets.claudeDir, targets.codexDir].map(installedSkills));
}

async function writeUserFile(
  targets: SkillTargets,
  skill: string,
  relativePath: string,
  contents: string,
): Promise<void> {
  for (const dir of [targets.agentsDir, targets.claudeDir, targets.codexDir]) {
    const file = path.join(dir, skill, relativePath);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents);
  }
}

async function readUserFile(
  targets: SkillTargets,
  skill: string,
  relativePath: string,
): Promise<Array<string | null>> {
  return Promise.all(
    [targets.agentsDir, targets.claudeDir, targets.codexDir].map((dir) =>
      readFile(path.join(dir, skill, relativePath), "utf8").catch(() => null),
    ),
  );
}

/** Anything the transaction staged and failed to clean up sits beside the skills tree. */
async function backupArtifacts(targets: SkillTargets): Promise<string[][]> {
  return Promise.all(
    [targets.agentsDir, targets.claudeDir, targets.codexDir].map(async (dir) => {
      const parentEntries = await readdir(path.dirname(dir)).catch(() => []);
      const rootEntries = await readdir(dir).catch(() => []);
      return [
        ...parentEntries.filter(
          (entry) =>
            entry !== path.basename(dir) && !entry.startsWith(".clisbot-skills-recovered-"),
        ),
        ...rootEntries.filter((entry) => entry.startsWith(".clisbot-skills-transaction-")),
      ].sort();
    }),
  );
}

async function waitForTransactionDirectory(parent: string): Promise<void> {
  const events = watch(parent);
  try {
    for await (const event of events) {
      if (event.filename?.startsWith(".clisbot-skills-transaction-")) return;
    }
  } finally {
    await events.return?.();
  }
}

/** Puts a regular file where the agents skills tree goes, so convergence fails with ENOTDIR. */
async function blockAgentsDir(targets: SkillTargets): Promise<void> {
  await rm(targets.agentsDir, { recursive: true, force: true });
  await mkdir(path.dirname(targets.agentsDir), { recursive: true });
  await writeFile(targets.agentsDir, "not a directory");
}

async function isInstalled(targets: SkillTargets, name: string): Promise<boolean> {
  const dirs = [targets.agentsDir, targets.claudeDir];
  const present = await Promise.all(
    dirs.map((dir) =>
      access(path.join(dir, name))
        .then(() => true)
        .catch(() => false),
    ),
  );
  return present.every(Boolean);
}

describe("skills controller", () => {
  it("imports a legacy selection only while daemon selection is absent", async () => {
    let current: SkillSelection = { mode: "all" };
    let explicit = false;
    const store: SkillSelectionStore = {
      get: async () => current,
      set: async (selection) => {
        current = selection as SkillSelection;
        explicit = true;
        return current;
      },
      isSet: async () => explicit,
    };
    const harness = await makeHarness(store);

    await expect(
      harness.controller.importLegacySelectionIfUnset({
        mode: "custom",
        skills: ["clisbot", "clisbot-loop"],
      }),
    ).resolves.toEqual({
      imported: true,
      selection: { mode: "custom", skills: ["clisbot", "clisbot-loop"] },
    });
    await expect(harness.controller.importLegacySelectionIfUnset({ mode: "all" })).resolves.toEqual(
      {
        imported: false,
        selection: { mode: "custom", skills: ["clisbot", "clisbot-loop"] },
      },
    );
    expect(await installedEverywhere(harness.targets)).toEqual([[], [], []]);
  });

  let harness: Harness;

  beforeEach(async () => {
    harness = await makeHarness();
  });

  afterEach(async () => {
    await rm(harness.root, { recursive: true, force: true });
  });

  it("reports one snapshot with catalog, selection, status, and pending work", async () => {
    expect(await harness.controller.status()).toEqual({
      state: "not-installed",
      ops: [
        { kind: "add", name: "clisbot" },
        { kind: "add", name: "clisbot-advisor" },
        { kind: "add", name: "clisbot-loop" },
      ],
      available: BUNDLED_SKILLS,
      installed: [],
      selection: { mode: "all" },
    });
  });

  it("installs every bundled skill while the selection is all", async () => {
    expect(await harness.controller.install()).toEqual({
      state: "up-to-date",
      ops: [],
      available: BUNDLED_SKILLS,
      installed: BUNDLED_SKILLS,
      selection: { mode: "all" },
    });
    expect(await isInstalled(harness.targets, "clisbot-advisor")).toBe(true);
  });

  it("does not remove deselected directories during install", async () => {
    await harness.controller.save({ mode: "custom", skills: ["clisbot"] });
    await writeUserFile(harness.targets, "clisbot-loop", "notes/mine.md", "keep this");

    await harness.controller.install();

    expect(await readUserFile(harness.targets, "clisbot-loop", "notes/mine.md")).toEqual([
      "keep this",
      "keep this",
      "keep this",
    ]);
  });

  it("saves a custom selection, converges disk, and returns the refreshed snapshot", async () => {
    const snapshot = await harness.controller.save({
      mode: "custom",
      skills: ["clisbot-loop", "clisbot"],
    });

    expect(snapshot).toEqual({
      state: "up-to-date",
      ops: [],
      available: BUNDLED_SKILLS,
      installed: ["clisbot", "clisbot-loop"],
      selection: { mode: "custom", skills: ["clisbot", "clisbot-loop"] },
      confirmationRequired: null,
    });
    expect(await isInstalled(harness.targets, "clisbot")).toBe(true);
    expect(await isInstalled(harness.targets, "clisbot-loop")).toBe(true);
    expect(await isInstalled(harness.targets, "clisbot-advisor")).toBe(false);
  });

  it("removes a skill from disk when it is dropped from the selection", async () => {
    await harness.controller.install();

    await harness.controller.save({
      mode: "custom",
      skills: ["clisbot"],
      confirmedRemovals: ["clisbot-advisor", "clisbot-loop"],
    });

    expect(await isInstalled(harness.targets, "clisbot")).toBe(true);
    expect(await isInstalled(harness.targets, "clisbot-advisor")).toBe(false);
    expect(await isInstalled(harness.targets, "clisbot-loop")).toBe(false);
  });

  it("keeps the saved selection after uninstall so a later install restores it", async () => {
    await harness.controller.save({ mode: "custom", skills: ["clisbot"] });

    const afterUninstall = await harness.controller.uninstall();
    const afterReinstall = await harness.controller.install();

    expect(afterUninstall).toEqual({
      state: "not-installed",
      ops: [{ kind: "add", name: "clisbot" }],
      available: BUNDLED_SKILLS,
      installed: [],
      selection: { mode: "custom", skills: ["clisbot"] },
    });
    expect(afterReinstall).toEqual({
      state: "up-to-date",
      ops: [],
      available: BUNDLED_SKILLS,
      installed: ["clisbot"],
      selection: { mode: "custom", skills: ["clisbot"] },
    });
    expect(await isInstalled(harness.targets, "clisbot")).toBe(true);
    expect(await isInstalled(harness.targets, "clisbot-loop")).toBe(false);
  });

  it("treats an empty custom selection as uninstall while keeping the preference", async () => {
    await harness.controller.install();

    const snapshot = await harness.controller.save({
      mode: "custom",
      skills: [],
      confirmedRemovals: BUNDLED_SKILLS,
    });

    expect(snapshot).toEqual({
      state: "not-installed",
      ops: [],
      available: BUNDLED_SKILLS,
      installed: [],
      selection: { mode: "custom", skills: [] },
      confirmationRequired: null,
    });
    expect(await isInstalled(harness.targets, "clisbot")).toBe(false);
  });

  it("returns to every bundled skill when the selection goes back to all", async () => {
    await harness.controller.save({ mode: "custom", skills: ["clisbot"] });

    const snapshot = await harness.controller.save({ mode: "all" });

    expect(snapshot).toEqual({
      state: "up-to-date",
      ops: [],
      available: BUNDLED_SKILLS,
      installed: BUNDLED_SKILLS,
      selection: { mode: "all" },
      confirmationRequired: null,
    });
    expect(await isInstalled(harness.targets, "clisbot-advisor")).toBe(true);
  });

  it("keeps the previous selection when the save fails to reach disk", async () => {
    await harness.controller.save({ mode: "custom", skills: ["clisbot"] });
    await blockAgentsDir(harness.targets);

    await expect(harness.controller.save({ mode: "all" })).rejects.toThrow();
    await rm(harness.targets.agentsDir, { force: true });

    expect(await harness.controller.status()).toEqual({
      state: "drift",
      ops: [{ kind: "add", name: "clisbot" }],
      available: BUNDLED_SKILLS,
      installed: ["clisbot"],
      selection: { mode: "custom", skills: ["clisbot"] },
    });
  });

  it("saves no selection at all when the very first save fails", async () => {
    await blockAgentsDir(harness.targets);

    await expect(
      harness.controller.save({ mode: "custom", skills: ["clisbot"] }),
    ).rejects.toThrow();
    await rm(harness.targets.agentsDir, { force: true });

    expect(await harness.controller.status()).toEqual({
      state: "not-installed",
      ops: BUNDLED_SKILLS.map((name) => ({ kind: "add", name })),
      available: BUNDLED_SKILLS,
      installed: [],
      selection: { mode: "all" },
    });
  });

  it("restores deleted directories byte for byte when the selection cannot be committed", async () => {
    const store = createUnwritableSelectionStore({
      mode: "custom",
      skills: ["clisbot", "clisbot-loop"],
    });
    const readOnly = await makeHarness(store);
    await readOnly.controller.install();
    await writeUserFile(readOnly.targets, "clisbot-loop", "notes/mine.md", "hand written");

    // Deselects clisbot-loop and adds clisbot-advisor, then fails to commit.
    await expect(
      readOnly.controller.save({
        mode: "custom",
        skills: ["clisbot", "clisbot-advisor"],
        confirmedRemovals: ["clisbot-loop"],
      }),
    ).rejects.toThrow("selection store is read-only");

    expect(await readOnly.controller.status()).toEqual({
      state: "up-to-date",
      ops: [],
      available: BUNDLED_SKILLS,
      installed: ["clisbot", "clisbot-loop"],
      selection: { mode: "custom", skills: ["clisbot", "clisbot-loop"] },
    });
    expect(await installedEverywhere(readOnly.targets)).toEqual([
      ["clisbot", "clisbot-loop"],
      ["clisbot", "clisbot-loop"],
      ["clisbot-loop"],
    ]);
    expect(await readUserFile(readOnly.targets, "clisbot-loop", "notes/mine.md")).toEqual([
      "hand written",
      "hand written",
      "hand written",
    ]);
    expect(await backupArtifacts(readOnly.targets)).toEqual([[], [], []]);
    await rm(readOnly.root, { recursive: true, force: true });
  });

  it("preserves files added by another writer before rollback", async () => {
    const selection: SkillSelection = { mode: "custom", skills: ["clisbot"] };
    const gated = createGatedUnwritableSelectionStore(selection);
    const readOnly = await makeHarness(gated.store);
    await readOnly.controller.install();
    await writeFile(path.join(readOnly.targets.sourceDir, "clisbot", "SKILL.md"), "clisbot-v2");

    const save = readOnly.controller.save(selection);
    await gated.persistenceStarted;
    await writeUserFile(readOnly.targets, "clisbot", "notes/concurrent.md", "keep this");
    gated.failPersistence();
    await expect(save).rejects.toThrow("selection store is read-only");

    expect(await readUserFile(readOnly.targets, "clisbot", "notes/concurrent.md")).toEqual([
      "keep this",
      "keep this",
      "keep this",
    ]);
    await rm(readOnly.root, { recursive: true, force: true });
  });

  it("does not automatically delete files preserved from a rolled-back add", async () => {
    const previous: SkillSelection = { mode: "custom", skills: ["clisbot"] };
    const gated = createGatedUnwritableSelectionStore(previous);
    const readOnly = await makeHarness(gated.store);
    await readOnly.controller.install();

    const save = readOnly.controller.save({
      mode: "custom",
      skills: ["clisbot", "clisbot-loop"],
    });
    await gated.persistenceStarted;
    await writeUserFile(readOnly.targets, "clisbot-loop", "notes/concurrent.md", "keep this");
    gated.failPersistence();
    await expect(save).rejects.toThrow("selection store is read-only");

    await readOnly.controller.autoUpdate();
    expect(await readUserFile(readOnly.targets, "clisbot-loop", "notes/concurrent.md")).toEqual([
      "keep this",
      "keep this",
      "keep this",
    ]);
    await rm(readOnly.root, { recursive: true, force: true });
  });

  it("merges a deleted directory backup into files another writer recreated", async () => {
    const previous: SkillSelection = {
      mode: "custom",
      skills: ["clisbot", "clisbot-loop"],
    };
    const gated = createGatedUnwritableSelectionStore(previous);
    const readOnly = await makeHarness(gated.store);
    await readOnly.controller.install();
    await writeUserFile(readOnly.targets, "clisbot-loop", "notes/before.md", "restore this");

    const save = readOnly.controller.save({
      mode: "custom",
      skills: ["clisbot"],
      confirmedRemovals: ["clisbot-loop"],
    });
    await gated.persistenceStarted;
    await writeUserFile(readOnly.targets, "clisbot-loop", "notes/concurrent.md", "keep this");
    gated.failPersistence();
    await expect(save).rejects.toThrow("selection store is read-only");

    expect(await readUserFile(readOnly.targets, "clisbot-loop", "notes/before.md")).toEqual([
      "restore this",
      "restore this",
      "restore this",
    ]);
    expect(await readUserFile(readOnly.targets, "clisbot-loop", "notes/concurrent.md")).toEqual([
      "keep this",
      "keep this",
      "keep this",
    ]);
    await rm(readOnly.root, { recursive: true, force: true });
  });

  it("atomically stages a deletion before another writer can recreate its path", async () => {
    const previous: SkillSelection = {
      mode: "custom",
      skills: ["clisbot", "clisbot-loop"],
    };
    const next: SkillSelection = { mode: "custom", skills: ["clisbot"] };
    await harness.controller.save(previous);

    const transaction = await beginSkillsTransaction(harness.targets, previous, next, [
      { kind: "delete", name: "clisbot-loop" },
    ]);

    expect(await isInstalled(harness.targets, "clisbot-loop")).toBe(false);
    await writeUserFile(harness.targets, "clisbot-loop", "notes/concurrent.md", "keep this");
    await transaction.rollback();
    expect(await readUserFile(harness.targets, "clisbot-loop", "notes/concurrent.md")).toEqual([
      "keep this",
      "keep this",
      "keep this",
    ]);
    expect(await isInstalled(harness.targets, "clisbot-loop")).toBe(true);
  });

  it.skipIf(process.platform === "win32")(
    "renames an untouched staged deletion back with its inode and mode",
    async () => {
      const previous: SkillSelection = {
        mode: "custom",
        skills: ["clisbot", "clisbot-loop"],
      };
      const next: SkillSelection = { mode: "custom", skills: ["clisbot"] };
      await harness.controller.save(previous);
      await writeUserFile(harness.targets, "clisbot-loop", "SKILL.md", "clisbot-loop-v1");
      const livePaths = [
        harness.targets.agentsDir,
        harness.targets.claudeDir,
        harness.targets.codexDir,
      ].map((root) => path.join(root, "clisbot-loop"));
      for (const live of livePaths) await chmod(live, 0o700);
      const before = await Promise.all(livePaths.map(lstat));

      const transaction = await beginSkillsTransaction(harness.targets, previous, next, [
        { kind: "delete", name: "clisbot-loop" },
      ]);
      await transaction.rollback();

      const after = await Promise.all(livePaths.map(lstat));
      expect(after.map((entry) => entry.ino)).toEqual(before.map((entry) => entry.ino));
      expect(after.map((entry) => entry.mode & 0o777)).toEqual([0o700, 0o700, 0o700]);
    },
  );

  it("finishes rollback when an external deletion leaves no live or staged path", async () => {
    const previous: SkillSelection = {
      mode: "custom",
      skills: ["clisbot", "clisbot-loop"],
    };
    const next: SkillSelection = { mode: "custom", skills: ["clisbot"] };
    await harness.controller.save(previous);
    await writeUserFile(harness.targets, "clisbot-loop", "SKILL.md", "clisbot-loop-v1");

    const transaction = await beginSkillsTransaction(harness.targets, previous, next, [
      { kind: "delete", name: "clisbot-loop" },
    ]);
    const codexStage = (await readdir(harness.targets.codexDir)).find((entry) =>
      entry.startsWith(".clisbot-skills-transaction-"),
    );
    expect(codexStage).toBeDefined();
    await rm(path.join(harness.targets.codexDir, codexStage!, "clisbot-loop"), {
      recursive: true,
      force: true,
    });

    await transaction.rollback();

    expect(await readUserFile(harness.targets, "clisbot-loop", "SKILL.md")).toEqual([
      "clisbot-loop-v1",
      "clisbot-loop-v1",
      null,
    ]);
    expect(await backupArtifacts(harness.targets)).toEqual([[], [], []]);
    await expect(harness.controller.status()).resolves.toMatchObject({ selection: previous });
  });

  it("quarantines a staged directory when an external file takes its live path", async () => {
    const previous: SkillSelection = {
      mode: "custom",
      skills: ["clisbot", "clisbot-loop"],
    };
    const next: SkillSelection = { mode: "custom", skills: ["clisbot"] };
    await harness.controller.save(previous);
    await writeUserFile(harness.targets, "clisbot-loop", "notes/mine.md", "keep this");

    const transaction = await beginSkillsTransaction(harness.targets, previous, next, [
      { kind: "delete", name: "clisbot-loop" },
    ]);
    const live = path.join(harness.targets.codexDir, "clisbot-loop");
    await writeFile(live, "external replacement");

    await transaction.rollback();

    expect(await readFile(live, "utf8")).toBe("external replacement");
    const recovered = (await readdir(harness.targets.codexDir)).find((entry) =>
      entry.startsWith(".clisbot-skills-recovered-"),
    );
    expect(recovered).toBeDefined();
    expect(
      await readFile(path.join(harness.targets.codexDir, recovered!, "notes", "mine.md"), "utf8"),
    ).toBe("keep this");
    expect(await readUserFile(harness.targets, "clisbot-loop", "notes/mine.md")).toEqual([
      "keep this",
      "keep this",
      null,
    ]);
    expect(await backupArtifacts(harness.targets)).toEqual([[], [], []]);
    await expect(harness.controller.status()).resolves.toMatchObject({ selection: previous });
  });

  it("quarantines staged files that collide with a recreated directory", async () => {
    const previous: SkillSelection = {
      mode: "custom",
      skills: ["clisbot", "clisbot-loop"],
    };
    const next: SkillSelection = { mode: "custom", skills: ["clisbot"] };
    await harness.controller.save(previous);
    await writeUserFile(harness.targets, "clisbot-loop", "SKILL.md", "clisbot-loop-v1");
    await writeUserFile(harness.targets, "clisbot-loop", "notes/mine.md", "staged notes");

    const transaction = await beginSkillsTransaction(harness.targets, previous, next, [
      { kind: "delete", name: "clisbot-loop" },
    ]);
    const live = path.join(harness.targets.codexDir, "clisbot-loop");
    await mkdir(path.join(live, "notes"), { recursive: true });
    await writeFile(path.join(live, "SKILL.md"), "external skill");
    await writeFile(path.join(live, "notes", "mine.md"), "external notes");

    await transaction.rollback();

    expect(await readFile(path.join(live, "SKILL.md"), "utf8")).toBe("external skill");
    expect(await readFile(path.join(live, "notes", "mine.md"), "utf8")).toBe("external notes");
    const recovered = (await readdir(harness.targets.codexDir)).find((entry) =>
      entry.startsWith(".clisbot-skills-recovered-clisbot-loop-"),
    );
    expect(recovered).toBeDefined();
    expect(
      await readFile(path.join(harness.targets.codexDir, recovered!, "SKILL.md"), "utf8"),
    ).toBe("clisbot-loop-v1");
    expect(
      await readFile(path.join(harness.targets.codexDir, recovered!, "notes", "mine.md"), "utf8"),
    ).toBe("staged notes");
    expect(await backupArtifacts(harness.targets)).toEqual([[], [], []]);
    await expect(harness.controller.status()).resolves.toMatchObject({ selection: previous });
  });

  it("preserves incompatible live paths while rolling back adds and updates", async () => {
    const previous: SkillSelection = { mode: "custom", skills: ["clisbot"] };
    const next: SkillSelection = {
      mode: "custom",
      skills: ["clisbot", "clisbot-advisor"],
    };
    await harness.controller.save(previous);
    await writeUserFile(harness.targets, "clisbot", "notes/mine.md", "keep this");

    const transaction = await beginSkillsTransaction(harness.targets, previous, next, [
      { kind: "update", name: "clisbot" },
      { kind: "add", name: "clisbot-advisor" },
    ]);
    const replacedUpdate = path.join(harness.targets.agentsDir, "clisbot");
    await rm(replacedUpdate, { recursive: true, force: true });
    await writeFile(replacedUpdate, "external update replacement");
    const replacedAdd = path.join(harness.targets.codexDir, "clisbot-advisor");
    await writeFile(replacedAdd, "external add replacement");

    await transaction.rollback();

    expect(await readFile(replacedUpdate, "utf8")).toBe("external update replacement");
    expect(await readFile(replacedAdd, "utf8")).toBe("external add replacement");
    const recoveryParent = path.dirname(harness.targets.agentsDir);
    const recovered = (await readdir(recoveryParent)).find((entry) =>
      entry.startsWith(".clisbot-skills-recovered-clisbot-"),
    );
    expect(recovered).toBeDefined();
    expect(await readFile(path.join(recoveryParent, recovered!, "notes", "mine.md"), "utf8")).toBe(
      "keep this",
    );
    expect(await readUserFile(harness.targets, "clisbot", "notes/mine.md")).toEqual([
      null,
      "keep this",
      "keep this",
    ]);
    expect(await backupArtifacts(harness.targets)).toEqual([[], [], []]);
    await expect(harness.controller.status()).resolves.toMatchObject({ selection: previous });
  });

  it("recovers after an update backup was quarantined before transaction cleanup", async () => {
    const previous: SkillSelection = { mode: "custom", skills: ["clisbot"] };
    const next: SkillSelection = {
      mode: "custom",
      skills: ["clisbot", "clisbot-advisor"],
    };
    await harness.controller.save(previous);
    await writeUserFile(harness.targets, "clisbot", "notes/mine.md", "captured notes");

    await beginSkillsTransaction(harness.targets, previous, next, [
      { kind: "update", name: "clisbot" },
    ]);
    const transactionParent = path.dirname(harness.targets.agentsDir);
    const transactionName = (await readdir(transactionParent)).find((entry) =>
      entry.startsWith(".clisbot-skills-transaction-"),
    );
    expect(transactionName).toBeDefined();
    const transactionDir = path.join(transactionParent, transactionName!);
    const manifest = JSON.parse(
      await readFile(path.join(transactionDir, "transaction.json"), "utf8"),
    ) as { entries: Array<{ livePath: string; backupPath: string | null }> };
    const entry = manifest.entries.find(
      (candidate) => candidate.livePath === path.join(harness.targets.agentsDir, "clisbot"),
    );
    expect(entry?.backupPath).toBeTruthy();
    const backup = path.join(transactionDir, entry!.backupPath!);
    const recovered = path.join(
      transactionParent,
      `.clisbot-skills-recovered-clisbot-${transactionName!.replace(".clisbot-skills-transaction-", "")}`,
    );
    await rm(entry!.livePath, { recursive: true, force: true });
    await writeFile(entry!.livePath, "external replacement");
    await rename(backup, recovered);

    await expect(harness.controller.status()).resolves.toMatchObject({ selection: previous });

    expect(await readFile(entry!.livePath, "utf8")).toBe("external replacement");
    expect(await readFile(path.join(recovered, "notes", "mine.md"), "utf8")).toBe("captured notes");
    expect(await backupArtifacts(harness.targets)).toEqual([[], [], []]);
  });

  it("preserves a directory that replaces a captured file before recovery", async () => {
    const previous: SkillSelection = { mode: "custom", skills: ["clisbot"] };
    const next: SkillSelection = {
      mode: "custom",
      skills: ["clisbot", "clisbot-advisor"],
    };
    await harness.controller.save(previous);
    const live = path.join(harness.targets.agentsDir, "clisbot");
    await rm(live, { recursive: true, force: true });
    await writeFile(live, "captured file");

    await beginSkillsTransaction(harness.targets, previous, next, [
      { kind: "update", name: "clisbot" },
    ]);
    await rm(live, { force: true });
    await mkdir(live, { recursive: true });
    await writeFile(path.join(live, "external.md"), "external directory");

    await expect(harness.controller.status()).resolves.toMatchObject({ selection: previous });

    expect(await readFile(path.join(live, "external.md"), "utf8")).toBe("external directory");
    const recovered = (await readdir(path.dirname(harness.targets.agentsDir))).find((entry) =>
      entry.startsWith(".clisbot-skills-recovered-clisbot-"),
    );
    expect(recovered).toBeDefined();
    expect(
      await readFile(path.join(path.dirname(harness.targets.agentsDir), recovered!), "utf8"),
    ).toBe("captured file");
    expect(await backupArtifacts(harness.targets)).toEqual([[], [], []]);
  });

  it.skipIf(process.platform !== "linux")(
    "stages deletions when an agent skills root is on another filesystem",
    async () => {
      const crossFilesystemRoot = await mkdtemp("/dev/shm/clisbot-skills-controller-");
      try {
        harness.targets.claudeDir = path.join(crossFilesystemRoot, "skills");
        const previous: SkillSelection = {
          mode: "custom",
          skills: ["clisbot", "clisbot-loop"],
        };
        const next: SkillSelection = { mode: "custom", skills: ["clisbot"] };
        await harness.controller.save(previous);

        expect((await lstat(harness.targets.agentsDir)).dev).not.toBe(
          (await lstat(harness.targets.claudeDir)).dev,
        );
        const transaction = await beginSkillsTransaction(harness.targets, previous, next, [
          { kind: "delete", name: "clisbot-loop" },
        ]);

        expect(await isInstalled(harness.targets, "clisbot-loop")).toBe(false);
        await transaction.rollback();
        expect(await isInstalled(harness.targets, "clisbot-loop")).toBe(true);
      } finally {
        await rm(crossFilesystemRoot, { recursive: true, force: true });
      }
    },
  );

  it.skipIf(process.platform === "win32")(
    "restores a relative symlink used as the skill directory",
    async () => {
      const previous: SkillSelection = {
        mode: "custom",
        skills: ["clisbot", "clisbot-loop"],
      };
      const next: SkillSelection = { mode: "custom", skills: ["clisbot"] };
      await harness.controller.save(previous);
      const shared = path.join(harness.root, "home", "shared", "clisbot-loop");
      await mkdir(shared, { recursive: true });
      await writeFile(path.join(shared, "SKILL.md"), "shared target");
      const live = path.join(harness.targets.claudeDir, "clisbot-loop");
      await rm(live, { recursive: true, force: true });
      await symlink(path.relative(harness.targets.claudeDir, shared), live, "dir");

      const transaction = await beginSkillsTransaction(harness.targets, previous, next, [
        { kind: "delete", name: "clisbot-loop" },
      ]);
      await transaction.rollback();

      expect((await lstat(live)).isSymbolicLink()).toBe(true);
      expect(await readFile(path.join(live, "SKILL.md"), "utf8")).toBe("shared target");
    },
  );

  it.skipIf(process.platform === "win32")(
    "restores updates made through a relative skill-directory symlink",
    async () => {
      const selection: SkillSelection = { mode: "custom", skills: ["clisbot"] };
      const gated = createGatedUnwritableSelectionStore(selection);
      const readOnly = await makeHarness(gated.store);
      await readOnly.controller.install();
      const shared = path.join(readOnly.root, "home", "shared", "clisbot");
      await mkdir(shared, { recursive: true });
      await writeFile(path.join(shared, "SKILL.md"), "clisbot-v1");
      const live = path.join(readOnly.targets.claudeDir, "clisbot");
      await rm(live, { recursive: true, force: true });
      await symlink(path.relative(readOnly.targets.claudeDir, shared), live, "dir");
      await writeFile(path.join(readOnly.targets.sourceDir, "clisbot", "SKILL.md"), "clisbot-v2");

      const save = readOnly.controller.save(selection);
      await gated.persistenceStarted;
      gated.failPersistence();
      await expect(save).rejects.toThrow("selection store is read-only");

      expect((await lstat(live)).isSymbolicLink()).toBe(true);
      expect(await readFile(path.join(shared, "SKILL.md"), "utf8")).toBe("clisbot-v1");
      await rm(readOnly.root, { recursive: true, force: true });
    },
  );

  it.skipIf(process.platform === "win32")(
    "stages one deletion when two agent roots alias the same directory",
    async () => {
      await harness.controller.install();
      await rm(harness.targets.claudeDir, { recursive: true, force: true });
      await symlink(
        path.relative(path.dirname(harness.targets.claudeDir), harness.targets.agentsDir),
        harness.targets.claudeDir,
        "dir",
      );

      const result = await harness.controller.save({
        mode: "custom",
        skills: ["clisbot", "clisbot-advisor"],
        confirmedRemovals: ["clisbot-loop"],
      });

      expect(result.confirmationRequired).toBeNull();
      expect(await isInstalled(harness.targets, "clisbot-loop")).toBe(false);
    },
  );

  it.skipIf(process.platform === "win32")(
    "restores a user-added symlink when deletion rolls back",
    async () => {
      const previous: SkillSelection = {
        mode: "custom",
        skills: ["clisbot", "clisbot-loop"],
      };
      const gated = createGatedUnwritableSelectionStore(previous);
      const readOnly = await makeHarness(gated.store);
      await readOnly.controller.install();
      for (const root of [
        readOnly.targets.agentsDir,
        readOnly.targets.claudeDir,
        readOnly.targets.codexDir,
      ]) {
        const notes = path.join(root, "clisbot-loop", "notes");
        await mkdir(notes, { recursive: true });
        await writeFile(path.join(notes, "before.md"), "target");
        await symlink("before.md", path.join(notes, "latest.md"));
      }

      const save = readOnly.controller.save({
        mode: "custom",
        skills: ["clisbot"],
        confirmedRemovals: ["clisbot-loop"],
      });
      await gated.persistenceStarted;
      gated.failPersistence();
      await expect(save).rejects.toThrow("selection store is read-only");

      for (const root of [
        readOnly.targets.agentsDir,
        readOnly.targets.claudeDir,
        readOnly.targets.codexDir,
      ]) {
        const restored = path.join(root, "clisbot-loop", "notes", "latest.md");
        expect((await lstat(restored)).isSymbolicLink()).toBe(true);
        expect(await readlink(restored)).toBe("before.md");
      }
      await rm(readOnly.root, { recursive: true, force: true });
    },
  );

  it.skipIf(process.platform === "win32")(
    "restores executable permissions when deletion rolls back",
    async () => {
      const previous: SkillSelection = {
        mode: "custom",
        skills: ["clisbot", "clisbot-loop"],
      };
      const gated = createGatedUnwritableSelectionStore(previous);
      const readOnly = await makeHarness(gated.store);
      await readOnly.controller.install();
      await writeUserFile(readOnly.targets, "clisbot-loop", "hooks/run.sh", "#!/bin/sh\n");
      for (const root of [
        readOnly.targets.agentsDir,
        readOnly.targets.claudeDir,
        readOnly.targets.codexDir,
      ]) {
        await chmod(path.join(root, "clisbot-loop", "hooks", "run.sh"), 0o751);
      }

      const save = readOnly.controller.save({
        mode: "custom",
        skills: ["clisbot"],
        confirmedRemovals: ["clisbot-loop"],
      });
      await gated.persistenceStarted;
      gated.failPersistence();
      await expect(save).rejects.toThrow("selection store is read-only");

      for (const root of [
        readOnly.targets.agentsDir,
        readOnly.targets.claudeDir,
        readOnly.targets.codexDir,
      ]) {
        const restored = await lstat(path.join(root, "clisbot-loop", "hooks", "run.sh"));
        expect(restored.mode & 0o777).toBe(0o751);
      }
      await rm(readOnly.root, { recursive: true, force: true });
    },
  );

  it("leaves no backup artifacts behind after a successful save", async () => {
    await harness.controller.save({ mode: "custom", skills: ["clisbot"] });

    expect(await backupArtifacts(harness.targets)).toEqual([[], [], []]);
  });

  it.skipIf(process.platform === "win32")(
    "reports a committed save as successful when cleanup is deferred",
    async () => {
      const gated = createGatedSelectionStore({ mode: "all" });
      const blocked = await makeHarness(gated.store);
      const next: SkillSelection = { mode: "custom", skills: ["clisbot"] };
      const parent = path.dirname(blocked.targets.agentsDir);
      const movedParent = `${parent}-moved`;

      const save = blocked.controller.save(next);
      await gated.persistenceStarted;
      await rename(parent, movedParent);
      await writeFile(parent, "block transaction cleanup with ENOTDIR");
      gated.finishPersistence();
      const outcome = await save.then(
        () => ({ ok: true as const }),
        (error: unknown) => ({ ok: false as const, error }),
      );
      await rm(parent, { force: true });
      await rename(movedParent, parent);

      expect(outcome.ok).toBe(true);
      expect(await gated.store.get()).toEqual(next);
      await blocked.controller.status();
      expect(await backupArtifacts(blocked.targets)).toEqual([[], [], []]);
      await rm(blocked.root, { recursive: true, force: true });
    },
  );

  it("does not delete an unrelated file that resembles transaction staging", async () => {
    const unrelated = path.join(
      path.dirname(harness.targets.agentsDir),
      ".clisbot-skills-transaction-my-notes",
    );
    await mkdir(unrelated, { recursive: true });
    await writeFile(path.join(unrelated, "mine.md"), "keep me");

    await harness.controller.save({ mode: "custom", skills: ["clisbot"] });

    expect(await readFile(path.join(unrelated, "mine.md"), "utf8")).toBe("keep me");
  });

  it("recovers an interrupted save before the next controller operation", async () => {
    const previous: SkillSelection = {
      mode: "custom",
      skills: ["clisbot", "clisbot-loop"],
    };
    const next: SkillSelection = {
      mode: "custom",
      skills: ["clisbot", "clisbot-advisor"],
    };
    await harness.controller.save(previous);
    await writeUserFile(harness.targets, "clisbot-loop", "notes/mine.md", "hand written");
    await beginSkillsTransaction(harness.targets, previous, next, [
      { kind: "delete", name: "clisbot-loop" },
    ]);
    for (const root of [
      harness.targets.agentsDir,
      harness.targets.claudeDir,
      harness.targets.codexDir,
    ]) {
      await rm(path.join(root, "clisbot-loop"), { recursive: true, force: true });
    }

    await harness.controller.status();

    expect(await readUserFile(harness.targets, "clisbot-loop", "notes/mine.md")).toEqual([
      "hand written",
      "hand written",
      "hand written",
    ]);
    expect(await backupArtifacts(harness.targets)).toEqual([[], [], []]);
  });

  it("does not roll back an interrupted transaction after the selection committed", async () => {
    const previous: SkillSelection = {
      mode: "custom",
      skills: ["clisbot", "clisbot-loop"],
    };
    const next: SkillSelection = {
      mode: "custom",
      skills: ["clisbot"],
    };
    await harness.controller.save(previous);
    await beginSkillsTransaction(harness.targets, previous, next, [
      { kind: "delete", name: "clisbot-loop" },
    ]);
    for (const root of [
      harness.targets.agentsDir,
      harness.targets.claudeDir,
      harness.targets.codexDir,
    ]) {
      await rm(path.join(root, "clisbot-loop"), { recursive: true, force: true });
    }
    await harness.selectionStore.set(next);

    const snapshot = await harness.controller.status();

    expect(snapshot.selection).toEqual(next);
    expect(await isInstalled(harness.targets, "clisbot-loop")).toBe(false);
    expect(await backupArtifacts(harness.targets)).toEqual([[], [], []]);
  });

  it("asks for confirmation naming the directories a save would delete", async () => {
    await harness.controller.save({ mode: "custom", skills: ["clisbot", "clisbot-loop"] });
    // Something puts a managed directory back after the UI took its snapshot.
    await writeUserFile(harness.targets, "clisbot-advisor", "SKILL.md", "external");

    const result = await harness.controller.save({
      mode: "custom",
      skills: ["clisbot", "clisbot-loop"],
    });

    expect(result.confirmationRequired).toEqual({ removals: ["clisbot-advisor"] });
    expect(await installedEverywhere(harness.targets)).toEqual([
      ["clisbot", "clisbot-advisor", "clisbot-loop"],
      ["clisbot", "clisbot-advisor", "clisbot-loop"],
      ["clisbot-advisor"],
    ]);
    expect(result.selection).toEqual({ mode: "custom", skills: ["clisbot", "clisbot-loop"] });
  });

  it("applies the save once the removals are confirmed", async () => {
    await harness.controller.install();

    const result = await harness.controller.save({
      mode: "custom",
      skills: ["clisbot"],
      confirmedRemovals: ["clisbot-advisor", "clisbot-loop"],
    });

    expect(result.confirmationRequired).toBeNull();
    expect(result.selection).toEqual({ mode: "custom", skills: ["clisbot"] });
    expect(await installedEverywhere(harness.targets)).toEqual([["clisbot"], ["clisbot"], []]);
  });

  it("asks again when another directory appears before the retry", async () => {
    await harness.controller.install();
    await writeUserFile(harness.targets, "clisbot-chat", "SKILL.md", "retired but present");

    const result = await harness.controller.save({
      mode: "custom",
      skills: ["clisbot"],
      confirmedRemovals: ["clisbot-advisor", "clisbot-loop"],
    });

    expect(result.confirmationRequired).toEqual({
      removals: ["clisbot-advisor", "clisbot-chat", "clisbot-loop"],
    });
    expect(await installedEverywhere(harness.targets)).toEqual([
      ["clisbot", "clisbot-advisor", "clisbot-chat", "clisbot-loop"],
      ["clisbot", "clisbot-advisor", "clisbot-chat", "clisbot-loop"],
      ["clisbot-chat"],
    ]);
  });

  it("does not commit when a new removal appears while the frozen plan is applying", async () => {
    const selection: SkillSelection = { mode: "custom", skills: ["clisbot"] };
    await harness.controller.save(selection);
    await writeFile(path.join(harness.targets.sourceDir, "clisbot", "SKILL.md"), "clisbot-v2");

    const transactionStarted = waitForTransactionDirectory(path.dirname(harness.targets.agentsDir));
    const save = harness.controller.save(selection);
    await transactionStarted;
    await writeUserFile(harness.targets, "clisbot-chat", "notes/mine.md", "hand written");

    const result = await save;

    expect(result.confirmationRequired).toEqual({ removals: ["clisbot-chat"] });
    expect(result.selection).toEqual(selection);
    expect(await readUserFile(harness.targets, "clisbot-chat", "notes/mine.md")).toEqual([
      "hand written",
      "hand written",
      "hand written",
    ]);
  });

  it("saves without asking when nothing would be deleted", async () => {
    const result = await harness.controller.save({ mode: "custom", skills: ["clisbot"] });

    expect(result.confirmationRequired).toBeNull();
    expect(await installedEverywhere(harness.targets)).toEqual([["clisbot"], ["clisbot"], []]);
  });

  it("preserves a regular file at a skill path when save convergence fails", async () => {
    await mkdir(harness.targets.agentsDir, { recursive: true });
    const collision = path.join(harness.targets.agentsDir, "clisbot");
    await writeFile(collision, "keep this file");

    await expect(
      harness.controller.save({ mode: "custom", skills: ["clisbot"] }),
    ).rejects.toThrow();

    expect(await readFile(collision, "utf8")).toBe("keep this file");
  });

  it("serializes startup convergence with an interactive save", async () => {
    await harness.controller.install();
    // Startup finds drift it wants to repair while the user narrows the
    // selection. Whichever runs first, disk must end up matching what is saved.
    await rm(path.join(harness.targets.claudeDir, "clisbot-loop"), {
      recursive: true,
      force: true,
    });

    const [, saved] = await Promise.all([
      harness.controller.autoUpdate(),
      harness.controller.save({
        mode: "custom",
        skills: ["clisbot"],
        confirmedRemovals: ["clisbot-advisor", "clisbot-loop"],
      }),
    ]);

    expect(saved.selection).toEqual({ mode: "custom", skills: ["clisbot"] });
    expect(await installedEverywhere(harness.targets)).toEqual([["clisbot"], ["clisbot"], []]);
    expect(await harness.controller.status()).toEqual({
      state: "up-to-date",
      ops: [],
      available: BUNDLED_SKILLS,
      installed: ["clisbot"],
      selection: { mode: "custom", skills: ["clisbot"] },
    });
  });

  it("updates a drifted install without touching the saved selection", async () => {
    await harness.controller.save({ mode: "custom", skills: ["clisbot"] });
    await writeFile(path.join(harness.targets.agentsDir, "clisbot", "SKILL.md"), "stale");

    expect(await harness.controller.update()).toEqual({
      state: "up-to-date",
      ops: [],
      available: BUNDLED_SKILLS,
      installed: ["clisbot"],
      selection: { mode: "custom", skills: ["clisbot"] },
    });
  });

  it("does not remove deselected directories during a manual update", async () => {
    await harness.controller.save({ mode: "custom", skills: ["clisbot"] });
    await writeUserFile(harness.targets, "clisbot-loop", "notes/mine.md", "keep this");

    await harness.controller.update();

    expect(await readUserFile(harness.targets, "clisbot-loop", "notes/mine.md")).toEqual([
      "keep this",
      "keep this",
      "keep this",
    ]);
  });
});
