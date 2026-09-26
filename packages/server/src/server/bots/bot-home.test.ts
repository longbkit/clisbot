import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assertBotHomeAllowed, BotHomeError, resolveBotHome } from "./bot-home.js";

const dirs: string[] = [];

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "bot-home-"));
  dirs.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("resolveBotHome", () => {
  it("puts a named bot under the root with a unique slug", async () => {
    const root = await tempRoot();
    await mkdir(path.join(root, "ops-bot"));
    const home = await resolveBotHome({
      name: "Ops Bot",
      path: undefined,
      root,
      takenSlugs: new Set(),
    });
    expect(home).toEqual({ cwd: path.join(root, "ops-bot-2"), slug: "ops-bot-2", explicit: false });
  });

  it("an explicit path wins and names the slug after the directory", async () => {
    const root = await tempRoot();
    const home = await resolveBotHome({
      name: "Ops Bot",
      path: path.join(root, "elsewhere", "assistant"),
      root,
      takenSlugs: new Set(["assistant"]),
    });
    expect(home).toEqual({
      cwd: path.join(root, "elsewhere", "assistant"),
      slug: "assistant",
      explicit: true,
    });
  });
});

describe("assertBotHomeAllowed", () => {
  it("refuses the OS home root", async () => {
    await expect(assertBotHomeAllowed(homedir(), [])).rejects.toMatchObject({ code: "home_root" });
  });

  it("refuses a home inside or containing an active Project, allows one equal to it", async () => {
    const root = await tempRoot();
    const project = path.join(root, "repo");
    await mkdir(project);
    await expect(assertBotHomeAllowed(path.join(project, "bot"), [project])).rejects.toBeInstanceOf(
      BotHomeError,
    );
    await expect(assertBotHomeAllowed(root, [project])).rejects.toMatchObject({
      code: "inside_project",
    });
    await expect(assertBotHomeAllowed(project, [project])).resolves.toBeUndefined();
    await expect(
      assertBotHomeAllowed(path.join(root, "other"), [project]),
    ).resolves.toBeUndefined();
  });
});
