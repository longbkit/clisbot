import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { loadConfig } from "./config.js";

const roots: string[] = [];

async function createClisbotHome(config: unknown): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "clisbot-clisbot-defaults-"));
  roots.push(root);
  const clisbotHome = path.join(root, ".clisbot");
  await mkdir(clisbotHome, { recursive: true });
  await writeFile(path.join(clisbotHome, "config.json"), JSON.stringify(config, null, 2));
  return clisbotHome;
}

describe("Clisbot daemon defaults", () => {
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  test("captures session storage unless the environment or config turns it off", async () => {
    const unset = await createClisbotHome({ version: 1 });
    expect(loadConfig(unset, { env: {} }).agentSessionStorage).toBe(true);
    expect(
      loadConfig(unset, { env: { CLISBOT_AGENT_SESSION_STORAGE: "0" } }).agentSessionStorage,
    ).toBe(false);

    const off = await createClisbotHome({ version: 1, features: { agentSessionStorage: false } });
    expect(loadConfig(off, { env: {} }).agentSessionStorage).toBe(false);
    expect(
      loadConfig(off, { env: { CLISBOT_AGENT_SESSION_STORAGE: "1" } }).agentSessionStorage,
    ).toBe(true);
  });

  test("bots run unless the environment or config turns them off; the environment wins", async () => {
    const unset = await createClisbotHome({ version: 1 });
    expect(loadConfig(unset, { env: {} }).bots).toEqual({
      enabled: true,
      root: path.join(unset, "workspaces"),
    });
    expect(loadConfig(unset, { env: { CLISBOT_BOTS_ENABLED: "0" } }).bots?.enabled).toBe(false);

    const off = await createClisbotHome({ version: 1, daemon: { bots: { enabled: false } } });
    expect(loadConfig(off, { env: {} }).bots?.enabled).toBe(false);
    const onByEnv = loadConfig(off, { env: { CLISBOT_BOTS_ENABLED: "1" } });
    expect(onByEnv.bots?.enabled).toBe(true);
    expect(onByEnv.configReload?.overrideControlledPaths).toContain("daemon.bots.enabled");
  });

  test("the bots root resolves like the worktrees root", async () => {
    const relative = await createClisbotHome({
      version: 1,
      daemon: { bots: { root: "bots-home" } },
    });
    expect(loadConfig(relative, { env: {} }).bots?.root).toBe(path.join(relative, "bots-home"));

    const absolute = await createClisbotHome({
      version: 1,
      daemon: { bots: { root: "/srv/bots" } },
    });
    expect(loadConfig(absolute, { env: {} }).bots?.root).toBe(path.resolve("/srv/bots"));

    const tilde = await createClisbotHome({ version: 1, daemon: { bots: { root: "~/bots" } } });
    expect(loadConfig(tilde, { env: {} }).bots?.root).toBe(path.join(os.homedir(), "bots"));
  });
});
