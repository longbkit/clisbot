import { describe, expect, it, vi } from "vitest";
import { buildContributionSections, type CommandCenterResult } from "@/command-center/results";
import type { HostTagged } from "../data/aggregate";
import type { BotPayload, ChatPayload } from "../data/contracts";
import { buildBotSearchContributions, type BotSearchSource } from "./command-center-contributions";

const HOST = { serverId: "h1", serverName: "Studio" };

function bot(id: string, name: string, description?: string): HostTagged<BotPayload> {
  return {
    ...HOST,
    id,
    slug: id,
    name,
    description,
    projectId: "p",
    workspaceId: "w",
    cwd: `/bots/${id}`,
    kind: "personal",
    launchDefaults: { provider: "mock" },
  } as HostTagged<BotPayload>;
}

function chat(id: string, title: string, botIds: string[], updatedAt: string) {
  return {
    ...HOST,
    id,
    title,
    kind: botIds.length === 1 ? "direct" : "group",
    participants: botIds.map((botId) => ({ botId })),
    createdAt: updatedAt,
    updatedAt,
  } as HostTagged<ChatPayload>;
}

function resultTitle(result: CommandCenterResult): string {
  return result.kind === "contribution" && result.contribution.presentation.kind === "action"
    ? result.contribution.presentation.title
    : "";
}

function source(overrides: Partial<BotSearchSource> = {}): BotSearchSource {
  return {
    bots: [bot("legal", "Chief of Legal", "Owns contracts"), bot("cfo", "CFO")],
    chats: [
      chat("d1", "Chief of Legal", ["legal"], "2026-09-29T01:00:00Z"),
      chat("g1", "Launch room", ["legal", "cfo"], "2026-09-29T02:00:00Z"),
    ],
    multipleHosts: false,
    canCreateBot: true,
    canCreateGroup: true,
    labels: { actions: "Actions" },
    icons: {},
    openBot: vi.fn(),
    openChat: vi.fn(),
    createBot: vi.fn(),
    createGroup: vi.fn(),
    ...overrides,
  };
}

describe("buildBotSearchContributions", () => {
  it("lists bots with their role and group chats with their members, not direct chats", () => {
    const rows = buildBotSearchContributions(source()).map((row) =>
      row.presentation.kind === "action"
        ? [row.group, row.presentation.title, row.presentation.subtitle]
        : [],
    );
    expect(rows).toEqual([
      ["clisbot-bots", "Chief of Legal", "Owns contracts"],
      ["clisbot-bots", "CFO", "No role yet"],
      ["clisbot-group-chats", "Launch room", "Chief of Legal, CFO"],
      ["actions", "New bot", undefined],
      ["actions", "New group chat", undefined],
    ]);
  });

  it("finds a bot by name and a group by a member's name, only for a query", () => {
    const contributions = buildBotSearchContributions(source());
    expect(buildContributionSections(contributions, "")).toEqual([]);
    const titles = (query: string) =>
      buildContributionSections(contributions, query).map((section) => [
        section.title,
        section.results.map(resultTitle),
      ]);
    expect(titles("legal")).toEqual([
      ["Bots", ["Chief of Legal"]],
      ["Group chats", ["Launch room"]],
    ]);
    expect(titles("new bot")[0]).toEqual(["Actions", ["New bot"]]);
  });

  it("opens the bot or the group it names", () => {
    const input = source();
    const [legal, , room] = buildBotSearchContributions(input);
    void legal!.run();
    void room!.run();
    expect(input.openBot).toHaveBeenCalledWith("h1", "legal");
    expect(input.openChat).toHaveBeenCalledWith("h1", "g1");
  });

  it("names the Host only with several, and offers each creation only when it can happen", () => {
    const rows = buildBotSearchContributions(source({ multipleHosts: true, canCreateBot: false }));
    expect(rows.map((row) => row.id)).not.toContain("new-bot");
    expect(rows.map((row) => row.id)).toContain("new-group-chat");
    const noGroup = buildBotSearchContributions(source({ canCreateGroup: false }));
    expect(noGroup.map((row) => row.id)).not.toContain("new-group-chat");
    expect(rows[0]!.presentation.kind === "action" && rows[0]!.presentation.subtitle).toBe(
      "Studio · Owns contracts",
    );
  });
});
