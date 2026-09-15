import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { loadConfig } from "./config.js";

const roots: string[] = [];

async function createPaseoHome(config: unknown): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "paseo-clisbot-defaults-"));
  roots.push(root);
  const paseoHome = path.join(root, ".paseo");
  await mkdir(paseoHome, { recursive: true });
  await writeFile(path.join(paseoHome, "config.json"), JSON.stringify(config, null, 2));
  return paseoHome;
}

describe("Clisbot daemon defaults", () => {
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  test("captures session storage unless the environment or config turns it off", async () => {
    const unset = await createPaseoHome({ version: 1 });
    expect(loadConfig(unset, { env: {} }).agentSessionStorage).toBe(true);
    expect(
      loadConfig(unset, { env: { PASEO_AGENT_SESSION_STORAGE: "0" } }).agentSessionStorage,
    ).toBe(false);

    const off = await createPaseoHome({ version: 1, features: { agentSessionStorage: false } });
    expect(loadConfig(off, { env: {} }).agentSessionStorage).toBe(false);
    expect(loadConfig(off, { env: { PASEO_AGENT_SESSION_STORAGE: "1" } }).agentSessionStorage).toBe(
      true,
    );
  });
});
