import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { loadConfig } from "./config.js";

const roots: string[] = [];

async function createClisbotHome(config: unknown): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "clisbot-config-browser-tools-"));
  roots.push(root);
  const clisbotHome = path.join(root, ".clisbot");
  await mkdir(clisbotHome, { recursive: true });
  await writeFile(path.join(clisbotHome, "config.json"), JSON.stringify(config, null, 2));
  return clisbotHome;
}

describe("daemon browser tools config", () => {
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  test("defaults browser tools off when config is absent", async () => {
    const home = await createClisbotHome({ version: 1 });

    expect(loadConfig(home, { env: {} }).browserToolsEnabled).toBe(false);
  });

  test("a brand-new home starts with browser tools off and writes no opt-in", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "clisbot-config-browser-tools-"));
    roots.push(root);
    const home = path.join(root, ".clisbot");
    await mkdir(home, { recursive: true });

    const config = loadConfig(home, { env: {} });

    expect(config.browserToolsEnabled).toBe(false);
    const written = JSON.parse(await readFile(path.join(home, "config.json"), "utf8"));
    expect(written.daemon.browserTools).toBeUndefined();
    expect(written.daemon.mcp.injectIntoAgents).toBe(true);
  });

  test("loads browser tools opt-in from persisted daemon config", async () => {
    const home = await createClisbotHome({
      version: 1,
      daemon: { browserTools: { enabled: true } },
    });

    expect(loadConfig(home, { env: {} }).browserToolsEnabled).toBe(true);
  });
});
