import { describe, expect, it } from "vitest";
import {
  TimelineDirectionalPrefetch,
  type AdjacentTimelineRequest,
  type TimelineReadingPosition,
} from "./timeline-directional-prefetch";
const position: TimelineReadingPosition = {
  agentId: "a",
  epoch: "e",
  itemId: "row-50",
  seq: 50,
  startSeq: 40,
  endSeq: 79,
  nearStart: false,
  nearEnd: false,
  hasOlder: true,
  hasNewer: true,
};
function fixture() {
  const requests: Array<{ agentId: string; request: AdjacentTimelineRequest; finish: () => void }> =
    [];
  let available = true;
  const owner = new TimelineDirectionalPrefetch({
    canPrefetch: () => available,
    reportError: () => undefined,
    fetch: (agentId, request) =>
      new Promise<void>((finish) => requests.push({ agentId, request, finish })),
  });
  return {
    owner,
    requests,
    exhaust: () => {
      available = false;
    },
  };
}
describe("directional timeline prefetch", () => {
  it("requests one adjacent page only after meaningful movement near its boundary", async () => {
    const f = fixture();
    f.owner.reading(position);
    f.owner.reading({ ...position, startSeq: 30 });
    expect(f.requests).toHaveLength(0);
    f.owner.reading({ ...position, itemId: "row-42", seq: 42, nearStart: true });
    expect(f.requests).toHaveLength(1);
    expect(f.requests[0].request).toMatchObject({
      direction: "before",
      cursor: { epoch: "e", seq: 40 },
    });
    f.owner.reading({ ...position, itemId: "row-41", seq: 41, nearStart: true });
    expect(f.requests).toHaveLength(1);
    f.requests[0].finish();
    await Promise.resolve();
    await Promise.resolve();
    f.owner.reading({ ...position, itemId: "row-40", seq: 40, nearStart: true });
    expect(f.requests).toHaveLength(1);
  });
  it("cancels on changed cursor/session/epoch and stops when memory is unavailable", () => {
    const f = fixture();
    f.owner.reading(position);
    f.owner.reading({ ...position, itemId: "row-78", seq: 78, nearEnd: true });
    f.owner.cursorChanged("a");
    expect(f.requests[0].request.signal.aborted).toBe(true);
    f.owner.reading({ ...position, agentId: "b" });
    f.exhaust();
    f.owner.reading({ ...position, agentId: "b", itemId: "row-41", seq: 41, nearStart: true });
    expect(f.requests).toHaveLength(1);
    f.owner.reset();
  });
});
