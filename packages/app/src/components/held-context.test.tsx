// @vitest-environment jsdom
import { createContext, memo, useContext, useState, type Dispatch } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { HeldContextValue } from "./held-context";
import { RetainedPanelActivity } from "./retained-panel";

afterEach(cleanup);

const Rows = createContext<string[]>([]);
let renders = 0;
let setRows: Dispatch<string[]> = () => {};
let setActive: Dispatch<boolean> = () => {};

/** A consumer deep in a retained pane, like Home's feed reading the navigation activity. */
const Feed = memo(function Feed() {
  renders += 1;
  return <span data-testid="feed">{useContext(Rows).join(",")}</span>;
});

/** The pane's subtree: a stable element, so only the context can re-render the feed. */
const pane = (
  <HeldContextValue context={Rows}>
    <Feed />
  </HeldContextValue>
);

function Harness() {
  const [rows, updateRows] = useState(["a"]);
  const [active, updateActive] = useState(true);
  setRows = updateRows;
  setActive = updateActive;
  return (
    <Rows.Provider value={rows}>
      <RetainedPanelActivity active={active}>{pane}</RetainedPanelActivity>
    </Rows.Provider>
  );
}

describe("HeldContextValue", () => {
  it("passes updates through while the pane is shown", () => {
    renders = 0;
    render(<Harness />);
    act(() => setRows(["a", "b"]));
    expect(screen.getByTestId("feed").textContent).toBe("a,b");
    expect(renders).toBe(2);
  });

  it("renders a hidden pane's consumers zero times, then once with the latest value", () => {
    renders = 0;
    render(<Harness />);
    act(() => setActive(false));
    const hidden = renders;
    act(() => setRows(["a", "b"]));
    act(() => setRows(["a", "b", "c"]));
    expect(renders).toBe(hidden);
    expect(screen.getByTestId("feed").textContent).toBe("a");
    act(() => setActive(true));
    expect(renders).toBe(hidden + 1);
    expect(screen.getByTestId("feed").textContent).toBe("a,b,c");
  });
});
