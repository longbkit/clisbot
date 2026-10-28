import { describe, expect, it } from "vitest";
import type { SessionActor, SessionAuthorship } from "@clisbot/protocol/session-authorship";
import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";
import type { ChatPayload } from "@/clisbot/bots/data/contracts";
import { hiddenBy } from "../search-scope/items";
import { chatScopeCounts, orderChatList } from "./chat-list";
import { chatOwnershipEvidence } from "./chat-ownership";
import { buildHomeFeed, homeBadgeCount, homeRows } from "./home-feed";
import { observeIssues } from "./issues";
import {
  countByScope,
  createOwnershipResolver,
  inScope,
  resolveOwnership,
  type OwnershipHostKind,
  type OwnershipScope,
  type ReaderAccount,
} from "./ownership";
import { participationKeyOf } from "./ownership-key";
import { splitPinTags } from "./pin-tags-model";
import { countWork, createWorkCounter, createWorkFilter } from "./work-items";

const seeds = [0x109, 0x22371, 0xabcdef];
const hostKinds: OwnershipHostKind[] = ["hub", "direct", "unknown"];
const scopes: OwnershipScope[] = ["mine", "others", "all"];
const now = Date.parse("2026-10-28T00:00:00Z");
const own: SessionActor = {
  kind: "user",
  id: "reader-a",
  memberId: "member-a",
  hubOrigin: "https://hub.example",
  hubIdentity: "hub-a",
};
const other: SessionActor = { ...own, id: "reader-b", memberId: "member-b" };
const readers: readonly (readonly ReaderAccount[])[] = [
  [{ origin: own.hubOrigin!, id: own.id, memberId: own.memberId, hubId: own.hubIdentity }],
  [{ origin: other.hubOrigin!, id: other.id, memberId: other.memberId, hubId: other.hubIdentity }],
  [],
];
const actors: readonly (SessionActor | undefined)[] = [
  undefined,
  { kind: "user", id: "owner" },
  { kind: "automation", id: "schedule" },
  { kind: "system", id: "system" },
  own,
  other,
  { ...own, id: "channel-user-a", connectionId: "connection-a" },
  { ...other, id: "channel-user-b", connectionId: "connection-a" },
  { ...own, memberId: undefined, connectionId: "connection-a" },
  { ...own, memberId: undefined },
  { ...own, hubIdentity: undefined, hubOrigin: "https://HUB.example:443/" },
  { ...own, hubIdentity: "another-hub", hubOrigin: "https://another.example" },
  { ...own, memberId: other.memberId },
];

/** Fixed seeds make every generated failure reproducible without an extra dependency. */
function generated(seed: number, size = 128): SessionAuthorship[] {
  let state = seed;
  const next = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
  const actor = () => actors[next() % actors.length];
  return Array.from({ length: size }, () => ({
    createdBy: actor(),
    lastMessageBy: actor(),
    lastInteractionBy: actor(),
    participantActors: Array.from({ length: next() % 5 }, actor).filter(
      (value): value is SessionActor => value !== undefined,
    ),
  }));
}

function agentOf(source: SessionAuthorship, index: number): AggregatedAgent {
  return {
    id: `session-${index}`,
    serverId: "host",
    workspaceId: `workspace-${index}`,
    serverLabel: "Fixture Host",
    title: `Fixture ${index}`,
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
  } as AggregatedAgent;
}

function sorted(values: readonly string[]) {
  return [...values].sort();
}

