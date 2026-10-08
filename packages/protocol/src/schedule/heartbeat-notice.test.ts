import { describe, expect, it } from "vitest";
import { formatHeartbeatRunNotice, isHeartbeatRunNotice } from "./heartbeat-notice.js";

describe("heartbeat run notice", () => {
  it("names the heartbeat and the run, with the limit when there is one", () => {
    expect(formatHeartbeatRunNotice({ title: "Check CI", run: 3, maxRuns: 20 })).toBe(
      "Heartbeat · Check CI · run 3 of 20",
    );
    expect(formatHeartbeatRunNotice({ title: "Check CI", run: 3, maxRuns: null })).toBe(
      "Heartbeat · Check CI · run 3",
    );
  });

  it("recognizes only its own lines", () => {
    expect(isHeartbeatRunNotice("Heartbeat · Check CI · run 1")).toBe(true);
    expect(isHeartbeatRunNotice("Runtime v2")).toBe(false);
  });
});
