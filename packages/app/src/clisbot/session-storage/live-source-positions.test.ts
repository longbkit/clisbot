import { describe, expect, it } from "vitest";
import { processAgentStreamEvent } from "@/timeline/session-stream-reducers";
import type { StreamItem } from "@/types/stream";

/**
 * The live reducer runs against upstream hosts too. Source positions are the
 * session-storage read contract, so they must be absent unless the host advertised it.
 */
function assistantEvent(text: string) {
  return {
    event: {
      type: "timeline" as const,
      provider: "claude" as const,
      item: { type: "assistant_message" as const, text, messageId: "reply" },
    },
    seq: 42,
    epoch: "epoch-1",
    currentTail: [] as StreamItem[],
    currentHead: [] as StreamItem[],
    currentCursor: undefined,
    timestamp: new Date(0),
  };
}

describe("live source positions", () => {
  it("leaves a live row with the upstream cursor when the host has no read capability", () => {
    for (const trackSourcePositions of [undefined, false]) {
      const result = processAgentStreamEvent({ ...assistantEvent("hello"), trackSourcePositions });
      expect(result.head[0]?.timelineCursor).toEqual({ epoch: "epoch-1", seq: 42 });
    }
  });

  it("accumulates the source range a live row was built from once the host advertises it", () => {
    const first = processAgentStreamEvent({
      ...assistantEvent("hello"),
      trackSourcePositions: true,
    });
    expect(first.head[0]?.timelineCursor).toEqual({
      epoch: "epoch-1",
      seq: 42,
      seqStart: 42,
      sourceSeqRanges: [{ startSeq: 42, endSeq: 42 }],
    });
    const second = processAgentStreamEvent({
      ...assistantEvent(" world"),
      seq: 43,
      currentHead: first.head,
      trackSourcePositions: true,
    });
    // A continued chunk extends the range it already owns instead of starting a new one.
    expect(second.head[0]?.timelineCursor).toEqual({
      epoch: "epoch-1",
      seq: 43,
      seqStart: 42,
      sourceSeqRanges: [{ startSeq: 42, endSeq: 43 }],
    });
  });
});
