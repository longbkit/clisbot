import { it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  writeBotManifest,
  readBotManifest,
  readBotManifests,
  removeBotManifest,
  type BotManifest,
} from "./manifest.js";
it("keeps equal display names and rename recovery scoped by Bot ID without modifying daemon records", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "bot-reference-"));
  const id = "bot_1234567890123456";
  const second = "bot_aaaaaaaaaaaaaaaa";
  const record: BotManifest = {
    version: 2,
    botId: id,
    name: "Sandbox Assistant",
    botType: "personal",
    provider: "codex",
    workspacePath: "",
    workspaceId: "",
    agentId: "",
    agentTitle: "",
    channel: "telegram",
    account: "first",
    credentials: {},
    createdAt: "now",
    updatedAt: "now",
  };
  try {
    await mkdir(path.join(home, "bots"));
    await writeFile(path.join(home, "bots", `${id}.json`), "daemon-owned-record");
    await writeBotManifest(home, record);
    await writeBotManifest(home, { ...record, botId: second, account: "second" });
    expect((await readBotManifests(home)).length).toBe(2);
    await expect(readBotManifest(home, record.name)).rejects.toThrow("ambiguous");
    expect((await readBotManifest(home, second))?.account).toBe("second");
    await writeBotManifest(home, { ...record, name: "Renamed Assistant" });
    expect((await readBotManifest(home, id))?.name).toBe("Renamed Assistant");
    await removeBotManifest(home, id);
    expect(await readFile(path.join(home, "bots", `${id}.json`), "utf8")).toBe(
      "daemon-owned-record",
    );
    expect((await readBotManifest(home, second))?.account).toBe("second");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
