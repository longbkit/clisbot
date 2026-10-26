import { describe, expect, it } from "vitest";
import type { SessionActor } from "@clisbot/protocol/session-authorship";
import { BOT_ID_LABEL } from "@clisbot/protocol/bots/labels";
import {
  countWork,
  createWorkFilter,
  isChatSession,
  workItemsOf,
  type WorkQuery,
  type WorkSession,
  type WorkWorkspace,
} from "./work-items";

const HUB = "https://hub.example";
const reader = { origin: HUB, id: "account-me", memberId: "member-me" };
const actor = (id: string): SessionActor => ({ kind: "user", id, hubOrigin: HUB });
const me = actor("account-me");
const teammate = actor("account-teammate");

function workspace(key: string, createdBy?: SessionActor): WorkWorkspace {
  return {
    workspaceKey: `srv:${key}`,
    serverId: "srv",
    workspaceId: key,
    statusBucket: "done",
    createdBy,
  };
}
function session(id: string, input: Partial<WorkSession> = {}): WorkSession {
  return { id, statusBucket: "done", ...input };
}
const bot = { [BOT_ID_LABEL]: "bot_1" };

const query = (input: Partial<WorkQuery> = {}): WorkQuery => ({
  scope: "mine",
  chip: "all",
  accounts: [reader],
  showBots: true,
  ...input,
});

// A shared sandbox: the reader created the workspace, a teammate works in it too.
const sandbox = workspace("sandbox", me);
const teammateWorkspace = workspace("teammate", teammate);
const sessions = new Map<string, WorkSession[]>([
  [
    "srv:sandbox",
    [
      session("mine"),
      session("teammate", { createdBy: teammate }),
      session("bot", { labels: bot }),
    ],
  ],
  ["srv:teammate", [session("teammate-pinned", { createdBy: teammate })]],
  ["srv:bots-only", [session("bot-a", { labels: bot }), session("bot-b", { labels: bot })]],
]);
const sessionsOf = (ws: WorkWorkspace) => sessions.get(ws.workspaceKey) ?? [];

describe("Workspace items", () => {
  it("decides Chat by the session's Bot label only", () => {
    expect(isChatSession({ labels: bot })).toBe(true);
    expect(isChatSession({ labels: {} })).toBe(false);
    expect(isChatSession({ labels: { [BOT_ID_LABEL]: "  " } })).toBe(false);
  });

  it("scopes each session by its own author, not its workspace's (Owner A1)", () => {
    const filter = createWorkFilter(query(), sessionsOf);
    expect(filter.session(session("teammate", { createdBy: teammate }), sandbox)).toBe(false);
    expect(filter.session(session("mine"), sandbox)).toBe(true);
    // A workspace authored by the teammate holding only the teammate's sessions is not For me —
    // pinned or not, the floating pinned rows ask this same filter.
    expect(filter.workspace(teammateWorkspace)).toBe(false);
    expect(
      createWorkFilter(query({ scope: "others" }), sessionsOf).workspace(teammateWorkspace),
    ).toBe(true);
  });

  it("falls back to the workspace author for a session that records none", () => {
    const filter = createWorkFilter(query({ scope: "others" }), sessionsOf);
    expect(filter.session(session("legacy"), teammateWorkspace)).toBe(true);
    expect(filter.session(session("legacy"), sandbox)).toBe(false);
  });

  it("lists Bot sessions by default and hides them, and Bot-only workspaces, with Bots off", () => {
    const botsOnly = workspace("bots-only", me);
    const shown = createWorkFilter(query(), sessionsOf);
    expect(shown.workspace(botsOnly)).toBe(true);
    expect(shown.session(session("bot", { labels: bot }), sandbox)).toBe(true);
    const hidden = createWorkFilter(query({ showBots: false }), sessionsOf);
    expect(hidden.workspace(botsOnly)).toBe(false);
    expect(hidden.session(session("bot", { labels: bot }), sandbox)).toBe(false);
    expect(hidden.workspace(sandbox)).toBe(true);
  });

  it("with Bots hidden, holds a workspace back until its sessions arrive, so nothing flashes", () => {
    expect(workItemsOf(sandbox, null, false)).toEqual([]);
    // With Bots shown (the default) and offline Hosts, the cached workspace stays listed.
    expect(workItemsOf(sandbox, null, true)).toHaveLength(1);
    expect(workItemsOf(sandbox, [], false)).toHaveLength(1);
  });

  it("counts items, so counts follow the scope and the Bots chip", () => {
    const all = [sandbox, teammateWorkspace, workspace("bots-only", me)];
    const shown = countWork(all, sessionsOf, { scope: "mine", accounts: [reader], showBots: true });
    expect(shown.scopes).toEqual({ mine: 4, others: 2, all: 6 });
    const hidden = countWork(all, sessionsOf, {
      scope: "mine",
      accounts: [reader],
      showBots: false,
    });
    expect(hidden.scopes).toEqual({ mine: 1, others: 2, all: 3 });
    expect(hidden.chips.done).toBe(1);
  });
});
