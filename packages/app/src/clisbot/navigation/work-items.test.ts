import { describe, expect, it } from "vitest";
import type { SessionActor } from "@clisbot/protocol/session-authorship";
import { resolveOwnership } from "./ownership";
import { BOT_ID_LABEL } from "@clisbot/protocol/bots/labels";
import {
  countWork,
  createWorkCounter,
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
const hostKinds = new Map([["srv", "hub" as const]]);
const bot = { [BOT_ID_LABEL]: "bot_1" };

const query = (input: Partial<WorkQuery> = {}): WorkQuery => ({
  scope: "mine",
  chip: "all",
  accounts: [reader],
  hostKinds,
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
      session("mine", { createdBy: me }),
      session("teammate", { createdBy: teammate }),
      session("bot", { labels: bot, createdBy: me }),
    ],
  ],
  ["srv:teammate", [session("teammate-pinned", { createdBy: teammate })]],
  [
    "srv:bots-only",
    [
      session("bot-a", { labels: bot, createdBy: me }),
      session("bot-b", { labels: bot, createdBy: me }),
    ],
  ],
]);
const sessionsOf = (ws: WorkWorkspace) => sessions.get(ws.workspaceKey) ?? [];

describe("Workspace items", () => {
  it("requires each session's authorship even inside a workspace the reader created", () => {
    const rows = [
      session("absent"),
      session("local-owner", { createdBy: { kind: "user", id: "owner" } }),
      session("workflow", { createdBy: { kind: "automation", id: "workflow", hubOrigin: HUB } }),
      session("system", {
        createdBy: { kind: "system", id: "channel-approval-policy", hubOrigin: HUB },
      }),
      session("mine", { createdBy: me }),
      session("teammate", { createdBy: teammate }),
      session("linked-channel", {
        createdBy: {
          kind: "user",
          id: "slack:U1",
          hubOrigin: HUB,
          connectionId: "slack",
          memberId: reader.memberId,
        },
      }),
      session("unlinked-channel", {
        createdBy: {
          kind: "user",
          id: "slack:U2",
          hubOrigin: HUB,
          connectionId: "slack",
        },
      }),
    ];
    const list = () => rows;
    const mine = createWorkFilter(query(), list);
    expect(rows.filter((row) => mine.session(row, sandbox)).map((row) => row.id)).toEqual([
      "mine",
      "linked-channel",
    ]);
    expect(countWork([sandbox], list, query()).scopes).toEqual({ mine: 2, others: 6, all: 8 });
    const others = createWorkFilter(query({ scope: "others" }), list);
    expect(rows.filter((row) => others.session(row, sandbox)).map((row) => row.id)).toEqual([
      "absent",
      "local-owner",
      "workflow",
      "system",
      "teammate",
      "unlinked-channel",
    ]);
  });

  it("decides Chat by the session's Bot label only", () => {
    expect(isChatSession({ labels: bot })).toBe(true);
    expect(isChatSession({ labels: {} })).toBe(false);
    expect(isChatSession({ labels: { [BOT_ID_LABEL]: "  " } })).toBe(false);
  });

  it("scopes each session by its own author, not its workspace's (Owner A1)", () => {
    const filter = createWorkFilter(query(), sessionsOf);
    expect(filter.session(session("teammate", { createdBy: teammate }), sandbox)).toBe(false);
    expect(filter.session(session("mine", { createdBy: me }), sandbox)).toBe(true);
    // A workspace authored by the teammate holding only the teammate's sessions is not For me —
    // pinned or not, the floating pinned rows ask this same filter.
    expect(filter.workspace(teammateWorkspace)).toBe(false);
    expect(
      createWorkFilter(query({ scope: "others" }), sessionsOf).workspace(teammateWorkspace),
    ).toBe(true);
  });

  it("does not inherit either workspace author when a session records none", () => {
    const filter = createWorkFilter(query({ scope: "others" }), sessionsOf);
    expect(filter.session(session("legacy"), teammateWorkspace)).toBe(true);
    expect(filter.session(session("legacy"), sandbox)).toBe(true);
  });

  it("lists Bot sessions by default and hides them, and Bot-only workspaces, with Bots off", () => {
    const botsOnly = workspace("bots-only", me);
    const shown = createWorkFilter(query(), sessionsOf);
    expect(shown.workspace(botsOnly)).toBe(true);
    expect(shown.session(session("bot", { labels: bot, createdBy: me }), sandbox)).toBe(true);
    const hidden = createWorkFilter(query({ showBots: false }), sessionsOf);
    expect(hidden.workspace(botsOnly)).toBe(false);
    expect(hidden.session(session("bot", { labels: bot, createdBy: me }), sandbox)).toBe(false);
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
    const shown = countWork(all, sessionsOf, {
      scope: "mine",
      accounts: [reader],
      hostKinds,
      showBots: true,
    });
    expect(shown.scopes).toEqual({ mine: 4, others: 2, all: 6 });
    const hidden = countWork(all, sessionsOf, {
      scope: "mine",
      accounts: [reader],
      hostKinds,
      showBots: false,
    });
    expect(hidden.scopes).toEqual({ mine: 1, others: 2, all: 3 });
    expect(hidden.chips.done).toBe(1);
  });

  it("lists an item whose Hub has no known reader under Others and All", () => {
    const stranger: SessionActor = { kind: "user", id: "u-9", hubOrigin: "https://other.example" };
    const unplaced = workspace("unplaced", stranger);
    const rows = [sandbox, unplaced];
    const none = (ws: WorkWorkspace) =>
      ws === unplaced ? [session("u", { createdBy: stranger })] : [];
    const counts = countWork(rows, none, {
      scope: "mine",
      accounts: [reader],
      hostKinds,
      showBots: true,
    });
    expect(counts.scopes).toEqual({ mine: 1, others: 1, all: 2 });
    for (const [scope, listed] of [
      ["mine", false],
      ["others", true],
      ["all", true],
    ] as const) {
      expect(createWorkFilter(query({ scope }), none).workspace(unplaced)).toBe(listed);
    }
  });
});

