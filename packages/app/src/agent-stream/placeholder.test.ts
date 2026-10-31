import { describe, expect, it } from "vitest";
import { resolveStreamPlaceholder } from "./placeholder";

const emptyStream = {
  hasVirtualizedHistory: false,
  hasMountedHistory: false,
  hasLiveHead: false,
  hasAuxiliaryRows: false,
};

describe("resolveStreamPlaceholder", () => {
  it("shows the inline loading row while a cold session's history is on its way", () => {
    expect(resolveStreamPlaceholder({ ...emptyStream, isHistoryLoading: true })).toBe("loading");
  });

  it("shows the empty text once the Host confirms the session has no history", () => {
    expect(resolveStreamPlaceholder({ ...emptyStream, isHistoryLoading: false })).toBe("empty");
  });

  it("shows no placeholder as soon as any row can render", () => {
    expect(
      resolveStreamPlaceholder({ ...emptyStream, hasLiveHead: true, isHistoryLoading: true }),
    ).toBe("none");
    expect(
      resolveStreamPlaceholder({
        ...emptyStream,
        hasMountedHistory: true,
        isHistoryLoading: false,
      }),
    ).toBe("none");
    expect(
      resolveStreamPlaceholder({ ...emptyStream, hasAuxiliaryRows: true, isHistoryLoading: true }),
    ).toBe("none");
  });
});
