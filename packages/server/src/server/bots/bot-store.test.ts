import { mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import pino from "pino";
import { afterEach, describe, expect, it } from "vitest";
import type { StoredBot } from "@getpaseo/protocol/bots/types";
import { BotStore } from "./bot-store.js";

const dirs: string[] = [];

async function createStore() {
  const home = await mkdtemp(path.join(tmpdir(), "bot-store-"));
  dirs.push(home);
  const dir = path.join(home, "bots");
  return { dir, store: new BotStore(dir, pino({ level: "silent" })) };
}

function record(slug: string): Omit<StoredBot, "id"> {
  const now = "2026-09-26T00:00:00.000Z";
  return {
    slug,
    name: slug,
    kind: "personal",
    projectId: "prj_1",
    workspaceId: "wks_1",
    cwd: `/tmp/${slug}`,
    launch: { provider: "codex" },
    template: null,
    owner: { kind: "user", id: "owner" },
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  };
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("BotStore", () => {
  it("creates the directory on the first write only and lists nothing before", async () => {
    const { dir, store } = await createStore();
    expect(await store.list()).toEqual([]);
    await expect(stat(dir)).rejects.toMatchObject({ code: "ENOENT" });

    const bot = await store.create(record("ops"));
    expect(bot.id).toMatch(/^bot_[0-9a-f]{16}$/);
    expect(await readdir(dir)).toEqual([`${bot.id}.json`]);
  });

  it("skips and reports an invalid file once, keeping the valid records", async () => {
    const { dir, store } = await createStore();
    const created = await store.create(record("ops"));
    await writeFile(path.join(dir, "bot_broken.json"), "{not json");
    await writeFile(path.join(dir, "bot_wrong.json"), JSON.stringify({ id: "bot_wrong" }));

    const listed = await store.list();
    expect(listed.map((bot) => bot.id)).toEqual([created.id]);
    expect(await store.getBySlug("ops")).toMatchObject({ id: created.id });
    expect(await store.getByCwd("/tmp/ops")).toMatchObject({ id: created.id });
  });

  it("serializes updates per id so both edits land", async () => {
    const { store } = await createStore();
    const created = await store.create(record("ops"));
    await Promise.all([
      store.update(created.id, (bot) => ({ ...bot, title: "first" })),
      store.update(created.id, (bot) => ({ ...bot, description: "second" })),
    ]);
    expect(await store.get(created.id)).toMatchObject({ title: "first", description: "second" });
    expect(await store.update("bot_0000000000000000", (bot) => bot)).toBeNull();
  });

  it("notifies subscribers on every write and leaves no temp file behind", async () => {
    const { dir, store } = await createStore();
    const events: string[] = [];
    const unsubscribe = store.subscribe((event) => events.push(event.kind));
    const created = await store.create(record("ops"));
    await store.update(created.id, (bot) => ({ ...bot, name: "Ops" }));
    unsubscribe();
    await store.update(created.id, (bot) => ({ ...bot, name: "Ops 2" }));

    expect(events).toEqual(["upsert", "upsert"]);
    expect((await readdir(dir)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });
});

it("rejects path traversal Bot ids before reading outside the store", async () => {
  const { store } = await createStore();
  await expect(store.get("../config")).rejects.toThrow("Invalid Bot id");
  await expect(store.update("../config", (bot) => bot)).rejects.toThrow("Invalid Bot id");
});
