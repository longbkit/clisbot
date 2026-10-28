import { describe, expect, it } from "vitest";
import type { SessionAuthorship } from "@clisbot/protocol/session-authorship";
import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";
import type { ChatPayload } from "@/clisbot/bots/data/contracts";
import { buildHomeFeed, homeBadgeCount, homeRows } from "./home-feed";
import { observeIssues } from "./issues";
import { chatScopeCounts, orderChatList } from "./chat-list";
import { chatOwnershipEvidence } from "./chat-ownership";
import { splitPinTags } from "./pin-tags-model";
import { countWork, createWorkFilter } from "./work-items";
import { hiddenBy } from "../search-scope/items";
import { participationKeyOf } from "./ownership-key";
import { resolveOwnership, type OwnershipHostKind, type OwnershipScope } from "./ownership";

const own = { kind: "user" as const, id: "me", hubOrigin: "https://hub", memberId: "member-me" };
const other = { ...own, id: "other", memberId: "member-other" };
const accounts = [{ origin: "https://hub", id: own.id, memberId: own.memberId }];
const fixture: Record<string, SessionAuthorship> = {
  absent: {},
  local: { createdBy: { kind: "user", id: "owner" } },
  automation: { createdBy: { kind: "automation", id: "workflow" } },
  system: { createdBy: { kind: "system", id: "system" } },
  mine: { createdBy: own },
  other: { createdBy: other },
  linked: { createdBy: { ...own, id: "slack:U1", connectionId: "slack" } },
  unlinked: { createdBy: { ...own, memberId: undefined, connectionId: "slack" } },
  participated: { lastMessageBy: own, participantActors: [own] },
  "other-participated": { createdBy: other, participantActors: [own] },
  "interaction-only": { lastInteractionBy: own },
};
const now = Date.parse("2026-10-28T00:00:00Z");
const scopes: OwnershipScope[] = ["mine", "others", "all"];

describe.each<OwnershipHostKind>(["hub", "direct", "unknown"])(
  "ownership across consumers on %s",
  (hostKind) => {
    const expectedMine = { hub: 4, direct: 9, unknown: 0 }[hostKind];
    const expected = { mine: expectedMine, others: 11 - expectedMine, all: 11 };
    const context = { accounts, hostKind };
    const agents = Object.entries(fixture).map(
      ([id, source]) =>
        ({
          id,
          serverId: "host",
          workspaceId: "reader-workspace",
          serverLabel: "Host",
          title: id,
          createdBy: source.createdBy,
          participationKey: participationKeyOf(source),
          provider: "codex",
          labels: {},
          cwd: "/fixture",
          status: "error",
          turn: { phase: "idle", cancellationRequestId: null },
          createdAt: new Date(now - 1000),
          lastActivityAt: new Date(now - 1000),
          requiresAttention: true,
          attentionReason: "error",
          attentionTimestamp: new Date(now - 1000),
        }) as AggregatedAgent,
    );
    const owner = (agent: AggregatedAgent) =>
      resolveOwnership({
        ...context,
        createdBy: agent.createdBy,
        participationKey: agent.participationKey,
      });
    const ownerships = agents.map(owner);

    it("Home list, tab counts and badge use the same evidence", () => {
      const rows = homeRows({
        agents,
        ownershipOf: owner,
        records: observeIssues({}, agents, now),
        now,
      });
      for (const scope of scopes) {
        const feed = buildHomeFeed(rows, { scope, mode: "hybrid", chip: "all", serverIds: [] });
        expect(feed.scopeCounts).toEqual(expected);
        expect(feed.visible).toHaveLength(expected[scope]);
      }
      expect(homeBadgeCount(rows)).toBe(expectedMine);
    });

    it("Chats never inherits a session creator as participation in a creatorless chat", () => {
      const entries = agents.map((agent, index) => ({
        key: agent.id,
        title: agent.id,
        serverId: "host",
        kind: "group" as const,
        ownership: ownerships[index],
        unread: false,
        company: true,
        pinned: true,
      }));
      expect(chatScopeCounts(entries)).toEqual(expected);
      for (const scope of scopes)
        expect(orderChatList({ entries, scope, chip: "all", search: "" })).toHaveLength(
          expected[scope],
        );
      const chat = { participants: [{ agentId: "child", botId: "bot" }] } as ChatPayload;
      const source = new Map([["child", { createdBy: own }]]);
      expect(resolveOwnership({ ...chatOwnershipEvidence(chat, source), ...context })).toBe(
        hostKind === "direct" ? "mine" : "unknown",
      );
      source.set("child", { ...fixture.participated, createdBy: own });
      expect(resolveOwnership({ ...chatOwnershipEvidence(chat, source), ...context })).toBe(
        hostKind === "unknown" ? "unknown" : "mine",
      );
      const authored = { ...chat, record: { createdBy: other } } as ChatPayload;
      expect(resolveOwnership({ ...chatOwnershipEvidence(authored, source), ...context })).toBe(
        hostKind === "unknown" ? "unknown" : "mine",
      );
    });

    it("Workspace visibility and counts agree inside a reader-created workspace", () => {
      const workspace = {
        workspaceKey: "host:ws",
        workspaceId: "ws",
        serverId: "host",
        createdBy: own,
        statusBucket: "failed",
      };
      const sessions = agents.map((agent) => ({ ...agent, statusBucket: "failed" }));
      for (const scope of scopes) {
        const query = {
          accounts,
          hostKinds: new Map([["host", hostKind]]),
          scope,
          chip: "all" as const,
          showBots: true,
        };
        const filter = createWorkFilter(query, () => sessions);
        expect(countWork([workspace], () => sessions, query).scopes).toEqual(expected);
        expect(sessions.filter((session) => filter.session(session, workspace))).toHaveLength(
          expected[scope],
        );
        expect(filter.workspace(workspace)).toBe(expected[scope] > 0);
      }
    });

    it("Pins partition every item and search admits exactly the same scopes", () => {
      const tags = agents.map((agent, index) => ({
        key: agent.id,
        title: agent.id,
        area: "work" as const,
        ownership: ownerships[index],
      }));
      const pins = splitPinTags(tags, "hybrid");
      expect(pins.mine).toHaveLength(expected.mine);
      expect(pins.others).toHaveLength(expected.others);
      expect(pins.mine.length + pins.others.length).toBe(expected.all);
      for (const scope of scopes) {
        const shown = tags.filter(
          (tag) =>
            !hiddenBy(
              { label: "", suggest: true, serverIds: null, projectKeys: null, ownership: scope },
              {
                serverId: "host",
                projectKey: null,
                workspaceId: "reader-workspace",
                ownership: tag.ownership,
              },
            ),
        );
        expect(shown).toHaveLength(expected[scope]);
      }
    });
  },
);
