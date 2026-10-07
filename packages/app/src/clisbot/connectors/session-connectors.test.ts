/** @vitest-environment jsdom */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CONNECTORS_OFF_LABEL } from "@clisbot/protocol/connectors/types";
import { useSessionStore } from "@/stores/session-store";
import {
  draftConnectorsLabels,
  finishDraftConnectors,
  toggled,
  useSessionConnectorsOff,
} from "./session-connectors";

afterEach(cleanup);

function toggle(key: string) {
  return (off: ReadonlySet<string>) => toggled(off, key);
}

describe("draft Connectors", () => {
  it("keeps each draft's picks apart and keeps them until the agent exists", async () => {
    const first = renderHook(() =>
      useSessionConnectorsOff({ serverId: "srv", agentId: null, draftKey: "tab-1" }),
    );
    await act(() => first.result.current.update(toggle("gmail")));
    await act(() => first.result.current.update(toggle("mcp:notes")));
    expect(first.result.current.off).toEqual(new Set(["gmail", "mcp:notes"]));
    expect(draftConnectorsLabels("srv", "tab-1")).toEqual({
      [CONNECTORS_OFF_LABEL]: "gmail,mcp:notes",
    });
    expect(draftConnectorsLabels("srv", "tab-2")).toBeUndefined();
    // Reading the label for a create does not clear it: a failed create keeps the picks.
    expect(draftConnectorsLabels("srv", "tab-1")).toBeDefined();
    const sent = draftConnectorsLabels("srv", "tab-1");
    await act(() =>
      finishDraftConnectors({ serverId: "srv", draftKey: "tab-1", agentId: "agent-1", sent }),
    );
    expect(draftConnectorsLabels("srv", "tab-1")).toBeUndefined();
    expect(first.result.current.off.size).toBe(0);
  });

  it("writes a switch flipped while the create was on its way to the new agent", async () => {
    const updateAgent = vi.fn(() => Promise.resolve());
    useSessionStore.setState({ sessions: { srv: { client: { updateAgent } } } } as never);
    const draft = renderHook(() =>
      useSessionConnectorsOff({ serverId: "srv", agentId: null, draftKey: "tab-3" }),
    );
    await act(() => draft.result.current.update(toggle("gmail")));
    const sent = draftConnectorsLabels("srv", "tab-3");
    await act(() => draft.result.current.update(toggle("slack")));
    await finishDraftConnectors({ serverId: "srv", draftKey: "tab-3", agentId: "agent-3", sent });
    expect(updateAgent).toHaveBeenCalledWith("agent-3", {
      labels: { [CONNECTORS_OFF_LABEL]: "gmail,slack" },
    });
    expect(draftConnectorsLabels("srv", "tab-3")).toBeUndefined();
  });
});
