import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pino from "pino";
import { afterEach, describe, expect, test } from "vitest";

import { MAX_FOLLOWS_PER_READER, NotificationFollowStore } from "./follow-store.js";

const homes: string[] = [];
function home(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "clisbot-follow-store-"));
  homes.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of homes.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("NotificationFollowStore", () => {
  test("keeps each reader's follows apart and survives a restart", () => {
    const filePath = path.join(home(), "notification-follows.json");
    const store = new NotificationFollowStore(pino({ level: "silent" }), filePath);
    store.set("alice", "agent-1", true);
    store.set("bob", "agent-2", true);
    store.set("alice", "agent-3", true);
    store.set("alice", "agent-3", false);

    const restarted = new NotificationFollowStore(pino({ level: "silent" }), filePath);

    expect(restarted.list("alice")).toEqual(["agent-1"]);
    expect(restarted.list("bob")).toEqual(["agent-2"]);
    expect(restarted.isFollowing("bob", "agent-1")).toBe(false);
  });

  test("refuses a follow past the cap instead of dropping an older one", () => {
    const store = new NotificationFollowStore(
      pino({ level: "silent" }),
      path.join(home(), "notification-follows.json"),
    );
    for (let index = 0; index < MAX_FOLLOWS_PER_READER; index += 1)
      expect(store.set("alice", `agent-${index}`, true)).toBe(true);

    expect(store.set("alice", "one-more", true)).toBe(false);
    expect(store.list("alice")).toHaveLength(MAX_FOLLOWS_PER_READER);
    expect(store.isFollowing("alice", "agent-0")).toBe(true);
  });

  test("keeps an unreadable file aside instead of overwriting it", () => {
    const dir = home();
    const filePath = path.join(dir, "notification-follows.json");
    writeFileSync(filePath, "{ not json");
    const store = new NotificationFollowStore(pino({ level: "silent" }), filePath);
    store.set("alice", "agent-1", true);

    const backups = readdirSync(dir).filter((name) => name.includes(".unreadable-"));
    expect(backups).toHaveLength(1);
    expect(existsSync(path.join(dir, backups[0]!))).toBe(true);
    expect(store.list("alice")).toEqual(["agent-1"]);
  });
});
