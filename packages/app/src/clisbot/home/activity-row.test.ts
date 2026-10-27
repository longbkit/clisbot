import { describe, expect, it } from "vitest";
import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";
import { asCachedAgent } from "@/clisbot/navigation/source-liveness";
import { heldActivityStatus } from "./activity-row";

const running = {
  id: "r",
  serverId: "h1",
  status: "running",
  turn: { phase: "open", turnId: "t", startedAt: new Date(), cancellationRequestId: null },
  lastActivityAt: new Date(),
  archivedAt: null,
} as unknown as AggregatedAgent;

describe("a held Home row", () => {
  it("says Finished when a live session stopped running", () => {
    const stopped = { ...running, status: "idle", turn: { phase: "idle" } } as AggregatedAgent;
    expect(heldActivityStatus(stopped, "active")?.variant).toBe("muted");
  });

  it("never says Finished about a session whose Host is out of reach", () => {
    expect(heldActivityStatus(asCachedAgent(running), "active")).toBeNull();
  });
});
