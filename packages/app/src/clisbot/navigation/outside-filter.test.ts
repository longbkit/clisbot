import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OutsideFilterReveal } from "@/clisbot/search-scope/work-navigation";
import { useSidebarViewStore } from "@/stores/sidebar-view-store";
import { chatReveal, listOfReveal, revealStillHidden, switchLabelOf } from "./outside-filter";
import { showAllFor, switchTo } from "./outside-filter-actions";
import { resolveDirectChatOwnership } from "./ownership";
import { useNavigationStore } from "./store";

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} },
}));

const hostReveal: OutsideFilterReveal = {
  itemKind: "session",
  serverId: "b",
  hostLabel: "Host B",
  projectName: "clisbot",
  projectViewKeys: ["view:clisbot"],
  reason: "host",
  target: { kind: "workspace", serverId: "b", id: "wb" },
};

beforeEach(() => {
  useSidebarViewStore.setState({ hostFilters: ["a"], projectFilters: ["view:other"] });
  useNavigationStore.setState({
    scopes: { home: "mine", chats: "mine", work: "mine" },
  });
});

describe("the outside-filter notice (R3)", () => {
  it("belongs to Work for sessions and workspaces, to Chats for chats", () => {
    expect(listOfReveal(hostReveal)).toBe("work");
    expect(listOfReveal({ ...hostReveal, itemKind: "chat" })).toBe("chats");
  });

  it("holds while the filter still hides the item, and goes once it no longer does", () => {
    const work = { serverIds: ["a"], projectViewKeys: [], scope: "mine" as const };
    expect(revealStillHidden(hostReveal, work)).toBe(true);
    expect(revealStillHidden(hostReveal, { ...work, serverIds: [] })).toBe(false);
    expect(revealStillHidden(hostReveal, { ...work, serverIds: ["a", "b"] })).toBe(false);
    const project = { ...hostReveal, reason: "project" as const };
    expect(revealStillHidden(project, { ...work, projectViewKeys: ["view:other"] })).toBe(true);
    expect(revealStillHidden(project, { ...work, projectViewKeys: ["view:clisbot"] })).toBe(false);
    const others = { ...hostReveal, reason: "others" as const };
    expect(revealStillHidden(others, work)).toBe(true);
    expect(revealStillHidden(others, { ...work, scope: "all" })).toBe(false);
  });

  it("Show all clears only the hiding dimension; Switch replaces it", () => {
    showAllFor(hostReveal, "work");
    expect(useSidebarViewStore.getState()).toMatchObject({
      hostFilters: [],
      projectFilters: ["view:other"],
    });
    useSidebarViewStore.setState({ hostFilters: ["a"] });
    switchTo(hostReveal, "work");
    expect(useSidebarViewStore.getState().hostFilters).toEqual(["b"]);
    switchTo({ ...hostReveal, reason: "project" }, "work");
    expect(useSidebarViewStore.getState().projectFilters).toEqual(["view:clisbot"]);
  });

  it("Shown from Others: Show all widens the scope and offers no Switch", () => {
    const others = { ...hostReveal, reason: "others" as const };
    expect(switchLabelOf(others)).toBeNull();
    expect(switchLabelOf(hostReveal)).toBe("Host B");
    showAllFor(others, "work");
    expect(useNavigationStore.getState().scopes.work).toBe("all");
    expect(useNavigationStore.getState().scopes.chats).toBe("mine");
  });

  it("Chats: the app-wide Host filter, and its own scope", () => {
    const chat = { ...hostReveal, itemKind: "chat" as const };
    switchTo(chat, "chats");
    expect(useSidebarViewStore.getState().hostFilters).toEqual(["b"]);
    showAllFor(chat, "chats");
    expect(useSidebarViewStore.getState().hostFilters).toEqual([]);
    // Workspace's Project filter is not a Chats dimension.
    expect(useSidebarViewStore.getState().projectFilters).toEqual(["view:other"]);
  });
});

describe("a chat opened from search", () => {
  const target = { kind: "chat" as const, serverId: "b", id: "c1" };
  const base = { serverId: "b", hostLabel: "Host B", target };

  it("publishes nothing when Chats shows it", () => {
    expect(chatReveal({ ...base, ownership: "mine" }, { serverIds: [], scope: "mine" })).toBeNull();
    expect(
      chatReveal({ ...base, ownership: "others" }, { serverIds: [], scope: "all" }),
    ).toBeNull();
  });

  it("names the Host filter first, then For me / Others", () => {
    expect(
      chatReveal({ ...base, ownership: "others" }, { serverIds: ["a"], scope: "mine" }),
    ).toMatchObject({ itemKind: "chat", reason: "host", target });
    expect(
      chatReveal({ ...base, ownership: "others" }, { serverIds: [], scope: "mine" }),
    ).toMatchObject({ reason: "others" });
  });

  it("a Bot's direct chat is the chat's author's, else the Bot owner's", () => {
    const accounts = [{ origin: "https://hub", id: "me", memberId: "m-me" }];
    const other = {
      kind: "user" as const,
      id: "someone",
      displayName: "Someone",
      hubOrigin: "https://hub",
      memberId: "m-someone",
    };
    expect(
      resolveDirectChatOwnership({ bot: { isOwner: false } }, { accounts, hostKind: "direct" }),
    ).toBe("others");
    expect(
      resolveDirectChatOwnership({ bot: { isOwner: true } }, { accounts, hostKind: "direct" }),
    ).toBe("mine");
    expect(
      resolveDirectChatOwnership(
        { directChat: { createdBy: other }, bot: { isOwner: true } },
        { accounts, hostKind: "hub" },
      ),
    ).toBe("others");
  });
});
