import { describe, expect, it } from "vitest";
import equal from "fast-deep-equal";
import { participationKeyOf } from "@/clisbot/navigation/ownership-key";
import type { Agent } from "@/stores/session-store";
import {
  createAggregatedAgentProjector,
  type AggregatedAgentSources,
} from "./aggregated-agent-projector";
import type { AggregatedAgent } from "./use-aggregated-agents";
import {
  createAgentFleet,
  fleetAgent,
  fleetSource,
  fleetTime,
  fleetUpdates,
  timeReads,
  withAgent,
} from "./agent-fleet-fixture";

/**
 * The projector as it was before it became incremental (2026-10-30): every call re-keyed and
 * re-sorted every session. It is the oracle for order and content, including the order of equal
 * timestamps (Host order of the store, then each Host's Map order).
 */
function createReferenceProjector() {
  let previous = new Map<string, { source: Agent; label: string; projected: AggregatedAgent }>();
  let sorted: AggregatedAgent[] = [];
  return (input: AggregatedAgentSources): AggregatedAgent[] => {
    const labels = new Map(input.hosts.map((host) => [host.serverId, host.label]));
    const next = new Map<string, { source: Agent; label: string; projected: AggregatedAgent }>();
    const agents: AggregatedAgent[] = [];
    for (const [serverId, sources] of Object.entries(input.sessionAgents)) {
      if (!sources) continue;
      const label = labels.get(serverId) ?? serverId;
      for (const source of sources.values()) {
        if (!input.includeArchived && source.archivedAt) continue;
        const key = `${serverId}:${source.id}`;
        let entry = previous.get(key);
        if (!entry || entry.source !== source || entry.label !== label) {
          const projected = referenceProjection(source, serverId, label);
          entry = {
            source,
            label,
            projected: entry && equal(entry.projected, projected) ? entry.projected : projected,
          };
        }
        next.set(key, entry);
        agents.push(entry.projected);
      }
    }
    agents.sort((left, right) => {
      const leftRunning = left.turn.phase === "open";
      if (leftRunning !== (right.turn.phase === "open")) return leftRunning ? -1 : 1;
      return right.lastActivityAt.getTime() - left.lastActivityAt.getTime();
    });
    previous = next;
    const unchanged =
      agents.length === sorted.length && agents.every((agent, index) => agent === sorted[index]);
    if (!unchanged) sorted = agents;
    return sorted;
  };
}

function referenceProjection(source: Agent, serverId: string, label: string): AggregatedAgent {
  return {
    id: source.id,
    serverId,
    serverLabel: label,
    title: source.title ?? null,
    status: source.status,
    turn: source.turn,
    lastActivityAt: source.lastActivityAt,
    cwd: source.cwd,
    workspaceId: source.workspaceId,
    provider: source.provider,
    pendingPermissionCount: source.pendingPermissions.length,
    requiresAttention: source.requiresAttention,
    attentionReason: source.attentionReason,
    attentionTimestamp: source.attentionTimestamp,
    archivedAt: source.archivedAt,
    createdAt: source.createdAt,
    labels: source.labels,
    projectPlacement: source.projectPlacement,
    createdBy: source.createdBy,
    participationKey: participationKeyOf(source),
  };
}

const keysOf = (agents: readonly AggregatedAgent[]) =>
  agents.map((agent) => `${agent.serverId}:${agent.id}`);

/** How many rows of `next` are new objects, and whether the array itself was replaced. */
function churn(previous: readonly AggregatedAgent[], next: readonly AggregatedAgent[]) {
  const kept = new Set(previous);
  return { arrayReplaced: previous !== next, rowsRebuilt: next.filter((a) => !kept.has(a)).length };
}

describe("aggregated agent projection over a company fleet", () => {
  it(
    "orders and projects exactly as the full re-sort did, through every kind of update",
    {
      timeout: 60_000,
    },
    () => {
      for (const includeArchived of [false, true]) {
        const start = { ...createAgentFleet(), includeArchived };
        const project = createAggregatedAgentProjector();
        const reference = createReferenceProjector();
        let actual = project(start);
        let expected = reference(start);
        expect(keysOf(actual)).toEqual(keysOf(expected));
        let step = 0;
        for (const fleet of fleetUpdates(start, 300)) {
          const nextActual = project(fleet);
          const nextExpected = reference(fleet);
          expect(keysOf(nextActual)).toEqual(keysOf(nextExpected));
          if (++step % 50 === 0) expect(equal(nextActual, nextExpected)).toBe(true);
          expect(churn(actual, nextActual)).toEqual(churn(expected, nextExpected));
          actual = nextActual;
          expected = nextExpected;
        }
      }
    },
  );

  it("puts open turns first, then newer activity, with ties in Host then arrival order", () => {
    const at = fleetTime(5);
    const fleet = {
      hosts: [
        { serverId: "b", label: "B" },
        { serverId: "a", label: "A" },
      ],
      includeArchived: false,
      sessionAgents: {
        b: new Map([
          ["z", fleetAgent({ id: "z", serverId: "b", lastActivityAt: at })],
          ["y", fleetAgent({ id: "y", serverId: "b", lastActivityAt: at })],
        ]),
        a: new Map([
          ["x", fleetAgent({ id: "x", serverId: "a", lastActivityAt: at })],
          ["new", fleetAgent({ id: "new", serverId: "a", lastActivityAt: fleetTime(1) })],
          [
            "open",
            fleetAgent({
              id: "open",
              serverId: "a",
              lastActivityAt: fleetTime(9),
              turn: { phase: "open", turnId: "t", startedAt: at, cancellationRequestId: null },
            }),
          ],
        ]),
      },
    };
    expect(keysOf(createAggregatedAgentProjector()(fleet))).toEqual([
      "a:open",
      "a:new",
      "b:z",
      "b:y",
      "a:x",
    ]);
  });
});

describe("work for one session update on a 14-Host fleet", () => {
  function measure(project: (input: AggregatedAgentSources) => AggregatedAgent[]) {
    const fleet = createAgentFleet();
    const before = project(fleet);
    const source = fleetSource(fleet, "host-6", "agent-1600");
    const updated = withAgent(fleet, { ...source, title: "Renamed", lastActivityAt: fleetTime(0) });
    timeReads.count = 0;
    const after = project(updated);
    return { sessions: before.length, timeReads: timeReads.count, ...churn(before, after) };
  }

  it("rebuilds one row and compares O(log n) timestamps instead of re-sorting the fleet", () => {
    const reference = measure(createReferenceProjector());
    const incremental = measure(createAggregatedAgentProjector());
    // Before: every call sorted all ~2,900 shown sessions (~30,000 timestamp reads).
    expect(reference.timeReads).toBeGreaterThan(20_000);
    expect(incremental).toEqual({ ...reference, timeReads: incremental.timeReads });
    expect(incremental.rowsRebuilt).toBe(1);
    expect(incremental.timeReads).toBeLessThanOrEqual(4 * Math.ceil(Math.log2(reference.sessions)));
  });
});
