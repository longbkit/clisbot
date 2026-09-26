import { describe, expect, test } from "vitest";
import type { StoredBot } from "@getpaseo/protocol/bots/types";
import { allowsBotInbound, allowsBotOutbound } from "./bot-access.js";
import { PROJECT_CREATION_REPLIES } from "./workspace-management.js";

const now = "2026-09-26T00:00:00.000Z";
const granted: StoredBot = {
  id: "bot_0123456789abcdef",
  slug: "ops-bot",
  name: "Ops Bot",
  kind: "personal",
  projectId: "prj_granted",
  workspaceId: "wks_1",
  cwd: "/tmp/ops-bot",
  launch: { provider: "codex" },
  template: null,
  owner: { kind: "user", id: "owner" },
  createdAt: now,
  updatedAt: now,
  archivedAt: null,
};
const ungranted: StoredBot = { ...granted, id: "bot_fedcba9876543210", projectId: "prj_other" };
const allowsProject = (projectId: string) => projectId === "prj_granted";

describe("allowsBotInbound", () => {
  test("bot.create needs the Host privilege and records the admitted request", () => {
    const admitted = new Set<string>();
    const request = {
      type: "bot.create.request" as const,
      requestId: "c1",
      name: "x",
      launch: { provider: "codex" },
    };
    expect(allowsBotInbound(request, { allowsDaemonPrivilege: () => false }, admitted)).toBe(false);
    expect(admitted.size).toBe(0);
    expect(allowsBotInbound(request, { allowsDaemonPrivilege: () => true }, admitted)).toBe(true);
    expect(admitted.has("c1")).toBe(true);
    expect(PROJECT_CREATION_REPLIES.has("bot.create.response")).toBe(true);
  });

  test("the other bot requests pass to the handler; other messages are not decided here", () => {
    const authority = { allowsDaemonPrivilege: () => false };
    expect(
      allowsBotInbound({ type: "bot.list.request", requestId: "l" }, authority, new Set()),
    ).toBe(true);
    expect(
      allowsBotInbound(
        { type: "bot.update.request", requestId: "u", botId: granted.id },
        authority,
        new Set(),
      ),
    ).toBe(true);
    expect(allowsBotInbound({ type: "ping" }, authority, new Set())).toBeUndefined();
  });
});

describe("allowsBotOutbound", () => {
  test("a list passes only when every bot's Project is granted", () => {
    expect(
      allowsBotOutbound(
        { type: "bot.list.response", payload: { requestId: "l", bots: [granted], error: null } },
        allowsProject,
      ),
    ).toBe(true);
    expect(
      allowsBotOutbound(
        {
          type: "bot.list.response",
          payload: { requestId: "l", bots: [granted, ungranted], error: null },
        },
        allowsProject,
      ),
    ).toBe(false);
  });

  test("a push or reply carrying a bot is filtered by its Project; error replies pass", () => {
    expect(
      allowsBotOutbound(
        { type: "bot.updated", payload: { kind: "upsert", bot: ungranted } },
        allowsProject,
      ),
    ).toBe(false);
    expect(
      allowsBotOutbound(
        { type: "bot.updated", payload: { kind: "remove", botId: ungranted.id } },
        allowsProject,
      ),
    ).toBe(true);
    expect(
      allowsBotOutbound(
        { type: "bot.update.response", payload: { requestId: "u", bot: ungranted, error: null } },
        allowsProject,
      ),
    ).toBe(false);
    expect(
      allowsBotOutbound(
        {
          type: "bot.update.response",
          payload: { requestId: "u", bot: null, error: "no", errorCode: "access_denied" },
        },
        allowsProject,
      ),
    ).toBe(true);
    expect(allowsBotOutbound({ type: "pong" }, allowsProject)).toBeUndefined();
  });
});
