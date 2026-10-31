import { describe, expect, it } from "vitest";
import { buildSearchScopeCatalog, type ScopeHostInput } from "./catalog";
import type { SearchViewContext } from "./candidates";
import { annotateItem } from "./item-notes";
import { hiddenBy, rankItemsByView, type ItemPlacement } from "./items";
import type { ScopeT } from "./rows";
import { resolveViewContext } from "./view-context";
import { revealEndsOnPath, revealTargetOfPath, type OutsideFilterReveal } from "./work-navigation";

/** Search over Navigation V2: For me / Others ranking, Work's published filter, reveal pages. */

const t: ScopeT = (key, options) => (options ? `${key}${JSON.stringify(options)}` : key);
const formatTime = (iso: string) => iso.slice(11, 16);

function host(serverId: string, label: string): ScopeHostInput {
  return {
    serverId,
    label,
    local: false,
    hubOrigin: null,
    hubName: null,
    hostnames: [],
    status: "online",
    lastOnlineAt: null,
  };
}

const catalog = buildSearchScopeCatalog({
  hosts: [host("a", "Host A"), host("b", "Host B")],
  projects: [
    {
      viewKey: "view:clisbot",
      serverId: "a",
      projectName: "clisbot",
      customName: null,
      repoRoot: "/r/clisbot",
      workspaceIds: ["wa"],
    },
    {
      viewKey: "view:clisbot",
      serverId: "b",
      projectName: "clisbot",
      customName: null,
      repoRoot: "/r/clisbot",
      workspaceIds: ["wb"],
    },
  ],
  agents: [],
});

const place = (
  serverId: string,
  ownership: ItemPlacement["ownership"],
  workspaceId: string | null = null,
): ItemPlacement => ({ serverId, projectKey: "clisbot", workspaceId, ownership });

const filter = (input: Partial<SearchViewContext>): SearchViewContext => ({
  label: "",
  serverIds: null,
  projectKeys: null,
  ownership: null,
  suggest: true,
  ...input,
});

describe("For me / Others in search", () => {
  it("keeps unproven ownership inside For me and All, outside Others", () => {
    expect(hiddenBy(filter({ ownership: "mine" }), place("a", "unknown"))).toBeNull();
    expect(hiddenBy(filter({ ownership: "all" }), place("a", "unknown"))).toBeNull();
    expect(hiddenBy(filter({ ownership: "others" }), place("a", "unknown"))).toBe("others");
    const rows = [
      { id: "others", ...place("a", "others") },
      { id: "unknown", ...place("a", "unknown") },
    ];
    expect(rankItemsByView(rows, null, (row) => row).map((row) => row.id)).toEqual([
      "unknown",
      "others",
    ]);
  });

  it("ranks For me before Others inside the view, then the same outside it", () => {
    const rows = [
      { id: "b-others", ...place("b", "others") },
      { id: "a-others", ...place("a", "others") },
      { id: "b-mine", ...place("b", "mine") },
      { id: "a-mine", ...place("a", "mine") },
    ];
    const view = filter({ serverIds: new Set(["a"]), ownership: "all" });
    expect(rankItemsByView(rows, view, (row) => row).map((row) => row.id)).toEqual([
      "a-mine",
      "a-others",
      "b-mine",
      "b-others",
    ]);
    // With no filter at all, For me still comes first.
    expect(rankItemsByView(rows, null, (row) => row).map((row) => row.id)).toEqual([
      "b-mine",
      "a-mine",
      "b-others",
      "a-others",
    ]);
  });

  it("labels Others, and with Work on For me opening one publishes reason others", () => {
    const view = filter({ ownership: "mine" });
    expect(hiddenBy(view, place("a", "others"))).toBe("others");
    expect(hiddenBy(filter({ ownership: "all" }), place("a", "others"))).toBeNull();
    const annotation = annotateItem({
      itemKind: "session",
      placement: place("a", "others", "wa"),
      catalog,
      view,
      t,
      formatTime,
    });
    expect(annotation.note).toBe("note.others");
    expect(annotation.reveal).toMatchObject({
      reason: "others",
      target: { kind: "workspace", serverId: "a", id: "wa" },
    });
  });

  it("names the Host before the scope when both hide the item", () => {
    const view = filter({ serverIds: new Set(["a"]), ownership: "mine" });
    expect(hiddenBy(view, place("b", "others"))).toBe("host");
    expect(
      annotateItem({
        itemKind: "workspace",
        placement: place("b", "others", "wb"),
        catalog,
        view,
        t,
        formatTime,
      }).note,
    ).toBe("note.outsideFilter · note.others");
  });

  it("an Others item with no filter is labelled but publishes nothing", () => {
    const annotation = annotateItem({
      itemKind: "session",
      placement: place("a", "others"),
      catalog,
      view: null,
      t,
      formatTime,
    });
    expect(annotation).toEqual({ note: "note.others", reveal: null });
  });
});