describe("incremental Workspace counts", () => {
  it("reuses unchanged workspaces and author classifications, and invalidates changed inputs", () => {
    let resolutions = 0;
    const resolve = (input: Parameters<typeof resolveOwnership>[0]) => {
      resolutions += 1;
      return resolveOwnership(input);
    };
    const counter = createWorkCounter(resolve);
    const accounts = [reader];
    const first = workspace("first", me);
    const second = workspace("second", { ...me });
    let firstSessions = [session("a", { statusBucket: "running", createdBy: me })];
    let secondSessions = [session("b", { statusBucket: "done", createdBy: { ...me } })];
    const read = (ws: WorkWorkspace) =>
      ws.workspaceId === "first" ? firstSessions : secondSessions;
    const options = { scope: "mine" as const, accounts, hostKinds, showBots: true };
    const expected = () => countWork([first, second], read, options);

    const initial = counter([first, second], read, options);
    expect(initial).toEqual(expected());
    expect(resolutions).toBe(1); // Equivalent author snapshots share one classification.
    firstSessions = firstSessions.map((item) => Object.assign({}, item));
    secondSessions = secondSessions.map((item) => Object.assign({}, item));
    expect(counter([first, second], read, options)).toBe(initial);
    expect(resolutions).toBe(1);

    secondSessions = [session("b", { statusBucket: "failed", createdBy: teammate })];
    expect(counter([first, second], read, options)).toEqual(expected());
    expect(resolutions).toBe(2);
    const changedReaders = { ...options, accounts: [{ ...reader, id: "other" }] };
    expect(counter([first, second], read, changedReaders)).toEqual(
      countWork([first, second], read, changedReaders),
    );
    expect(resolutions).toBe(4);

    const botsHidden = { ...changedReaders, showBots: false };
    firstSessions = [session("bot", { labels: bot })];
    expect(counter([first, second], read, botsHidden)).toEqual(
      countWork([first, second], read, botsHidden),
    );
    const offline = { ...botsHidden, cachedServerIds: new Set(["srv"]) };
    expect(counter([first, second], read, offline)).toEqual(
      countWork([first, second], read, offline),
    );
    expect(counter([first], read, offline)).toEqual(countWork([first], read, offline));
  });
});
