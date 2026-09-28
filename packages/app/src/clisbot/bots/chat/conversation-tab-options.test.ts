import { describe, expect, it } from "vitest";
import { buildConversationTabOptions, filterConversationTabs } from "./conversation-tab-options";

const tabs: Parameters<typeof buildConversationTabOptions>[0] = [
  {
    createdAt: 0,
    tabId: "messages",
    key: "messages",
    kind: "conversation",
    target: { kind: "conversation", chatId: "chat" },
  },
  ...["cto", "designer"].map((workspaceId) => ({
    createdAt: 0,
    tabId: workspaceId,
    key: workspaceId,
    kind: "file" as const,
    target: {
      kind: "file" as const,
      path: "docs/SOUL.md",
      workspaceContext: { serverId: "host", workspaceId },
    },
  })),
];
const labels = new Map([
  [JSON.stringify(["host", "cto"]), "CTO"],
  [JSON.stringify(["host", "designer"]), "Designer"],
]);

describe("conversation tab search", () => {
  const options = buildConversationTabOptions(tabs, labels, true);
  it("preserves tab IDs and distinguishes the same path from different bot projects", () => {
    expect(options.map(({ id, label, description }) => ({ id, label, description }))).toEqual([
      { id: "messages", label: "Messages", description: "Group conversation" },
      { id: "cto", label: "SOUL.md", description: "CTO · docs/" },
      { id: "designer", label: "SOUL.md", description: "Designer · docs/" },
    ]);
  });
  it("omits repeated bot names in DMs while retaining folder disambiguation", () => {
    const dm = buildConversationTabOptions(tabs.slice(0, 2), labels, false);
    expect(dm.map((tab) => tab.description)).toEqual([undefined, "docs/"]);
    const rootFile = {
      ...tabs[1]!,
      target: {
        kind: "file" as const,
        path: "BOOTSTRAP.md",
        workspaceContext: { serverId: "host", workspaceId: "cto" },
      },
    };
    expect(buildConversationTabOptions([rootFile], labels, false)[0]?.description).toBeUndefined();
    expect(buildConversationTabOptions([rootFile], labels, true)[0]?.description).toBe("CTO");
  });
  it("keeps the group context for Messages even with one participant", () => {
    expect(buildConversationTabOptions(tabs.slice(0, 1), new Map(), true)[0]?.description).toBe(
      "Group conversation",
    );
  });
  it("searches by file, path and source, ignoring case and surrounding whitespace", () => {
    expect(filterConversationTabs(options, "  cTo ").map((tab) => tab.id)).toEqual(["cto"]);
    expect(filterConversationTabs(options, "docs/")).toHaveLength(2);
    expect(filterConversationTabs(options, "soul.MD")).toHaveLength(2);
    expect(filterConversationTabs(options, "messages").map((tab) => tab.id)).toEqual(["messages"]);
    expect(filterConversationTabs(options, "missing")).toEqual([]);
    expect(filterConversationTabs(options, " ")).toEqual(options);
  });
});