describe("Work's published filter", () => {
  it("resolves Host ids, project view keys and the scope", () => {
    expect(
      resolveViewContext(
        { serverIds: ["a"], projectViewKeys: ["view:clisbot"], ownership: "mine", suggest: false },
        catalog,
      ),
    ).toEqual({
      label: "Host A · clisbot",
      serverIds: new Set(["a"]),
      projectKeys: new Set(["clisbot"]),
      ownership: "mine",
      suggest: false,
    });
  });

  it("drops Hosts and projects the reader cannot see, and an unfiltered All", () => {
    expect(resolveViewContext({ serverIds: ["gone"], ownership: "all" }, catalog)).toBeNull();
    expect(resolveViewContext({ projectViewKeys: ["view:gone"] }, catalog)).toBeNull();
    expect(resolveViewContext({ ownership: "others" }, catalog)?.ownership).toBe("others");
  });
});

describe("the reveal ends when another item opens", () => {
  const reveal: OutsideFilterReveal = {
    itemKind: "workspace",
    serverId: "b",
    hostLabel: "Host B",
    projectName: null,
    projectViewKeys: [],
    reason: "host",
    target: { kind: "workspace", serverId: "b", id: "wb" },
  };

  it("reads workspace, chat and bot pages", () => {
    expect(revealTargetOfPath("/h/b/workspace/wb")).toEqual({
      kind: "workspace",
      serverId: "b",
      id: "wb",
    });
    expect(revealTargetOfPath("/h/b/chat/c1")).toEqual({ kind: "chat", serverId: "b", id: "c1" });
    expect(revealTargetOfPath("/h/b/bot/bot%201")).toEqual({
      kind: "bot",
      serverId: "b",
      id: "bot 1",
    });
    expect(revealTargetOfPath("/work")).toBeNull();
  });

  it("holds on its own page, its aliases and list pages; ends on another item", () => {
    expect(revealEndsOnPath(reveal, "/h/b/workspace/wb")).toBe(false);
    expect(revealEndsOnPath(reveal, "/work")).toBe(false);
    expect(revealEndsOnPath(reveal, "/open-project")).toBe(false);
    expect(revealEndsOnPath(reveal, "/h/b/workspace/other")).toBe(true);
    expect(revealEndsOnPath(reveal, "/h/a/chat/c1")).toBe(true);
    const bot = {
      ...reveal,
      itemKind: "chat" as const,
      target: { kind: "chat" as const, serverId: "b", id: "dm" },
      alsoTargets: [{ kind: "bot" as const, serverId: "b", id: "helper" }],
    };
    expect(revealEndsOnPath(bot, "/h/b/bot/helper")).toBe(false);
    // A session with no page of its own ends at the first item page.
    expect(revealEndsOnPath({ ...reveal, target: null }, "/h/b/workspace/wb")).toBe(true);
  });
});