describe.each(seeds)("ownership properties, seed %i", (seed) => {
  const sources = generated(seed);
  const agents = sources.map(agentOf);

  it.each(hostKinds)("partitions the same session IDs on every consumer, Host %s", (hostKind) => {
    const countCached = createWorkCounter();
    for (const accounts of readers) {
      const context = { accounts, hostKind };
      const owner = (agent: AggregatedAgent) =>
        resolveOwnership({
          createdBy: agent.createdBy,
          participationKey: agent.participationKey,
          ...context,
        });
      const ownerships = agents.map(owner);
      const counts = countByScope(ownerships);
      expect(counts.mine + counts.others).toBe(counts.all);
      expect(counts.all).toBe(sources.length);
      expect(
        ownerships.filter((value) => value === "unknown").every((value) => !inScope("mine", value)),
      ).toBe(true);

      const rows = homeRows({
        agents,
        ownershipOf: owner,
        records: observeIssues({}, agents, now),
        now,
      });
      const entries = agents.map((agent, index) => {
        // Compare the Chat evidence adapter, not just a precomputed ownership on the row.
        const chat = {
          record: { createdBy: sources[index].createdBy },
          participants: [{ agentId: agent.id, botId: "bot" }],
        } as ChatPayload;
        const ownership = resolveOwnership({
          ...chatOwnershipEvidence(chat, new Map([[agent.id, sources[index]]])),
          ...context,
        });
        expect(ownership).toBe(ownerships[index]);
        return {
          key: agent.id,
          title: agent.title!,
          serverId: "host",
          kind: "group" as const,
          ownership,
          unread: false,
          company: true,
          pinned: true,
        };
      });
      const workspaces = agents.map((agent) => ({
        workspaceKey: agent.workspaceId!,
        workspaceId: agent.workspaceId!,
        serverId: "host",
        // A parent author must never change a session's own classification.
        createdBy: accounts === readers[0] ? own : other,
        statusBucket: "failed",
      }));
      const sessions = agents.map((agent) => ({ ...agent, statusBucket: "failed" }));
      const sessionsByWorkspace = new Map(
        workspaces.map((workspace, index) => [workspace.workspaceId, [sessions[index]]]),
      );
      const sessionsOf = (workspace: { workspaceId: string }) =>
        sessionsByWorkspace.get(workspace.workspaceId)!;
      const tags = entries.map((entry) => ({ ...entry, area: "work" as const }));
      const pins = splitPinTags(tags, "hybrid");
      expect(chatScopeCounts(entries)).toEqual(counts);
      expect(homeBadgeCount(rows)).toBe(counts.mine);
      expect(pins.mine.length + pins.others.length).toBe(counts.all);

      for (const scope of scopes) {
        const expectedIds = sorted(
          agents.filter((agent) => inScope(scope, owner(agent))).map((agent) => agent.id),
        );
        const feed = buildHomeFeed(rows, { scope, mode: "hybrid", chip: "all", serverIds: [] });
        expect(feed.scopeCounts).toEqual(counts);
        expect(sorted(feed.visible.map(({ row }) => row.agent.id))).toEqual(expectedIds);
        expect(
          sorted(
            orderChatList({ entries, scope, chip: "all", search: "" }).map((entry) => entry.key),
          ),
        ).toEqual(expectedIds);
        const query = {
          ...context,
          hostKinds: new Map([["host", hostKind]]),
          scope,
          chip: "all" as const,
          showBots: true,
        };
        const filter = createWorkFilter(query, sessionsOf);
        expect(countWork(workspaces, sessionsOf, query).scopes).toEqual(counts);
        expect(countCached(workspaces, sessionsOf, query).scopes).toEqual(counts);
        expect(
          sorted(
            sessions
              .filter((session) => filter.session(session, { serverId: "host" }))
              .map((session) => session.id),
          ),
        ).toEqual(expectedIds);
        expect(workspaces.filter(filter.workspace)).toHaveLength(counts[scope]);
        const scopedPins = scope === "all" ? [...pins.mine, ...pins.others] : pins[scope];
        expect(sorted(scopedPins.map((tag) => tag.key))).toEqual(expectedIds);
        expect(
          sorted(
            tags
              .filter(
                (tag) =>
                  !hiddenBy(
                    {
                      label: "",
                      suggest: true,
                      serverIds: null,
                      projectKeys: null,
                      ownership: scope,
                    },
                    {
                      serverId: "host",
                      projectKey: null,
                      workspaceId: null,
                      ownership: tag.ownership,
                    },
                  ),
              )
              .map((tag) => tag.key),
          ),
        ).toEqual(expectedIds);
      }
    }
  });

  it.each([true, false])(
    "reader and Host changes cannot reuse stale ownership, direct legacy %s",
    (keepLegacy) => {
      const cached = createOwnershipResolver(keepLegacy);
      const inputs = [];
      for (const source of sources) {
        for (const hostKind of hostKinds) {
          for (const accounts of readers)
            inputs.push({
              createdBy: source.createdBy,
              participationKey: participationKeyOf(source),
              accounts,
              hostKind,
            });
        }
      }
      // Cross the 2048-entry bound; then revisit in reverse order, including A -> B -> A readers.
      const churn = generated(seed + 1, 2200).map((source, index) => ({
        createdBy: { ...own, id: `generated-${index}`, memberId: `member-${index}` },
        participationKey: participationKeyOf(source),
        accounts: readers[index % readers.length],
        hostKind: hostKinds[index % hostKinds.length],
      }));
      for (const input of [...inputs, ...churn, ...inputs.toReversed()]) {
        const actual = cached(input);
        expect(actual).toBe(createOwnershipResolver(keepLegacy)(input));
        const counts = countByScope([actual]);
        expect(counts.mine + counts.others).toBe(counts.all);
        if (actual === "unknown") {
          expect(inScope("mine", actual)).toBe(false);
          expect(inScope("others", actual)).toBe(true);
        }
        if (input.hostKind === "unknown") expect(actual).toBe("unknown");
      }
      for (const actor of [own, other]) {
        const input = { createdBy: actor, hostKind: "hub" as const };
        expect(cached({ ...input, accounts: readers[0] })).toBe(actor === own ? "mine" : "others");
        expect(cached({ ...input, accounts: readers[1] })).toBe(
          actor === other ? "mine" : "others",
        );
        expect(cached({ ...input, accounts: readers[0] })).toBe(actor === own ? "mine" : "others");
      }
    },
  );

  it("includes the union of verified creators and participants, independent of profile edits", () => {
    for (const source of sources) {
      for (const accounts of readers) {
        const context = { accounts, hostKind: "hub" as const };
        const creator = resolveOwnership({ createdBy: source.createdBy, ...context });
        const participants = [source.lastMessageBy, ...(source.participantActors ?? [])];
        const matched = participants.some(
          (actor) => actor && resolveOwnership({ createdBy: actor, ...context }) === "mine",
        );
        const expected = creator === "mine" || matched ? "mine" : creator;
        const participationKey = participationKeyOf(source);
        expect(
          resolveOwnership({ ...context, createdBy: source.createdBy, participationKey }),
        ).toBe(expected);
        const renamed = {
          ...source,
          createdBy: source.createdBy && { ...source.createdBy, displayName: "Edited creator" },
          lastMessageBy: source.lastMessageBy && {
            ...source.lastMessageBy,
            displayName: "Edited sender",
          },
          participantActors: source.participantActors?.map((actor) =>
            Object.assign({}, actor, { avatarUrl: "https://example.invalid/avatar" }),
          ),
        };
        expect(participationKeyOf(renamed)).toBe(participationKey);
        expect(
          resolveOwnership({
            ...context,
            createdBy: renamed.createdBy,
            participationKey: participationKeyOf(renamed),
          }),
        ).toBe(expected);
        if (expected === "unknown") {
          expect(inScope("mine", expected)).toBe(false);
          expect(inScope("others", expected)).toBe(true);
          expect(inScope("all", expected)).toBe(true);
        }
      }
    }
  });
});
