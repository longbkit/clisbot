// @vitest-environment jsdom
import React, { useCallback, useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { WorkspaceContentGate } from "./workspace-content-gate";
import type { WorkspaceRouteState } from "./workspace-route-state";

afterEach(cleanup);

function Editor() {
  const [draft, setDraft] = useState("saved");
  const active = useRetainedPanelActive();
  const handleChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => setDraft(event.target.value),
    [],
  );
  return (
    <>
      <input data-testid="draft" value={draft} onChange={handleChange} />
      <span data-testid="pane-active">{String(active)}</span>
    </>
  );
}

const HOST_GATE = <span>Host gate</span>;
const view = (kind: WorkspaceRouteState["kind"]) => (
  <WorkspaceContentGate kind={kind} gate={kind === "ready" ? null : HOST_GATE}>
    <Editor />
  </WorkspaceContentGate>
);

it("keeps unsaved pane state available during reconnect and restores it when ready", () => {
  const { rerender } = render(view("ready"));
  fireEvent.change(screen.getByTestId("draft"), { target: { value: "unsaved draft" } });
  rerender(view("reconnecting"));
  expect(screen.queryByText("Host gate")).toBeNull();
  expect((screen.getByTestId("draft") as HTMLInputElement).value).toBe("unsaved draft");
  expect(screen.getByTestId("pane-active").textContent).toBe("true");
  rerender(view("ready"));
  expect(screen.queryByText("Host gate")).toBeNull();
  expect((screen.getByTestId("draft") as HTMLInputElement).value).toBe("unsaved draft");
  expect(screen.getByTestId("pane-active").textContent).toBe("true");
});

it("does not mount panes for a Host that has never become ready", () => {
  const { rerender } = render(view("reconnecting"));
  expect(screen.queryByTestId("draft")).toBeNull();
  rerender(view("ready"));
  expect(screen.getByTestId("draft")).toBeTruthy();
});

it.each(["missing", "archived", "unreachable"] as const)(
  "disposes retained pane state when the workspace becomes %s",
  (kind) => {
    const { rerender } = render(view("ready"));
    fireEvent.change(screen.getByTestId("draft"), { target: { value: "unsaved draft" } });
    rerender(view(kind));
    expect(screen.queryByTestId("draft")).toBeNull();
    rerender(view("reconnecting"));
    expect(screen.queryByTestId("draft")).toBeNull();
    rerender(view("ready"));
    expect((screen.getByTestId("draft") as HTMLInputElement).value).toBe("saved");
  },
);
